/**
 * Electron 集成桥接模块。
 * 供旧 app/main.js 调用新架构（src/）的入口。
 *
 * 使用方式（在 app/main.js 中）：
 *   const { initNewArchitecture, handleChatMessage } = require('../dist/main/integration.js');
 *   initNewArchitecture({
 *     isPackaged: app.isPackaged,
 *     userDataDir: app.getPath('userData'),
 *     resourcesDir: process.resourcesPath,
 *     appRoot: __dirname,
 *     secretStore,  // 由 main.js 包装的 Electron safeStorage 实现
 *     onRendererCallback: (dto, channel) => mainWindow.webContents.send(channel, dto)
 *   });
 *   const dto = await handleChatMessage(userId, characterId, message);
 *
 * 对应架构计划第 4 节"AppEvent → GraphDispatcher → LangGraph"。
 */
import { initDatabase, closeDatabase, getDatabase } from '../infrastructure/database/connection';
import { settingsRepository } from '../infrastructure/database/repositories/settings-repository';
import { ModelGateway } from '../services/ModelGateway';
import { SkillRegistry } from '../services/SkillRegistry';
import { MemoryStore } from '../services/MemoryStore';
import { CharacterPackManager } from '../services/CharacterPackManager';
import { SchedulerService } from '../services/SchedulerService';
import { TimeService } from '../services/TimeService';
import { UserContextService } from '../services/UserContextService';
import { RuntimePersonaBuilder } from '../services/RuntimePersonaBuilder';
import { ReminderParserService } from '../services/ReminderParserService';
import { setSchedulerInstance } from '../services/reminder-scheduler-bridge';
import { DefaultPermissionGuard } from '../domain/permissions/PermissionGuard';
import { createReminderSkill } from '../skills/create-reminder';
import { listTodayScheduleSkill } from '../skills/list-today-schedule';
import { setPetExpressionSkill } from '../skills/set-pet-expression';
import { getCurrentTimeSkill } from '../skills/get-current-time';
import { AppEventBus } from './app-event-bus';
import { GraphDispatcher } from './graph-dispatcher';
import { resolveAppPaths, type AppPaths } from '../infrastructure/config/app-paths';
import { getDefaultAppConfig, applyUserModelAliases } from '../infrastructure/config/config-loader';
import type { SecretStore } from '../infrastructure/secrets/secret-store';
import { DefaultFullscreenAdapter } from '../adapters/fullscreen/FullscreenAdapter';
import { DefaultNotificationAdapter } from '../adapters/notifications/NotificationAdapter';
import { DefaultSoundAdapter } from '../adapters/sound/SoundAdapter';
import { DefaultWeatherAdapter } from '../adapters/weather/WeatherAdapter';
import { ReflectionWorker } from '../services/ReflectionWorker';
import { BackupService, type UserDataExport } from '../services/BackupService';
import { migrateLegacyJsonData } from '../infrastructure/migration/legacy-json-migrator';
import { APP_EVENT_TYPE, EVENT_SOURCE, EVENT_PRIORITY } from '../shared/constants';
import type { AppEvent } from '../shared/contracts/app-event';
import type { ResponseDTO } from '../agent/graphs/conversation/state';
import { createLogger } from '../infrastructure/logging/logger';
import * as path from 'path';

const log = createLogger('Integration');

let eventBus: AppEventBus | null = null;
let dispatcher: GraphDispatcher | null = null;
let scheduler: SchedulerService | null = null;
let characterPackManager: CharacterPackManager | null = null;
let modelGateway: ModelGateway | null = null;
let appPaths: AppPaths | null = null;
let fullscreenAdapter: DefaultFullscreenAdapter | null = null;
let timeService: TimeService | null = null;
let notificationAdapter: DefaultNotificationAdapter | null = null;
let soundAdapter: DefaultSoundAdapter | null = null;
let weatherAdapterInternal: DefaultWeatherAdapter | null = null;
let memoryStore: MemoryStore | null = null;
let reflectionWorker: ReflectionWorker | null = null;
let dailyGreetingTimer: NodeJS.Timeout | null = null;
let skillRegistry: SkillRegistry | null = null;
let schedulerStarted = false;
let reflectionWorkerStarted = false;

