/**
 * GraphDispatcher：事件路由到 Graph 的调度器。
 * 对应架构计划第 4 节。
 *
 * 职责：
 * - 接收 AppEvent
 * - 根据 event.type 路由到对应的 Graph Runner
 * - 收集 Graph 输出的 ResponseDTO / 投递结果
 * - 转发给 Renderer（通过回调）
 *
 * 路由规则：
 * - chat → ConversationGraph
 * - startup → OnboardingGraph（首次）或 ProactiveEventGraph（已引导）
 * - reminder_due → ProactiveEventGraph
 * - daily_greeting_due → ProactiveEventGraph
 *
 * 不直接操作 BrowserWindow，通过回调通知 Renderer。
 */
import type { AppEvent, ChatPayload, ReminderDuePayload } from '../shared/contracts/app-event';
import type { ResponseDTO } from '../agent/graphs/conversation/state';
import type { DeliveryResult } from '../agent/graphs/proactive/state';
import { APP_EVENT_TYPE } from '../shared/constants';
import { ConversationGraphRunner } from '../agent/graphs/conversation/graph';
import { createInitialConversationState } from '../agent/graphs/conversation/state';
import { ProactiveGraphRunner } from '../agent/graphs/proactive/graph';
import { createInitialProactiveState } from '../agent/graphs/proactive/state';
import { OnboardingGraphRunner } from '../agent/graphs/onboarding/graph';
import { createInitialOnboardingState, type OnboardingStateType, type UserPreferences } from '../agent/graphs/onboarding/state';
import type { SkillRegistry } from '../services/SkillRegistry';
import type { ModelGateway } from '../services/ModelGateway';
import type { MemoryStore } from '../services/MemoryStore';
import type { CharacterPackManager } from '../services/CharacterPackManager';
import type { FullscreenAdapter } from '../adapters/fullscreen/FullscreenAdapter';
import type { NotificationAdapter } from '../adapters/notifications/NotificationAdapter';
import type { SoundAdapter } from '../adapters/sound/SoundAdapter';
import type { WeatherAdapter } from '../adapters/weather/WeatherAdapter';
import { TimeService } from '../services/TimeService';
import { UserContextService } from '../services/UserContextService';
import { RuntimePersonaBuilder } from '../services/RuntimePersonaBuilder';
import { ReminderParserService } from '../services/ReminderParserService';
import type { PersonaConfig } from '../shared/contracts/graph-state';
import { settingsRepository } from '../infrastructure/database/repositories/settings-repository';
import { sessionRepository } from '../infrastructure/database/repositories/session-repository';
import { proactiveDeliveryRepository } from '../infrastructure/database/repositories/proactive-delivery-repository';
import { eventOutboxRepository } from '../infrastructure/database/repositories/event-outbox-repository';
import { createLogger } from '../infrastructure/logging/logger';
import type { AppPaths } from '../infrastructure/config/app-paths';

const log = createLogger('GraphDispatcher');

/** Renderer 回调：将 DTO 发送到渲染进程，返回是否成功送达（ACK 确认） */
export type RendererCallback = (dto: ResponseDTO, channel: string) => Promise<boolean>;

export interface GraphDispatcherDeps {
  skillRegistry: SkillRegistry;
  modelGateway: ModelGateway;
  memoryStore: MemoryStore;
  characterPackManager: CharacterPackManager;
  appPaths: AppPaths;
  /** 主动事件依赖：全屏/通知/声音/天气/时间服务 */
  fullscreenAdapter: FullscreenAdapter;
  notificationAdapter: NotificationAdapter;
  soundAdapter: SoundAdapter;
  weatherAdapter: WeatherAdapter | null;
  timeService: TimeService;
  /** 用户上下文服务：加载用户昵称/称呼/时区 */
  userContextService: UserContextService;
  /** 运行时 Persona 构建器：替换角色包中的模板变量 */
  runtimePersonaBuilder: RuntimePersonaBuilder;
  /** 提醒解析服务：支持相对时间和模型辅助提取 */
  reminderParserService: ReminderParserService;
}

