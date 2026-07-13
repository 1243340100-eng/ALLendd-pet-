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
import { readCheckpointReadOnly, savePendingAnswersToCheckpoint, clearPendingAnswersFromCheckpoint } from '../agent/graphs/onboarding/nodes/load-checkpoint';
import type { OnboardingQuestionAnswer, OnboardingQuestion, PendingAnswerEntry } from '../services/character-onboarding/schemas';
import { generateSuggestion } from '../services/character-onboarding/SuggestionGenerator';
import type { OnboardingSuggestionDto } from '../shared/dto/renderer';
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
import { characterProfileRepository } from '../infrastructure/database/repositories/character-profile-repository';
import { checkpointRepository } from '../infrastructure/database/repositories/checkpoint-repository';
import { proactivePolicyRepository, DEFAULT_PROACTIVE_POLICY } from '../infrastructure/database/repositories/proactive-policy-repository';
import { getDatabase, transaction } from '../infrastructure/database/connection';
import { compileFromExistingPersona, CURRENT_CONFIG_VERSION } from '../services/character-onboarding/ProfileCompiler';
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
  private modelGateway: ModelGateway;
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
    this.onboardingRunner = new OnboardingGraphRunner(deps.characterPackManager, deps.modelGateway);
    this.memoryStore = deps.memoryStore;
    this.characterPackManager = deps.characterPackManager;
    this.appPaths = deps.appPaths;
    this.timeService = deps.timeService;
    this.userContextService = deps.userContextService;
    this.runtimePersonaBuilder = deps.runtimePersonaBuilder;
    this.modelGateway = deps.modelGateway;
  }

  /** 注册 Renderer 回调 */
  setRendererCallback(callback: RendererCallback): void {
    this.rendererCallback = callback;
    log.info('renderer callback registered');
  }

  /**
   * 构建运行时 Persona。
   *
   * V8 重构后优先级：
   * 1. 读取已锁定的 CompiledCharacterProfile.persona（V8 新安装用户）
   * 2. 旧用户兼容：从当前有效默认 persona 确定性生成兼容配置（不调用模型）
   * 3. 回退到角色包原始 persona（最后手段）
   *
   * 步骤：
   * 1. 从 users 表加载用户上下文（昵称、称呼、时区）
   * 2. 用 RuntimePersonaBuilder 替换角色包中的模板变量
   * 3. 在 corePrompt 末尾注入可信当前时间上下文
   * 返回 null 表示无角色包可用。
   */
  private buildRuntimePersona(userId: string): PersonaConfig | null {
    return this.buildRuntimePersonaWithProfile(userId).persona;
  }

  /**
   * 构建运行时 Persona 和 PersonalityProfile（V8 新增）。
   * 返回 persona 和对应的 personalityProfile（如果有）。
   */
  private buildRuntimePersonaWithProfile(userId: string): {
    persona: PersonaConfig | null;
    personalityProfile: import('../services/character-onboarding/schemas').PersonalityProfile | null;
  } {
    // V8 优先级 1：读取已锁定的 CompiledCharacterProfile
    const lockedProfile = characterProfileRepository.getActiveLockedProfile();
    if (lockedProfile) {
      log.info('using locked CompiledCharacterProfile', {
        fields: {
          characterId: lockedProfile.persona.characterId,
          configVersion: lockedProfile.configVersion
        }
      });
      const userContext = this.userContextService.load(userId, lockedProfile.persona);
      const runtimePersona = this.runtimePersonaBuilder.build(lockedProfile.persona, userContext);
      return {
        persona: this.injectTimeContext(runtimePersona),
        personalityProfile: lockedProfile.personalityProfile
      };
    }

    // V8 优先级 2：旧用户兼容（已完成旧 onboarding 但没有锁定配置）
    const pack = this.characterPackManager.getActivePack();
    if (!pack?.persona) {
      return { persona: null, personalityProfile: null };
    }

    const onboardingCompleted = settingsRepository.get('onboarding_completed') === 'true';
    if (onboardingCompleted) {
      // 旧用户：从当前有效 persona 确定性生成兼容配置
      log.info('legacy user detected, compiling from existing persona', {
        fields: { characterId: pack.manifest.id }
      });
      const compatProfile = compileFromExistingPersona(pack.persona, pack.manifest);
      // 不强制锁定（避免破坏旧用户数据），但使用兼容配置的 persona
      const userContext = this.userContextService.load(userId, compatProfile.persona);
      const runtimePersona = this.runtimePersonaBuilder.build(compatProfile.persona, userContext);
      return {
        persona: this.injectTimeContext(runtimePersona),
        personalityProfile: compatProfile.personalityProfile
      };
    }

    // V8 优先级 3 已删除（W4）：未完成向导时不再回退到角色包原始 persona。
    // 主进程 chat-send / planning 等 IPC 应在调用 Graph 前检查 isOnboardingCompleted()，
    // 拒绝未完成用户进入聊天/计划/日历。如果运行流到达此处，说明上游检查缺失，
    // 返回 null 让 ConversationGraph 自然报错，避免使用未初始化的角色身份。
    log.error('no locked profile and onboarding not completed, refusing to build persona', {
      fields: { characterId: pack.manifest.id }
    });
    return { persona: null, personalityProfile: null };
  }

  /** 注入可信当前时间上下文到 corePrompt */
  private injectTimeContext(persona: PersonaConfig): PersonaConfig {
    const timeContext = this.timeService.getCurrentTimeContext();
    const timeInfo = `\n\n[当前时间上下文] 本地时间：${timeContext.localDisplay}（${timeContext.weekday}），时区：${timeContext.timezone}（UTC${timeContext.utcOffset}），时间戳：${timeContext.epochMs}。请基于此时间处理所有时间相关请求。`;
    return {
      ...persona,
      corePrompt: persona.corePrompt + timeInfo
    };
  }

  // ===== V8 角色初始化向导 IPC 入口 =====

  /**
   * 获取 Onboarding 当前状态。
   * I7: 只读查询，不运行 Graph，不调用模型，不保存新 checkpoint。
   * 直接从 checkpoint 表读取并校验，格式化为 DTO 返回。
   * 如果没有 checkpoint，返回初始 phase='collecting' 状态。
   */
  async getOnboardingState(): Promise<OnboardingStateType> {
    const defaultPackPath = `${this.appPaths.characterPacksDir}/default`;
    const traceId = `onb-get-${Date.now()}`;
    const initialState = createInitialOnboardingState(defaultPackPath, 'default-onboarding', traceId);

    try {
      // 优先检查是否已有合法锁定角色（完成后 checkpoint 会被消费，不能仅靠 checkpoint 判断）
      const onboardingCompleted = settingsRepository.get('onboarding_completed') === 'true';
      const activeCharacterId = settingsRepository.get('active_character_id');
      const lockedProfile = characterProfileRepository.getActiveLockedProfile();

      if (lockedProfile) {
        const profileCharacterId = lockedProfile.persona.characterId;
        // 如果 settings 中的 active_character_id 和锁定角色不一致，记录日志并修复 setting
        // 这能防止旧数据迁移或异常退出导致标志位与角色数据不同步
        if (!activeCharacterId || activeCharacterId !== profileCharacterId) {
          log.warn('getOnboardingState: active_character_id mismatch or missing, syncing from locked profile', {
            fields: {
              settingCharacterId: activeCharacterId,
              profileCharacterId,
              onboardingCompleted: String(onboardingCompleted),
              traceId
            }
          });
          settingsRepository.set('active_character_id', profileCharacterId);
        }
        if (!onboardingCompleted) {
          log.warn('getOnboardingState: onboarding_completed flag missing but locked profile exists, syncing flag', {
            fields: { profileCharacterId, traceId }
          });
          settingsRepository.set('onboarding_completed', 'true');
        }
        log.info('getOnboardingState: active locked profile found, returning locked state', {
          fields: { characterId: profileCharacterId, traceId }
        });
        return {
          ...initialState,
          currentStep: 'finish',
          isCompleted: true,
          phase: 'locked',
          userId: settingsRepository.get('user_id') || '',
          characterId: profileCharacterId,
          persona: lockedProfile.persona,
          compiledProfile: lockedProfile
        };
      }

      // 构造 scope_key：与 load_checkpoint 节点使用相同逻辑
      const userId = settingsRepository.get('user_id') || 'anonymous';
      const characterId = settingsRepository.get('active_character_id') || 'default';
      const threadId = 'default-onboarding';
      const scopeKey = `${userId}:${characterId}:${threadId}`;

      const readonly = readCheckpointReadOnly(scopeKey);
      if (!readonly) {
        // 无 checkpoint 或 checkpoint 损坏：返回初始 collecting 状态
        log.info('getOnboardingState: no checkpoint, returning initial collecting state', {
          fields: { scopeKey, traceId }
        });
        return {
          ...initialState,
          currentStep: 'determine_stage',
          phase: 'collecting',
          draft: null,
          currentQuestions: [],
          previousQuestions: [],
          summary: null,
          completionProgress: 0
        };
      }

      // 有 checkpoint：返回恢复的状态，不运行 Graph
      log.info('getOnboardingState: restored from checkpoint (read-only)', {
        fields: {
          scopeKey,
          stage: readonly.currentStage,
          phase: readonly.phase,
          draftRevision: readonly.draft.revision,
          traceId
        }
      });

      return {
        ...initialState,
        currentStep: 'determine_stage',
        userId: settingsRepository.get('user_id') || '',
        characterId: settingsRepository.get('active_character_id') || '',
        draft: readonly.draft,
        currentStage: readonly.currentStage,
        phase: readonly.phase,
        currentQuestions: readonly.currentQuestions,
        previousQuestions: readonly.previousQuestions,
        summary: readonly.summary ?? null,
        completionProgress: readonly.completionProgress,
        pendingAnswers: readonly.pendingAnswers
      };
    } catch (error) {
      log.error('getOnboardingState failed', {
        fields: { error: (error as Error)?.message, traceId }
      });
      return {
        ...initialState,
        phase: 'error',
        errorReason: 'get-state-failed'
      };
    }
  }

  // ===== P2: pendingAnswers 临时保存/清除 =====

  /**
   * 构造 onboarding scope_key（与 load_checkpoint 节点使用相同逻辑）。
   */
  private buildOnboardingScopeKey(): string {
    const userId = settingsRepository.get('user_id') || 'anonymous';
    const characterId = settingsRepository.get('active_character_id') || 'default';
    const threadId = 'default-onboarding';
    return `${userId}:${characterId}:${threadId}`;
  }

  /**
   * P2: 保存未提交的卡片选择到 checkpoint。
   * 使用 debounce（renderer 侧 600ms）后批量保存。
   */
  savePendingAnswers(answers: PendingAnswerEntry[], revision: number): { ok: boolean; reason?: string } {
    const scopeKey = this.buildOnboardingScopeKey();
    try {
      return savePendingAnswersToCheckpoint(scopeKey, answers, revision);
    } catch (error) {
      log.error('savePendingAnswers failed', {
        fields: { error: (error as Error)?.message, scopeKey, revision }
      });
      return { ok: false, reason: 'save-failed' };
    }
  }

  /**
   * P2: 清除未提交的卡片选择。
   * 提交成功、进入下一批、reset 时调用。
   */
  clearPendingAnswers(revision: number): { ok: boolean; reason?: string } {
    const scopeKey = this.buildOnboardingScopeKey();
    try {
      return clearPendingAnswersFromCheckpoint(scopeKey, revision);
    } catch (error) {
      log.error('clearPendingAnswers failed', {
        fields: { error: (error as Error)?.message, scopeKey, revision }
      });
      return { ok: false, reason: 'clear-failed' };
    }
  }

  /**
   * 启动 Onboarding 向导（首次或重置后）。
   * 创建初始状态，运行 Graph 到第一次中断（generate_questions）。
   */
  async startOnboarding(revision: number): Promise<OnboardingStateType> {
    const defaultPackPath = `${this.appPaths.characterPacksDir}/default`;
    const traceId = `onb-start-${Date.now()}`;
    const initialState = createInitialOnboardingState(defaultPackPath, 'default-onboarding', traceId);
    // W2: 乐观锁校验 - start 只允许 revision=0
    if (revision !== 0) {
      log.warn('startOnboarding rejected: non-zero revision', {
        fields: { revision, traceId }
      });
      return {
        ...initialState,
        phase: 'error',
        errorReason: 'stale-revision',
        errors: [`Stale revision: expected 0, got ${revision}`]
      };
    }
    // userAction='start' 让 determine_stage 路由到 generate_questions
    return await this.onboardingRunner.run({
      ...initialState,
      expectedRevision: revision
    });
  }

  /**
   * 重设人物性格：解锁当前角色、清除 onboarding 状态、重新启动向导。
   *
   * 流程：
   * 1. 获取当前 active_character_id
   * 2. 解锁当前角色 profile（保留记录用于审计）
   * 3. 清除 onboarding_completed 和 active_character_id
   * 4. 消费旧的 onboarding checkpoint（避免恢复旧草稿）
   * 5. 调用 startOnboarding(0) 重新启动向导
   */
  async resetOnboarding(): Promise<OnboardingStateType> {
    const traceId = `onb-reset-${Date.now()}`;
    const defaultPackPath = `${this.appPaths.characterPacksDir}/default`;
    const initialState = createInitialOnboardingState(defaultPackPath, 'default-onboarding', traceId);

    try {
      // 1. 获取当前 active_character_id
      const activeCharacterId = settingsRepository.get('active_character_id');
      const userId = settingsRepository.get('user_id') ?? 'default-user';

      // 2-4. 在单一事务中完成解锁、消费 checkpoint、清除状态
      // 确保进程崩溃时不会出现部分清理的中间状态
      transaction(() => {
        if (activeCharacterId) {
          characterProfileRepository.unlock(activeCharacterId);
          log.info('character profile unlocked for reset', {
            fields: { characterId: activeCharacterId, traceId }
          });

          // 消费旧 onboarding checkpoint（尝试多种 scope_key 覆盖不同阶段）
          // 首次 onboarding 期间 characterId 未设置，scope_key 使用 'default'
          // 完成后 characterId 为 activeCharacterId
          const scopeKeys = [
            `${userId}:${activeCharacterId}:default-onboarding`,
            `${userId}:default:default-onboarding`,
            `anonymous:default-roxy:default-onboarding`
          ];
          for (const scopeKey of scopeKeys) {
            const checkpoint = checkpointRepository.getActiveByScope('onboarding', scopeKey);
            if (checkpoint) {
              checkpointRepository.consume(checkpoint.id);
              log.info('old onboarding checkpoint consumed', {
                fields: { scopeKey, traceId }
              });
            }
          }
        }

        settingsRepository.set('onboarding_completed', 'false');
        settingsRepository.delete('active_character_id');
        log.info('onboarding state reset', { fields: { traceId } });
      });

      // 5. 重新启动向导（异步 Graph 执行，不能放入事务）
      return await this.startOnboarding(0);
    } catch (error) {
      log.error('resetOnboarding failed', {
        fields: { error: (error as Error)?.message, traceId }
      });
      return {
        ...initialState,
        phase: 'error',
        errorReason: 'reset-failed',
        errors: [(error as Error)?.message ?? 'unknown']
      };
    }
  }

  /**
   * 用户提交自然语言回答。
   * 从 checkpoint 恢复草稿，运行 extract_answer → merge_draft → validate_coverage。
   * 如果信息完整，进入 build_summary → review 中断。
   * 否则回到 generate_questions 中断。
   */
  async submitOnboardingAnswer(answer: string, revision: number): Promise<OnboardingStateType> {
    const defaultPackPath = `${this.appPaths.characterPacksDir}/default`;
    const traceId = `onb-answer-${Date.now()}`;
    const initialState = createInitialOnboardingState(defaultPackPath, 'default-onboarding', traceId);
    // 设置 userAction='answer' 和 lastUserInput
    // load_checkpoint 会恢复草稿，determine_stage 会路由到 extract_answer
    // W2: 传入 expectedRevision 由 load_checkpoint 校验
    return await this.onboardingRunner.run({
      ...initialState,
      userAction: 'answer',
      lastUserInput: answer,
      expectedRevision: revision
    });
  }

  /**
   * V9：用户提交结构化问题卡片回答。
   *
   * 流程与 submitOnboardingAnswer 一致，但传入 questionAnswers 而非 lastUserInput。
   * extract_answer 节点会优先走 V9 双路径：
   * - 纯选项回答：AnswerProcessor 直接构造 extraction，不调用模型
   * - 含自由文本：AnswerProcessor 拆分，自由文本交给 AnswerExtractor
   *
   * 纯选项回答不会增加模型调用次数，符合规格第十三节约束。
   */
  async submitOnboardingAnswers(
    answers: OnboardingQuestionAnswer[],
    revision: number
  ): Promise<OnboardingStateType> {
    const defaultPackPath = `${this.appPaths.characterPacksDir}/default`;
    const traceId = `onb-answers-${Date.now()}`;
    const initialState = createInitialOnboardingState(defaultPackPath, 'default-onboarding', traceId);
    return await this.onboardingRunner.run({
      ...initialState,
      userAction: 'answer',
      questionAnswers: answers,
      expectedRevision: revision
    });
  }

  /**
   * V9：为指定问题生成 AI 建议答案。
   *
   * 只读操作，不运行 Graph，不修改 Draft，不保存 checkpoint。
   * 从 checkpoint 读取当前草稿和问题，调用 SuggestionGenerator 生成建议。
   *
   * 约束（规格第十三节）：
   * - 仅 text/hybrid 题型支持建议
   * - 建议基于已确认草稿，不凭空编造未知关系或禁区
   * - 建议必须可编辑，用户提交后才正式确认
   * - 不直接保存答案、不修改 Draft、不宣布问题完成
   */
  async suggestAnswer(
    questionId: string,
    revision: number
  ): Promise<OnboardingSuggestionDto> {
    const traceId = `onb-suggest-${Date.now()}`;

    try {
      // 1. 构造 scope_key（与 load_checkpoint 一致）
      const userId = settingsRepository.get('user_id') || 'anonymous';
      const characterId = settingsRepository.get('active_character_id') || 'default';
      const threadId = 'default-onboarding';
      const scopeKey = `${userId}:${characterId}:${threadId}`;

      // 2. 只读读取 checkpoint
      const readonly = readCheckpointReadOnly(scopeKey);
      if (!readonly) {
        log.warn('suggestAnswer: no checkpoint found', { fields: { scopeKey, traceId } });
        return { ok: false, suggestion: null, reason: 'no-checkpoint', traceId };
      }

      // 3. 乐观锁校验（可选，不强制阻止）
      if (revision >= 0 && readonly.draft.revision !== revision) {
        log.warn('suggestAnswer: revision mismatch', {
          fields: { expected: revision, actual: readonly.draft.revision, traceId }
        });
        return { ok: false, suggestion: null, reason: 'stale-revision', traceId };
      }

      // 4. 查找目标问题
      const targetQuestion = readonly.currentQuestions.find((q) => q.id === questionId);
      if (!targetQuestion) {
        log.warn('suggestAnswer: question not found', {
          fields: { questionId, available: readonly.currentQuestions.map((q) => q.id), traceId }
        });
        return { ok: false, suggestion: null, reason: 'question-not-found', traceId };
      }

      // 5. 调用 SuggestionGenerator
      const result = await generateSuggestion(this.modelGateway, {
        question: targetQuestion as OnboardingQuestion,
        currentDraft: readonly.draft,
        currentStage: readonly.currentStage,
        traceId
      });

      if (!result.ok || !result.suggestion) {
        log.info('suggestAnswer: generation failed or empty', {
          fields: { reason: result.reason, traceId }
        });
        return { ok: false, suggestion: null, reason: result.reason ?? 'generation-failed', traceId };
      }

      log.info('suggestAnswer: suggestion generated', {
        fields: { questionId, length: result.suggestion.length, traceId }
      });

      return { ok: true, suggestion: result.suggestion, traceId };
    } catch (error) {
      log.error('suggestAnswer failed', {
        fields: { questionId, error: (error as Error)?.message, traceId }
      });
      return {
        ok: false,
        suggestion: null,
        reason: String((error as Error)?.message || 'unknown'),
        traceId
      };
    }
  }

  /**
   * 用户在 review 阶段返回修改意见。
   * 重置 phase='collecting'，userAction='feedback'，让 determine_stage 路由到 generate_questions。
   *
   * targetStage 存在时：确定性地路由到该阶段的 generate_questions，不调用 AnswerExtractor。
   * targetStage 不存在时：走 AnswerExtractor 自然语言提取流程。
   */
  async reviseOnboardingSummary(
    feedback: string,
    revision: number,
    targetStage?: 'basic' | 'speaking' | 'relationship' | 'taboos'
  ): Promise<OnboardingStateType> {
    const defaultPackPath = `${this.appPaths.characterPacksDir}/default`;
    const traceId = `onb-revise-${Date.now()}`;
    const initialState = createInitialOnboardingState(defaultPackPath, 'default-onboarding', traceId);
    // W2: 传入 expectedRevision 由 load_checkpoint 校验
    return await this.onboardingRunner.run({
      ...initialState,
      userAction: 'feedback',
      lastUserInput: feedback,
      expectedRevision: revision,
      targetStage: targetStage ?? null
    });
  }

  /**
   * 用户确认摘要，触发 compile_profile → persist_and_lock。
   * 完成后返回 isCompleted=true, phase='locked'。
   */
  async confirmOnboardingSummary(revision: number): Promise<OnboardingStateType> {
    const defaultPackPath = `${this.appPaths.characterPacksDir}/default`;
    const traceId = `onb-confirm-${Date.now()}`;
    const initialState = createInitialOnboardingState(defaultPackPath, 'default-onboarding', traceId);
    // W2: 传入 expectedRevision 由 load_checkpoint 校验
    return await this.onboardingRunner.run({
      ...initialState,
      userAction: 'confirm',
      expectedRevision: revision
    });
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

    // V8：同时获取 persona 和 personalityProfile
    const { persona, personalityProfile } = this.buildRuntimePersonaWithProfile(userId);

    const state = createInitialConversationState({
      event,
      userId,
      characterId,
      sessionId,
      persona,
      personalityProfile,
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

    // V8：同时获取 persona 和 personalityProfile
    const { persona, personalityProfile } = this.buildRuntimePersonaWithProfile(userId);

    const state = createInitialConversationState({
      event,
      userId,
      characterId,
      sessionId,
      persona,
      personalityProfile,
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
   * B3: 恢复 Onboarding 并应用用户偏好（V8 兼容适配层）。
   *
   * 旧版 E2E 测试使用此接口。V8 重构后，此方法作为兼容适配层：
   * - 使用基础角色包的 persona 创建 locked profile（跳过问答）
   * - 在单一事务中完成 confirmAndLock + settings + users + policy + checkpoint
   * - 保存用户偏好
   *
   * 新安装用户应使用 V8 IPC 流程（onboarding:submit-answer 等）完成完整向导。
   */
  async resumeOnboarding(preferences: Partial<UserPreferences>): Promise<boolean> {
    if (!this.pendingOnboardingState) {
      log.warn('resumeOnboarding: no pending onboarding state');
      return false;
    }

    try {
      const pack = this.characterPackManager.getActivePack();
      if (!pack) {
        log.error('resumeOnboarding: no active character pack');
        return false;
      }

      // 使用基础角色包 persona 编译兼容 profile
      const compiledProfile = compileFromExistingPersona(pack.persona, pack.manifest);
      const characterId = compiledProfile.persona.characterId;
      const userId = settingsRepository.get('user_id') || this.pendingOnboardingState.userId || 'default-user';

      log.info('resumeOnboarding: creating locked profile as compatibility adapter', {
        fields: { characterId, userId }
      });

      // B2: 单一事务，任一步失败整体回滚
      transaction(() => {
        // 1. confirmAndLock：保存 profile + 锁定 + 激活
        const lockResult = characterProfileRepository.confirmAndLock({
          characterId,
          displayName: compiledProfile.persona.characterName,
          baseCharacterId: compiledProfile.baseCharacterId,
          requirementSummary: {
            fields: {
              characterName: compiledProfile.persona.characterName,
              characterIdentity: null,
              userPetName: null,
              selfPetName: null,
              referenceCharacter: null,
              keepTraits: null,
              excludeTraits: null,
              tone: null,
              replyLength: 'medium',
              proactiveFollowUp: 'medium',
              jokeLevel: 'low',
              flirtLevel: 'low',
              tsundereLevel: 'low',
              catchphrase: null,
              forbiddenExpressions: null,
              relationshipType: null,
              intimacyLevel: 'medium',
              forbiddenBoundaries: null,
              lowMoodResponse: null,
              dangerousRequestResponse: null,
              cannotBecome: null,
              cannotSay: null,
              cannotDo: null,
              avoidAssistantFeel: null
            },
            displayText: `兼容迁移角色：${compiledProfile.persona.characterName}`,
            sourceRevision: 0,
            generatedAt: new Date().toISOString(),
            baseCharacterId: compiledProfile.baseCharacterId
          },
          persona: compiledProfile.persona,
          personalityProfile: compiledProfile.personalityProfile,
          configVersion: compiledProfile.configVersion
        });
        if (!lockResult.ok) {
          throw new Error(`confirmAndLock failed: ${lockResult.reason ?? 'unknown'}`);
        }

        const db = getDatabase();

        // 2. upsert users 表
        const existing = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
        if (!existing) {
          db.prepare('INSERT INTO users (id, nickname, preferred_name) VALUES (?, ?, ?)').run(
            userId,
            preferences.nickname ?? '',
            preferences.preferredName ?? ''
          );
        } else {
          db.prepare('UPDATE users SET nickname = ?, preferred_name = ? WHERE id = ?').run(
            preferences.nickname ?? '',
            preferences.preferredName ?? '',
            userId
          );
        }

        // 3. 写入 settings
        settingsRepository.set('onboarding_completed', 'true');
        settingsRepository.set('user_id', userId);
        settingsRepository.set('active_character_id', characterId);

        if (preferences) {
          settingsRepository.set('user_nickname', preferences.nickname ?? '');
          settingsRepository.set('user_preferred_name', preferences.preferredName ?? '');
          settingsRepository.set('reply_length', preferences.replyLength ?? 'short');
          settingsRepository.set('proactive_level', preferences.proactiveLevel ?? 'medium');
          settingsRepository.set('dnd_start', preferences.dndStart ?? '22:00');
          settingsRepository.set('dnd_end', preferences.dndEnd ?? '08:00');
          settingsRepository.set('dnd_enabled', String(preferences.dndEnabled ?? false));
          settingsRepository.set('system_notification_enabled', String(preferences.systemNotificationEnabled ?? false));
          settingsRepository.set('sound_enabled', String(preferences.soundEnabled ?? false));
          settingsRepository.set('weather_city', preferences.weatherCity ?? '');
          settingsRepository.set('weather_enabled', String(preferences.weatherEnabled ?? false));
          settingsRepository.set('weather_authorized', String(preferences.weatherEnabled ?? false));
          settingsRepository.set('memory_enabled', String(preferences.memoryEnabled ?? true));
        }

        // 4. 写入 proactive_policies
        proactivePolicyRepository.upsert(userId, characterId, {
          ...DEFAULT_PROACTIVE_POLICY,
          dndEnabled: preferences.dndEnabled ?? false,
          dndStart: preferences.dndStart ?? '23:00',
          dndEnd: preferences.dndEnd ?? '07:00',
          systemNotificationEnabled: preferences.systemNotificationEnabled ?? false,
          soundEnabled: preferences.soundEnabled ?? false
        });

        // 5. 消费 checkpoint
        const scopeKey = `${userId || 'anonymous'}:${characterId}:default-onboarding`;
        const checkpoint = checkpointRepository.getActiveByScope('onboarding', scopeKey);
        if (checkpoint) {
          checkpointRepository.consume(checkpoint.id);
        }
      });

      this.pendingOnboardingState = null;
      log.info('resumeOnboarding: completed successfully', {
        fields: { characterId, userId }
      });
      return true;
    } catch (e) {
      log.error('resumeOnboarding failed', {
        fields: { error: (e as Error)?.message }
      });
      return false;
    }
  }

  /** 处理启动事件 */
  private async handleStartup(event: AppEvent): Promise<void> {
    const onboardingCompleted = settingsRepository.get('onboarding_completed') === 'true';
    // 防御性兜底：即使 onboarding_completed 标志异常（如设置丢失、旧数据迁移不完整），
    // 只要数据库中已存在合法锁定角色，就视为已完成，避免每次启动都重复弹出初始化面板。
    const hasLockedProfile = characterProfileRepository.hasLockedCharacter();

    if (!onboardingCompleted && !hasLockedProfile) {
      // 首次启动：走 Onboarding（V8 流程）
      const defaultPackPath = `${this.appPaths.characterPacksDir}/default`;
      const state = createInitialOnboardingState(defaultPackPath);
      const result = await this.onboardingRunner.run(state);

      if (result.awaitingUserInput) {
        // V8 流程：向导在 generate_questions 或 review 暂停
        this.pendingOnboardingState = result;
        if (this.rendererCallback) {
          await this.rendererCallback({
            text: result.pendingQuestion || '让我们开始角色配置吧。',
            expression: 'waving',
            motion: 'waving'
          }, 'onboarding-request');
        }
      } else if (result.isCompleted) {
        // 可能从已保存设置直接完成（旧用户兼容）
        settingsRepository.set('onboarding_completed', 'true');
        await this.sendDeliveryToRenderer({
          channel: 'pet_bubble',
          message: '初始化完成，很高兴认识你！',
          expression: 'waving',
          motion: 'waving',
          delivered: false
        });
      } else if (result.phase === 'error') {
        log.error('onboarding ended in error state', {
          fields: { errorReason: result.errorReason, errors: result.errors }
        });
        await this.sendDeliveryToRenderer({
          channel: 'pet_bubble',
          message: '初始化遇到问题，请稍后重试。',
          expression: 'failed',
          motion: 'failed',
          delivered: false
        });
      }
    } else {
      // 已引导：发送启动摘要
      // 防御性修复：若 onboarding_completed 标志缺失/不一致，从锁定角色同步，
      // 确保 isOnboardingCompleted() 等功能入口能正确识别已初始化角色。
      if (!onboardingCompleted || !settingsRepository.get('active_character_id')) {
        const lockedProfile = characterProfileRepository.getActiveLockedProfile();
        if (lockedProfile) {
          const profileCharacterId = lockedProfile.persona.characterId;
          settingsRepository.set('onboarding_completed', 'true');
          settingsRepository.set('active_character_id', profileCharacterId);
          log.warn('handleStartup: synced onboarding settings from locked profile', {
            fields: { profileCharacterId }
          });
        }
      }

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