export interface InitOptions {
  isPackaged: boolean;
  /** Electron app.getPath('userData')，打包环境必填 */
  userDataDir?: string;
  /** process.resourcesPath，打包环境必填 */
  resourcesDir?: string;
  /** 开发模式下的应用根目录 */
  appRoot?: string;
  /** 密钥存储实现（由 main.js 包装 Electron safeStorage） */
  secretStore: SecretStore;
  /** Renderer 回调（返回是否成功送达，用于 ACK 确认） */
  onRendererCallback?: (dto: ResponseDTO, channel: string) => Promise<boolean>;
}

/**
 * 初始化新架构。
 * 在 Electron app.whenReady() 之后调用。
 */
export function initNewArchitecture(options: InitOptions): void {
  log.info('initializing new architecture', {
    fields: { isPackaged: options.isPackaged }
  });

  // 1. 解析路径
  appPaths = resolveAppPaths({
    isPackaged: options.isPackaged,
    userDataDir: options.userDataDir,
    resourcesDir: options.resourcesDir,
    appRoot: options.appRoot
  });

  // 2. 初始化数据库
  initDatabase({ path: appPaths.databasePath });

  // 2.5 迁移旧 JSON 数据到 SQLite（幂等，只执行一次）
  if (options.userDataDir) {
    const migrationResult = migrateLegacyJsonData(options.userDataDir);
    if (migrationResult.migrated) {
      log.info('legacy json migration completed', {
        fields: {
          memories: migrationResult.memoriesMigrated,
          settings: migrationResult.settingsMigrated
        }
      });
    }
  }

  // 3. 加载配置（默认配置 + 用户自定义模型别名覆盖）
  const defaultConfig = getDefaultAppConfig();
  const userModelAliases = settingsRepository.getModelAliases();
  const config = applyUserModelAliases(defaultConfig, userModelAliases);
  if (Object.keys(userModelAliases).length > 0) {
    log.info('user model aliases applied', { fields: { aliases: userModelAliases } });
  }

  // 4. 初始化 ModelGateway（使用调用方传入的 SecretStore）
  modelGateway = new ModelGateway({
    config,
    secretStore: options.secretStore,
    db: getDatabase()
  });

  // 5. 初始化 CharacterPackManager
  characterPackManager = new CharacterPackManager();
  const defaultPackPath = path.join(appPaths.characterPacksDir, 'default');
  try {
    characterPackManager.load(defaultPackPath);
  } catch (error) {
    log.warn('failed to load default character pack', {
      fields: { path: defaultPackPath, error: (error as Error)?.message }
    });
  }

  // 6. 初始化 SkillRegistry
  const permissionGuard = new DefaultPermissionGuard();
  skillRegistry = new SkillRegistry(permissionGuard);
  skillRegistry.register(createReminderSkill);
  skillRegistry.register(listTodayScheduleSkill);
  skillRegistry.register(setPetExpressionSkill);
  skillRegistry.register(getCurrentTimeSkill);

  // 7. 初始化 MemoryStore
  const memoryStoreLocal = new MemoryStore();
  memoryStore = memoryStoreLocal;

  // 7.5 初始化时间服务、用户上下文、运行时 Persona 构建器、提醒解析服务
  timeService = new TimeService('Asia/Shanghai');
  const userContextService = new UserContextService();
  const runtimePersonaBuilder = new RuntimePersonaBuilder();
  const reminderParserService = new ReminderParserService(timeService, modelGateway);

  // 8. 初始化适配器（ProactiveGraph 依赖）
  // 通知/声音初始状态从设置读取，键名与 Onboarding 保存时一致。
  // 默认关闭：仅当 Onboarding 明确授权后才启用。
  fullscreenAdapter = new DefaultFullscreenAdapter();
  const notifEnabled = settingsRepository.get('system_notification_enabled') === 'true';
  const notifSoundEnabled = settingsRepository.get('sound_enabled') === 'true';
  const soundEnabled = settingsRepository.get('sound_enabled') === 'true';
  notificationAdapter = new DefaultNotificationAdapter(notifEnabled, notifSoundEnabled);
  soundAdapter = new DefaultSoundAdapter(soundEnabled);
  const weatherAdapter = new DefaultWeatherAdapter();
  weatherAdapterInternal = weatherAdapter;
  // 从设置初始化天气授权状态
  const weatherEnabled = settingsRepository.get('weather_enabled') === 'true';
  const weatherAuthorized = settingsRepository.get('weather_authorized') === 'true';
  weatherAdapter.updateSettings(weatherEnabled, weatherAuthorized);

  // 9. 初始化 EventBus 和 GraphDispatcher
  eventBus = new AppEventBus();
  dispatcher = new GraphDispatcher({
    skillRegistry,
    modelGateway,
    memoryStore: memoryStoreLocal,
    characterPackManager,
    appPaths,
    fullscreenAdapter,
    notificationAdapter,
    soundAdapter,
    weatherAdapter,
    timeService,
    userContextService,
    runtimePersonaBuilder,
    reminderParserService
  });

  if (options.onRendererCallback) {
    dispatcher.setRendererCallback(options.onRendererCallback);
  }

  // 10. 初始化 Scheduler
  // handler 改为 async，直接调用 dispatcher 并等待完成，
  // 返回 true 确认投递成功；返回 false 则 occurrence 保持 pending 等待重试。
  scheduler = new SchedulerService(timeService);
  // 注册到 bridge，让技能层能通知调度器新提醒创建
  setSchedulerInstance(scheduler);
  scheduler.onReminderDue(async (event) => {
    log.info('reminder due, dispatching', {
      fields: { reminderId: event.reminderId }
    });
    const appEvent: AppEvent = {
      schemaVersion: 1,
      eventId: event.reminderOccurrenceId,
      type: APP_EVENT_TYPE.REMINDER_DUE,
      occurredAt: new Date().toISOString(),
      timezone: 'Asia/Shanghai',
      source: EVENT_SOURCE.SCHEDULER,
      userId: settingsRepository.get('user_id') ?? 'default-user',
      characterId: settingsRepository.get('active_character_id')
        ?? characterPackManager!.getActiveCharacterId()
        ?? 'default-roxy',
      correlationId: `reminder-${event.reminderId}`,
      dedupeKey: `reminder:${event.reminderId}:${event.reminderOccurrenceId}`,
      priority: event.priority as 'low' | 'normal' | 'high',
      payload: {
        reminderId: event.reminderId,
        reminderOccurrenceId: event.reminderOccurrenceId,
        content: event.content,
        priority: event.priority
      }
    };
    try {
      // 直接调用 dispatcher 并等待 Graph 完成，获取投递结果
      const deliveryResult = await dispatcher!.dispatch(appEvent);

      // 根据投递结果决定是否标记 delivered：
      // - delivered=true (pet_bubble/system_notification): 投递成功
      // - deferred: 未投递，保持 pending 等待全屏退出/勿扰结束后补发
      // - suppressed: 被策略抑制，标记 delivered 避免重复触发
      // - null: dispatch 出错或未返回结果，保持 pending 重试
      if (!deliveryResult) {
        log.warn('no delivery result, occurrence stays pending', {
          fields: { reminderId: event.reminderId }
        });
        return false;
      }

      if (deliveryResult.delivered) {
        return true;
      }

      // delivered=false
      if (deliveryResult.channel === 'suppressed') {
        // 被策略抑制（如勿扰+非提醒类型），标记 delivered 避免重复触发
        return true;
      }

      // deferred：保持 pending，等待补发
      log.info('delivery deferred, occurrence stays pending for retry', {
        fields: { reminderId: event.reminderId, channel: deliveryResult.channel }
      });
      return false;
    } catch (error) {
      log.warn('reminder dispatch failed, occurrence will retry', {
        fields: { reminderId: event.reminderId, error: (error as Error)?.message }
      });
      return false;
    }
  });

  // 注册 EventBus → Dispatcher 路由（用于 startup 等其他事件）
  eventBus.onAny(async (event) => {
    await dispatcher!.dispatch(event);
  });

  // 11. 初始化 Reflection worker（后台异步处理反思任务）
  reflectionWorker = new ReflectionWorker({ modelGateway });

  // 12. 启动每日问候定时器（每天 09:00 发布 DAILY_GREETING_DUE 事件）
  scheduleDailyGreeting(9, 0);

  log.info('new architecture initialized');
}