export class GraphDispatcher {
  private conversationRunner: ConversationGraphRunner;
  private proactiveRunner: ProactiveGraphRunner;
  private onboardingRunner: OnboardingGraphRunner;
  private memoryStore: MemoryStore;
  private characterPackManager: CharacterPackManager;
  private appPaths: AppPaths;
  private timeService: TimeService;
  private userContextService: UserContextService;
  private runtimePersonaBuilder: RuntimePersonaBuilder;
  private rendererCallback: RendererCallback | null = null;
  /** 保存 Onboarding 中断时的状态，供 resumeWithPreferences 使用 */
  private pendingOnboardingState: OnboardingStateType | null = null;

  constructor(deps: GraphDispatcherDeps) {
    this.conversationRunner = new ConversationGraphRunner({
      skillRegistry: deps.skillRegistry,
      modelGateway: deps.modelGateway,
      memoryStore: deps.memoryStore,
      reminderParserService: deps.reminderParserService
    });
    this.proactiveRunner = new ProactiveGraphRunner({
      fullscreenAdapter: deps.fullscreenAdapter,
      notificationAdapter: deps.notificationAdapter,
      soundAdapter: deps.soundAdapter,
      weatherAdapter: deps.weatherAdapter,
      timeService: deps.timeService
    });
    this.onboardingRunner = new OnboardingGraphRunner(deps.characterPackManager);
    this.memoryStore = deps.memoryStore;
    this.characterPackManager = deps.characterPackManager;
    this.appPaths = deps.appPaths;
    this.timeService = deps.timeService;
    this.userContextService = deps.userContextService;
    this.runtimePersonaBuilder = deps.runtimePersonaBuilder;
  }

  /** 注册 Renderer 回调 */
  setRendererCallback(callback: RendererCallback): void {
    this.rendererCallback = callback;
    log.info('renderer callback registered');
  }

  /**
   * 构建运行时 Persona。
   * 1. 从 users 表加载用户上下文（昵称、称呼、时区）
   * 2. 用 RuntimePersonaBuilder 替换角色包中的模板变量
   * 3. 在 corePrompt 末尾注入可信当前时间上下文
   * 返回 null 表示无角色包可用。
   */
  private buildRuntimePersona(userId: string): PersonaConfig | null {
    const pack = this.characterPackManager.getActivePack();
    if (!pack?.persona) return null;

    const userContext = this.userContextService.load(userId, pack.persona);
    const runtimePersona = this.runtimePersonaBuilder.build(pack.persona, userContext);

    // 注入可信当前时间上下文，确保模型调用时有准确的时间参考
    const timeContext = this.timeService.getCurrentTimeContext();
    const timeInfo = `\n\n[当前时间上下文] 本地时间：${timeContext.localDisplay}（${timeContext.weekday}），时区：${timeContext.timezone}（UTC${timeContext.utcOffset}），时间戳：${timeContext.epochMs}。请基于此时间处理所有时间相关请求。`;
    runtimePersona.corePrompt = runtimePersona.corePrompt + timeInfo;

    return runtimePersona;
  }

  /**
   * 直接调度聊天并返回结果（供 IPC 同步调用，不通过 EventBus）。
   * 避免临时替换全局回调导致的竞争风险。
   */
  async dispatchChat(
    userId: string,
    characterId: string,
    message: string,
    sessionId?: string
  ): Promise<ResponseDTO | null> {
    const event: AppEvent<ChatPayload> = {
      schemaVersion: 1,
      eventId: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: APP_EVENT_TYPE.CHAT,
      occurredAt: new Date().toISOString(),
      timezone: 'Asia/Shanghai',
      source: 'renderer' as any,
      userId,
      characterId,
      sessionId,
      correlationId: `chat-${Date.now()}`,
      priority: 'normal' as any,
      payload: { message }
    };

    return this.handleChatDirect(event);
  }