/**
 * 获取当前用户 ID。优先从 SQLite 设置读取，回退到 'default-user'。
 * 供旧 main.js IPC 调用，避免硬编码用户 ID。
 */
export function getUserId(): string {
  return settingsRepository.get('user_id') ?? 'default-user';
}

/**
 * 处理聊天消息（供旧 main.js IPC 调用）。
 * 使用 dispatchChat 直接获取结果，避免临时替换全局回调的竞争风险。
 * 期间若触发主动提醒，结果会通过 rendererCallback 正常送达。
 */
export async function handleChatMessage(
  userId: string,
  characterId: string,
  message: string,
  sessionId?: string
): Promise<ResponseDTO | null> {
  if (!dispatcher) {
    log.error('dispatcher not initialized, call initNewArchitecture first');
    return null;
  }

  // 如果传入的是默认值或空，从设置读取真实 userId
  if (!userId || userId === 'default-user') {
    const savedUserId = settingsRepository.get('user_id');
    if (savedUserId) {
      userId = savedUserId;
    }
  }

  // 直接调用 dispatchChat，不再临时替换 rendererCallback
  return dispatcher.dispatchChat(userId, characterId, message, sessionId);
}

/**
 * 发布启动事件（供 app/main.js 在窗口加载完成后调用）。
 * 触发 OnboardingGraph（首次启动）或 ProactiveGraph（已引导后的日报/问候）。
 */
export function publishStartupEvent(): void {
  if (!dispatcher) {
    log.warn('cannot publish startup event, dispatcher not initialized');
    return;
  }
  const event: AppEvent = {
    schemaVersion: 1,
    eventId: `evt-startup-${Date.now()}`,
    type: APP_EVENT_TYPE.STARTUP,
    occurredAt: new Date().toISOString(),
    timezone: 'Asia/Shanghai',
    source: EVENT_SOURCE.SYSTEM,
    userId: settingsRepository.get('user_id') ?? 'default-user',
    characterId: settingsRepository.get('active_character_id')
      ?? characterPackManager?.getActiveCharacterId()
      ?? 'default-roxy',
    correlationId: `startup-${Date.now()}`,
    priority: EVENT_PRIORITY.NORMAL,
    payload: {}
  };
  dispatcher.dispatch(event).catch((error) => {
    log.error('startup event dispatch failed', {
      fields: { error: (error as Error)?.message }
    });
  });
}

/**
 * 提交 onboarding 用户偏好并恢复 OnboardingGraph。
 * 调用 OnboardingGraphRunner.resumeWithPreferences 完成剩余流程：
 * build_persona → configure_proactive_policy → configure_model_mode
 * → save_onboarding_result → activate_character → finish
 * 完成后刷新适配器设置，确保用户的通知/声音偏好立即生效。
 * 返回 true 表示 onboarding 已完成。
 */
export async function resumeOnboardingWithPreferences(
  preferences: Record<string, unknown>
): Promise<boolean> {
  if (!dispatcher) {
    log.warn('cannot resume onboarding, dispatcher not initialized');
    return false;
  }
  const completed = await dispatcher.resumeOnboarding(preferences);
  if (completed) {
    // Onboarding 完成后刷新适配器，使新保存的设置立即生效
    refreshAdapters();
  }
  return completed;
}

/**
 * 从设置重新读取通知/声音开关并更新适配器。
 * 在 Onboarding 完成或设置变更后调用。
 */
export function refreshAdapters(): void {
  const notifEnabled = settingsRepository.get('system_notification_enabled') === 'true';
  const soundEnabled = settingsRepository.get('sound_enabled') === 'true';
  if (notificationAdapter) {
    notificationAdapter.updateSettings(notifEnabled, soundEnabled);
    log.info('notification adapter refreshed', {
      fields: { notificationEnabled: notifEnabled, soundEnabled }
    });
  }
  if (soundAdapter) {
    soundAdapter.setEnabled(soundEnabled);
    log.info('sound adapter refreshed', {
      fields: { soundEnabled }
    });
  }
  // 刷新天气适配器授权状态
  const weatherEnabled = settingsRepository.get('weather_enabled') === 'true';
  const weatherAuthorized = settingsRepository.get('weather_authorized') === 'true';
  if (weatherAdapterInternal) {
    weatherAdapterInternal.updateSettings(weatherEnabled, weatherAuthorized);
    log.info('weather adapter refreshed', {
      fields: { weatherEnabled, weatherAuthorized }
    });
  }
}