  /** 直接调用 handleChat 并返回 ResponseDTO（不经回调） */
  private async handleChatDirect(event: AppEvent<ChatPayload>): Promise<ResponseDTO | null> {
    const message = event.payload.message;
    const userId = event.userId;
    const characterId = event.characterId;

    let sessionId = event.sessionId;
    if (!sessionId) {
      sessionId = `sess-${userId}-${characterId}-${Date.now()}`;
      try {
        sessionRepository.insert({ id: sessionId, user_id: userId, character_id: characterId });
      } catch (error) {
        log.warn('failed to create session', {
          fields: { error: (error as Error)?.message }
        });
      }
    }

    const persona = this.buildRuntimePersona(userId);

    const state = createInitialConversationState({
      event,
      userId,
      characterId,
      sessionId,
      persona,
      modelMode: 'balanced',
      userInput: message
    });

    const result = await this.conversationRunner.run(state);

    // dispatchChat 直接返回结果给调用方（IPC invoke），
    // 不再通过 callback 发送 'chat-response'，避免重复显示。
    // callback 仅用于主动事件（proactive-event / onboarding-request 等）。
    return result.responseDTO ?? null;
  }

  /** 主调度入口，返回主动事件的投递结果（非主动事件返回 null） */
  async dispatch(event: AppEvent): Promise<DeliveryResult | null> {
    log.info('dispatching event', {
      fields: { type: event.type, eventId: event.eventId }
    });

    try {
      switch (event.type) {
        case APP_EVENT_TYPE.CHAT:
          await this.handleChat(event as AppEvent<ChatPayload>);
          return null;
        case APP_EVENT_TYPE.REMINDER_DUE:
          return await this.handleReminderDue(event as AppEvent<ReminderDuePayload>);
        case APP_EVENT_TYPE.STARTUP:
          await this.handleStartup(event);
          return null;
        case APP_EVENT_TYPE.DAILY_GREETING_DUE:
          await this.handleDailyGreeting(event);
          return null;
        case APP_EVENT_TYPE.PERMISSION_RESOLVED:
          await this.handlePermissionResolved(event);
          return null;
        default:
          log.warn('unknown event type, ignoring', {
            fields: { type: event.type }
          });
          return null;
      }
    } catch (error) {
      log.error('dispatch failed', {
        fields: {
          type: event.type,
          eventId: event.eventId,
          error: (error as Error)?.message
        }
      });
      // 发送错误响应到 Renderer
      if (this.rendererCallback) {
        await this.rendererCallback({
          text: '抱歉，处理时遇到了问题。请稍后再试。',
          expression: 'failed',
          motion: 'failed'
        }, 'chat-response');
      }
      return null;
    }
  }

  /** 处理聊天消息 */
  private async handleChat(event: AppEvent<ChatPayload>): Promise<void> {
    const message = event.payload.message;
    const userId = event.userId;
    const characterId = event.characterId;

    // 获取或创建会话
    let sessionId = event.sessionId;
    if (!sessionId) {
      sessionId = `sess-${userId}-${characterId}-${Date.now()}`;
      try {
        sessionRepository.insert({ id: sessionId, user_id: userId, character_id: characterId });
      } catch (error) {
        log.warn('failed to create session', {
          fields: { error: (error as Error)?.message }
        });
      }
    }

    // 获取运行时 persona（注入用户昵称和时间上下文）
    const persona = this.buildRuntimePersona(userId);

    const state = createInitialConversationState({
      event,
      userId,
      characterId,
      sessionId,
      persona,
      modelMode: 'balanced',
      userInput: message
    });

    const result = await this.conversationRunner.run(state);

    // 发送到 Renderer
    if (this.rendererCallback && result.responseDTO) {
      await this.rendererCallback(result.responseDTO, 'chat-response');
    }
  }