/** 启动 Scheduler 和 Reflection worker */
export function startScheduler(): void {
  if (scheduler) {
    scheduler.start();
    schedulerStarted = true;
  }
  if (reflectionWorker) {
    reflectionWorker.start();
    reflectionWorkerStarted = true;
  }
}

/** 停止 Scheduler 和 Reflection worker */
export function stopScheduler(): void {
  if (scheduler) {
    scheduler.stop();
    schedulerStarted = false;
  }
  if (reflectionWorker) {
    reflectionWorker.stop();
    reflectionWorkerStarted = false;
  }
  stopDailyGreeting();
}

/** 停止每日问候定时器 */
function stopDailyGreeting(): void {
  if (dailyGreetingTimer) {
    clearTimeout(dailyGreetingTimer);
    dailyGreetingTimer = null;
    log.info('daily greeting timer stopped');
  }
}

/**
 * 调度每日问候。
 * 每天在指定时间（默认 09:00）发布 DAILY_GREETING_DUE 事件。
 * 如果今天的时间已过，调度到明天。
 */
export function scheduleDailyGreeting(hour = 9, minute = 0): void {
  stopDailyGreeting();

  const now = new Date();
  const target = new Date();
  target.setHours(hour, minute, 0, 0);
  if (target <= now) {
    target.setDate(target.getDate() + 1);
  }
  const delay = target.getTime() - now.getTime();

  log.info('scheduling daily greeting', {
    fields: { target: target.toISOString(), delayMs: delay }
  });

  dailyGreetingTimer = setTimeout(() => {
    publishDailyGreeting();
    // 递归调度下一天
    scheduleDailyGreeting(hour, minute);
  }, delay);
}

/** 发布每日问候事件 */
function publishDailyGreeting(): void {
  if (!dispatcher) {
    log.warn('cannot publish daily greeting, dispatcher not initialized');
    return;
  }
  const event: AppEvent = {
    schemaVersion: 1,
    eventId: `evt-daily-${Date.now()}`,
    type: APP_EVENT_TYPE.DAILY_GREETING_DUE,
    occurredAt: new Date().toISOString(),
    timezone: 'Asia/Shanghai',
    source: EVENT_SOURCE.SYSTEM,
    userId: settingsRepository.get('user_id') ?? 'default-user',
    characterId: settingsRepository.get('active_character_id')
      ?? characterPackManager?.getActiveCharacterId()
      ?? 'default-roxy',
    correlationId: `daily-greeting-${Date.now()}`,
    dedupeKey: `daily-greeting:${new Date().toISOString().slice(0, 10)}`,
    priority: EVENT_PRIORITY.NORMAL,
    payload: { greetingType: 'morning' as const }
  };
  dispatcher.dispatch(event).catch((error) => {
    log.error('daily greeting dispatch failed', {
      fields: { error: (error as Error)?.message }
    });
  });
  log.info('daily greeting event published');
}

/** 关闭新架构（应用退出时调用） */
export function shutdownNewArchitecture(): void {
  stopScheduler();
  closeDatabase();
  log.info('new architecture shut down');
}

/** 获取已初始化的 CharacterPackManager */
export function getCharacterPackManager(): CharacterPackManager | null {
  return characterPackManager;
}

/** 获取已初始化的 AppPaths */
export function getAppPaths(): AppPaths | null {
  return appPaths;
}

/** 获取已初始化的 FullscreenAdapter（供 main.js 推入全屏状态变化） */
export function getFullscreenAdapter(): DefaultFullscreenAdapter | null {
  return fullscreenAdapter;
}

/** 获取已初始化的 TimeService */
export function getTimeService(): TimeService | null {
  return timeService;
}

/** 检查是否已初始化 */
export function isInitialized(): boolean {
  return dispatcher !== null;
}

// ===== 架构状态查询 =====

export interface ArchitectureStatus {
  runtime: 'langgraph' | 'legacy';
  initialized: boolean;
  databaseReady: boolean;
  databasePathExists: boolean;
  databasePath: string | null;
  activeCharacterId: string;
  schedulerRunning: boolean;
  reflectionWorkerRunning: boolean;
  registeredSkills: string[];
  lastInitializationError: string | null;
}

/**
 * 获取新架构运行时状态。供 main.js 的 architecture:get-status IPC 使用。
 * initError 由 main.js 传入（初始化失败时记录的错误信息）。
 */
export function getArchitectureStatus(initError: string | null = null): ArchitectureStatus {
  const initialized = dispatcher !== null;
  let databaseReady = false;
  let databasePathExists = false;
  const dbPath = appPaths?.databasePath ?? null;
  if (dbPath) {
    try {
      const fs = require('fs');
      databasePathExists = fs.existsSync(dbPath);
    } catch { /* ignore */ }
    try {
      const { getDatabase } = require('../infrastructure/database/connection');
      const db = getDatabase();
      db.prepare('SELECT 1').get();
      databaseReady = true;
    } catch { /* database not ready */ }
  }
  const activeCharacterId = characterPackManager?.getActiveCharacterId() ?? '';
  const skills = skillRegistry?.list?.() ?? [];
  return {
    runtime: initialized ? 'langgraph' : 'legacy',
    initialized,
    databaseReady,
    databasePathExists,
    databasePath: dbPath,
    activeCharacterId,
    schedulerRunning: schedulerStarted,
    reflectionWorkerRunning: reflectionWorkerStarted,
    registeredSkills: skills.map((s) => s.id),
    lastInitializationError: initError
  };
}

/**
 * 获取所有活跃提醒。供 State 面板展示。
 */
export function getActiveReminders(): Array<{
  id: string;
  content: string;
  triggerAt: string;
  nextTriggerAt: string;
  isActive: boolean;
  isRepeating: boolean;
  priority: string;
}> {
  if (!dispatcher) return [];
  try {
    const { reminderRepository } = require('../infrastructure/database/repositories/reminder-repository');
    return reminderRepository.getActiveReminders().map((r: any) => ({
      id: r.id,
      content: r.content,
      triggerAt: r.trigger_at,
      nextTriggerAt: r.next_trigger_at,
      isActive: r.is_active === 1,
      isRepeating: r.is_repeating === 1,
      priority: r.priority
    }));
  } catch {
    return [];
  }
}

/**
 * 删除提醒（按 ID）。供 State 面板操作。
 */
export function deleteReminder(id: string): { deleted: boolean } {
  if (!dispatcher) return { deleted: false };
  try {
    const { reminderRepository } = require('../infrastructure/database/repositories/reminder-repository');
    reminderRepository.delete(id);
    // 通知调度器清除对应的定时器
    scheduler?.cancel(id);
    return { deleted: true };
  } catch {
    return { deleted: false };
  }
}

// ===== 角色包视觉渲染 =====

/** 角色渲染配置 DTO（Main → Renderer） */
export interface CharacterRenderConfig {
  characterId: string;
  rendererType: 'spritesheet' | 'placeholder';
  /** 精灵图 URL（pet-character:// 协议） */
  spriteSheetUrl: string;
  cellWidth: number;
  cellHeight: number;
  sheetWidth: number;
  sheetHeight: number;
  /** 动画行映射 */
  rows: Record<string, { row: number; frames: number; fps: number }>;
  /** 回退状态名 */
  fallbackState: string;
}

/**
 * 生成角色渲染配置。
 * 从当前激活角色包读取 spritesheet metadata，
 * 生成 pet-character:// URL 供 renderer 加载。
 * 角色包未加载或 metadata 无效时返回 placeholder 配置。
 */