  /** 处理提醒到期，返回投递结果 */
  private async handleReminderDue(event: AppEvent<ReminderDuePayload>): Promise<DeliveryResult | null> {
    const state = createInitialProactiveState({
      event,
      userId: event.userId,
      characterId: event.characterId,
      sessionId: `proactive-${event.eventId}`,
      persona: this.buildRuntimePersona(event.userId),
      modelMode: 'balanced',
      proactiveType: 'reminder'
    });

    const result = await this.proactiveRunner.run(state);

    const deliveryResult = result.deliveryResult ?? null;

    // 只发送可投递的通道给 renderer：
    // - pet_bubble: 发送给 renderer 显示气泡，等待 ACK 确认
    // - system_notification: Graph 已自行显示通知，但仍通知 renderer 同步表情
    // - deferred: 不发送，等待全屏退出/勿扰结束后补发
    // - suppressed: 不发送，被策略抑制
    if (this.rendererCallback && deliveryResult) {
      const channel = deliveryResult.channel;
      if (channel === 'pet_bubble') {
        // pet_bubble：异步投递，等待 renderer ACK 确认气泡实际显示。
        // ACK 成功才标记 delivered=true；失败/超时保持 false，
        // 以便 Scheduler 后续重试。
        const acked = await this.deliverToRendererWithAck(deliveryResult, event);
        deliveryResult.delivered = acked;
        // ACK 成功后，由 Dispatcher 记录投递（Graph 的 record_delivery 节点
        // 因 delivered=false 已跳过记录）。
        if (acked) {
          this.recordProactiveDelivery(event, deliveryResult);
        }
      } else if (channel === 'system_notification') {
        // system_notification：Graph 已自行显示通知，
        // 同步通知 renderer 更新表情，投递成功以通知显示为准。
        await this.rendererCallback({
          text: deliveryResult.message,
          expression: deliveryResult.expression,
          motion: deliveryResult.motion,
          reminderOccurrenceId: deliveryResult.deliveryId
        }, 'proactive-event');
        deliveryResult.delivered = true;
      }
    }

    return deliveryResult;
  }

  /**
   * 记录主动事件投递成功 + 标记 outbox 已处理。
   * 仅在 Dispatcher 确认投递成功（ACK）后调用。
   */
  private recordProactiveDelivery(
    event: AppEvent<ReminderDuePayload>,
    deliveryResult: DeliveryResult
  ): void {
    try {
      proactiveDeliveryRepository.record({
        user_id: event.userId,
        character_id: event.characterId,
        delivery_type: 'reminder',
        ignored: 0,
        daily_date: new Date().toISOString().slice(0, 10)
      });
      if (event.dedupeKey) {
        eventOutboxRepository.markProcessed(event.eventId);
      }
      log.info('proactive delivery recorded after ACK', {
        fields: { eventId: event.eventId, deliveryId: deliveryResult.deliveryId }
      });
    } catch (error) {
      log.warn('failed to record delivery after ACK', {
        fields: { error: (error as Error)?.message }
      });
    }
  }

  /**
   * 将 pet_bubble 投递给 renderer 并等待 ACK。
   * 返回 true 表示 renderer 已确认显示；false 表示超时/失败/窗口销毁。
   */
  private async deliverToRendererWithAck(
    deliveryResult: DeliveryResult,
    event: AppEvent<ReminderDuePayload>
  ): Promise<boolean> {
    if (!this.rendererCallback) return false;
    try {
      const acked = await this.rendererCallback({
        text: deliveryResult.message,
        expression: deliveryResult.expression,
        motion: deliveryResult.motion,
        reminderOccurrenceId: deliveryResult.deliveryId || event.payload.reminderOccurrenceId
      }, 'proactive-event');
      return acked === true;
    } catch (error) {
      log.warn('renderer delivery failed', {
        fields: {
          eventId: event.eventId,
          error: (error as Error)?.message
        }
      });
      return false;
    }
  }

  /**
   * 只将可投递的通道（pet_bubble / system_notification）发送给 renderer。
   * deferred 和 suppressed 不发送，避免全屏/勿扰期间错误显示。
   * 用于非提醒类主动事件（startup_digest / daily_greeting）。
   */
  private async sendDeliveryToRenderer(deliveryResult: DeliveryResult | null): Promise<void> {
    if (!this.rendererCallback || !deliveryResult) return;
    const channel = deliveryResult.channel;
    if (channel === 'pet_bubble' || channel === 'system_notification') {
      // 非提醒类事件也走 ACK 流程，确保 renderer 实际显示
      const acked = await this.rendererCallback({
        text: deliveryResult.message,
        expression: deliveryResult.expression,
        motion: deliveryResult.motion,
        reminderOccurrenceId: deliveryResult.deliveryId
      }, 'proactive-event');
      deliveryResult.delivered = acked;
    }
  }

  /**
   * 恢复 Onboarding 并应用用户偏好。
   * 调用 OnboardingGraphRunner.resumeWithPreferences 完成剩余流程：
   * build_persona → configure_proactive_policy → configure_model_mode
   * → save_onboarding_result → activate_character → finish
   * 完成后标记 onboarding_completed 并触发 daily greeting。
   */
  async resumeOnboarding(preferences: Partial<UserPreferences>): Promise<boolean> {
    if (!this.pendingOnboardingState) {
      log.warn('no pending onboarding state to resume');
      // 尝试重新运行 onboarding（可能从设置恢复偏好）
      return false;
    }

    try {
      const result = await this.onboardingRunner.resumeWithPreferences(
        this.pendingOnboardingState,
        preferences
      );

      this.pendingOnboardingState = null;

      if (result.isCompleted) {
        log.info('onboarding completed successfully', {
          fields: { userId: result.userId, characterId: result.characterId }
        });
        settingsRepository.set('onboarding_completed', 'true');
        // 发送完成通知给 renderer（ACK 确认由 sendDeliveryToRenderer 处理）
        await this.sendDeliveryToRenderer({
          channel: 'pet_bubble',
          message: result.pendingQuestion || '初始化完成，很高兴认识你！',
          expression: 'waving',
          motion: 'waving',
          delivered: false
        });
        return true;
      }

      // 可能还有后续步骤需要用户输入
      if (result.awaitingUserInput) {
        this.pendingOnboardingState = result;
        if (this.rendererCallback) {
          await this.rendererCallback({
            text: result.pendingQuestion || '请继续配置。',
            expression: 'waiting',
            motion: 'waiting'
          }, 'onboarding-request');
        }
      }
      return result.isCompleted;
    } catch (error) {
      log.error('onboarding resume failed', {
        fields: { error: (error as Error)?.message }
      });
      this.pendingOnboardingState = null;
      return false;
    }
  }

  /** 处理启动事件 */
  private async handleStartup(event: AppEvent): Promise<void> {
    const onboardingCompleted = settingsRepository.get('onboarding_completed') === 'true';

    if (!onboardingCompleted) {
      // 首次启动：走 Onboarding
      const defaultPackPath = `${this.appPaths.characterPacksDir}/default`;
      const state = createInitialOnboardingState(defaultPackPath);
      const result = await this.onboardingRunner.run(state);

      if (result.awaitingUserInput) {
        // 保存状态供 resumeOnboarding 使用
        this.pendingOnboardingState = result;
        if (this.rendererCallback) {
          await this.rendererCallback({
            text: result.pendingQuestion || '请输入你的昵称和称呼偏好。',
            expression: 'waving',
            motion: 'waving'
          }, 'onboarding-request');
        }
      } else if (result.isCompleted) {
        // 可能从已保存设置直接完成
        settingsRepository.set('onboarding_completed', 'true');
        await this.sendDeliveryToRenderer({
          channel: 'pet_bubble',
          message: '初始化完成，很高兴认识你！',
          expression: 'waving',
          motion: 'waving',
          delivered: false
        });
      }
    } else {
      // 已引导：发送启动摘要
      const state = createInitialProactiveState({
        event,
        userId: event.userId,
        characterId: event.characterId,
        sessionId: `proactive-${event.eventId}`,
        persona: this.buildRuntimePersona(event.userId),
        modelMode: 'balanced',
        proactiveType: 'startup_digest'
      });
      const result = await this.proactiveRunner.run(state);
      await this.sendDeliveryToRenderer(result.deliveryResult ?? null);
    }
  }

  /** 处理每日问候 */
  private async handleDailyGreeting(event: AppEvent): Promise<void> {
    const state = createInitialProactiveState({
      event,
      userId: event.userId,
      characterId: event.characterId,
      sessionId: `proactive-${event.eventId}`,
      persona: this.buildRuntimePersona(event.userId),
      modelMode: 'balanced',
      proactiveType: 'daily_greeting'
    });

    const result = await this.proactiveRunner.run(state);
    await this.sendDeliveryToRenderer(result.deliveryResult ?? null);
  }

  /** 处理权限确认 */
  private async handlePermissionResolved(event: AppEvent): Promise<void> {
    // 权限确认后恢复 ConversationGraph（通过 checkpoint）
    log.info('permission resolved, resuming conversation', {
      fields: { eventId: event.eventId }
    });
    // 下一次 chat 事件会自动加载 checkpoint
  }
}