export function getCharacterRenderConfig(): CharacterRenderConfig | null {
  if (!characterPackManager) return null;

  const pack = characterPackManager.getActivePack();
  if (!pack) return null;

  const characterId = pack.manifest.id;
  const spritesheetConfig = pack.manifest.renderers.spritesheet;
  const atlasPath = spritesheetConfig.atlas;
  const metadataPath = spritesheetConfig.metadata;

  // 使用 SpriteSheetRenderer 加载并校验 metadata
  const { SpriteSheetRenderer } = require('../services/character/SpriteSheetRenderer');
  const renderer = new SpriteSheetRenderer({
    atlasPath,
    metadataPath,
    packRoot: pack.packPath
  });
  const loaded = renderer.load();

  if (!loaded.valid) {
    log.warn('character render config: spritesheet invalid, using placeholder', {
      fields: { errors: loaded.errors }
    });
    return {
      characterId,
      rendererType: 'placeholder',
      spriteSheetUrl: '',
      cellWidth: 192,
      cellHeight: 208,
      sheetWidth: 1536,
      sheetHeight: 1872,
      rows: {},
      fallbackState: 'waving'
    };
  }

  const meta = loaded.metadata;
  // 使用 pet-character:// 协议 URL，限制资源访问在角色包目录内
  // 例：pet-character://default-roxy/spritesheet/atlas.webp
  const spriteSheetUrl = `pet-character://${characterId}/${atlasPath}`;

  log.info('character render config generated', {
    fields: {
      characterId,
      cellSize: `${meta.cellWidth}x${meta.cellHeight}`,
      sheetSize: `${meta.sheetWidth}x${meta.sheetHeight}`,
      rowCount: Object.keys(meta.rows).length
    }
  });

  return {
    characterId,
    rendererType: 'spritesheet',
    spriteSheetUrl,
    cellWidth: meta.cellWidth,
    cellHeight: meta.cellHeight,
    sheetWidth: meta.sheetWidth,
    sheetHeight: meta.sheetHeight,
    rows: meta.rows as Record<string, { row: number; frames: number; fps: number }>,
    fallbackState: meta.fallbackState
  };
}

/**
 * 获取当前激活角色包的根目录路径。
 * 供 main.js 注册 pet-character:// 协议时解析文件路径。
 */
export function getActiveCharacterPackPath(): string | null {
  if (!characterPackManager) return null;
  return characterPackManager.getActivePack()?.packPath ?? null;
}

// ===== 记忆管理桥接函数 =====
// 将旧版记忆 UI 的 API（user/longTerm/shortTerm）桥接到新 SQLite MemoryStore。
// 旧版 'user' → 新版 scope='global'（用户档案）
// 旧版 'longTerm' → 新版 scope='character'（角色相关记忆）
// 旧版 'shortTerm' → 新版不存储（由 ConversationGraph 在上下文中管理）

/** 旧类型 → 新类型映射 */
function mapMemoryType(oldType: string): { scope: 'global' | 'character'; types: string[] } {
  if (oldType === 'user') {
    return { scope: 'global', types: ['profile', 'preference'] };
  }
  if (oldType === 'longTerm') {
    return { scope: 'character', types: ['event', 'relationship', 'project'] };
  }
  // shortTerm 或其他：返回空
  return { scope: 'character', types: [] };
}

/** 将 MemoryRow 映射为旧版 UI 兼容格式 */
function toUiMemory(row: any): any {
  return {
    id: row.id,
    content: row.content,
    source: row.source_message_id || 'reflection',
    importance: row.confidence,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sourceOccurredAt: row.source_occurred_at ?? null,
    writeTimezone: row.write_timezone ?? null,
    sourceRole: row.source_role ?? 'user',
    tags: []
  };
}

/** 获取记忆列表（供旧版 IPC memory:list 调用） */
export function getMemories(memType: string): any[] {
  if (!memoryStore) return [];
  const userId = getUserId();
  const characterId = characterPackManager?.getActiveCharacterId() ?? 'default-roxy';

  if (memType === 'shortTerm') {
    // 新架构中短期记忆由 ConversationGraph 在上下文中管理，不持久化到此表
    return [];
  }

  const mapping = mapMemoryType(memType);
  if (mapping.types.length === 0) return [];

  // 获取该用户+角色的所有记忆，然后按 scope 过滤
  const all = memoryStore.retrieve(userId, characterId, {});
  return all
    .filter((row: any) => {
      if (mapping.scope === 'global') return row.scope === 'global';
      return row.scope === 'character' && mapping.types.includes(row.type);
    })
    .map(toUiMemory);
}

/** 添加记忆（供旧版 IPC memory:add 调用） */
export function addMemory(memType: string, content: string, _options?: any): any {
  if (!memoryStore) throw new Error('memory store not initialized');
  if (!content || !content.trim()) throw new Error('Memory content is empty.');

  const userId = getUserId();
  const characterId = characterPackManager?.getActiveCharacterId() ?? 'default-roxy';
  const id = `mem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  if (memType === 'shortTerm') {
    // 短期记忆不持久化
    return { id, content, skipped: true, reason: 'shortTerm not persisted in new arch' };
  }

  const mapping = mapMemoryType(memType);
  const type = mapping.types[0] || 'event';

  memoryStore.add({
    id,
    userId,
    characterId: mapping.scope === 'character' ? characterId : undefined,
    scope: mapping.scope,
    type: type as any,
    content: content.trim().slice(0, 1000),
    confidence: 1.0
  });

  return { id, content: content.trim(), added: true };
}

/** 更新记忆（供旧版 IPC memory:update 调用） */
export function updateMemory(memType: string, id: string, patch: any): any {
  if (!memoryStore) throw new Error('memory store not initialized');
  if (!id) throw new Error('Memory id is required.');

  const userId = getUserId();
  const characterId = characterPackManager?.getActiveCharacterId() ?? 'default-roxy';

  memoryStore.update(id, {
    content: patch?.content,
    confidence: patch?.importance
  }, { userId, characterId });

  return { id, updated: true };
}

/** 删除记忆（供旧版 IPC memory:delete 调用） */
export function deleteMemory(_memType: string, id: string): any {
  if (!memoryStore) throw new Error('memory store not initialized');
  if (!id) throw new Error('Memory id is required.');

  const userId = getUserId();
  const characterId = characterPackManager?.getActiveCharacterId() ?? 'default-roxy';

  memoryStore.delete(id, { userId, characterId });
  return { deleted: true };
}

/** 按类型清空记忆（供旧版 IPC memory:clear-type 调用） */
export function clearMemoriesByType(memType: string): { removed: number } {
  if (!memoryStore) return { removed: 0 };
  const userId = getUserId();
  const characterId = characterPackManager?.getActiveCharacterId() ?? 'default-roxy';

  if (memType === 'shortTerm') {
    return { removed: 0 };
  }

  if (memType === 'user') {
    // 清空全局记忆（带作用域校验）
    const all = memoryStore.retrieve(userId, characterId, {});
    let count = 0;
    for (const row of all) {
      if (row.scope === 'global') {
        memoryStore.delete(row.id, { userId, characterId });
        count++;
      }
    }
    return { removed: count };
  }

  if (memType === 'longTerm') {
    // 清空角色记忆（保留全局）
    const count = memoryStore.clearCharacter(userId, characterId);
    return { removed: count };
  }

  return { removed: 0 };
}

/** 清空全部记忆（供旧版 IPC memory:clear-all 调用） */
export function clearAllMemoriesNewArch(): { removed: { user: number; longTerm: number; shortTerm: number } } {
  if (!memoryStore) return { removed: { user: 0, longTerm: 0, shortTerm: 0 } };
  const userId = getUserId();
  const characterId = characterPackManager?.getActiveCharacterId() ?? 'default-roxy';

  // 分别统计全局和角色记忆数量
  const all = memoryStore.retrieve(userId, characterId, {});
  let userCount = 0;
  let longTermCount = 0;
  for (const row of all) {
    if (row.scope === 'global') userCount++;
    else longTermCount++;
  }

  memoryStore.clearAll(userId);
  return { removed: { user: userCount, longTerm: longTermCount, shortTerm: 0 } };
}

/**
 * 导出当前用户的全部数据（记忆、提醒、任务、会话、消息、设置）。
 * 不包含 API Key、密钥和 checkpoint 内部状态。
 * 由 main.js 的 memory:export IPC handler 调用。
 */
export function exportUserData(): UserDataExport {
  const userId = getUserId();
  return BackupService.exportUserData(userId);
}
