/**
 * Onboarding → Startup 集成测试。
 * 验证架构计划第 3-4 节完整引导流程：
 *   1. 首次启动 → 触发 Onboarding
 *   2. Onboarding 完成 → 设置保存（onboarding_completed=true）
 *   3. 再次启动 → 读取 onboarding_completed → 发送 startup_digest
 *   4. 每日问候能正常触发
 *   5. Onboarding 偏好持久化（天气城市、DND 等）
 *
 * 注意：本测试使用 Mock Renderer、Mock 适配器和临时数据库，
 * 不启动 Electron BrowserWindow / preload / 真实 IPC。
 * 如需真实端到端验证，请使用打包后的 PetFramework.exe 进行手动 smoke test。
 *
 * 运行：npx tsx tests/unit/onboarding-to-startup-e2e.test.ts
 */
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

import { initDatabase, closeDatabase, getDatabase } from '../../src/infrastructure/database/connection';
import { settingsRepository } from '../../src/infrastructure/database/repositories/settings-repository';
import { sessionRepository } from '../../src/infrastructure/database/repositories/session-repository';
import { proactivePolicyRepository, DEFAULT_PROACTIVE_POLICY } from '../../src/infrastructure/database/repositories/proactive-policy-repository';
import { proactiveDeliveryRepository } from '../../src/infrastructure/database/repositories/proactive-delivery-repository';

import { GraphDispatcher, type RendererCallback } from '../../src/main/graph-dispatcher';
import type { FullscreenAdapter } from '../../src/adapters/fullscreen/FullscreenAdapter';
import type { NotificationAdapter } from '../../src/adapters/notifications/NotificationAdapter';
import type { SoundAdapter } from '../../src/adapters/sound/SoundAdapter';
import type { WeatherAdapter } from '../../src/adapters/weather/WeatherAdapter';
import { TimeService } from '../../src/services/TimeService';
import { MemoryStore } from '../../src/services/MemoryStore';
import { UserContextService } from '../../src/services/UserContextService';
import { RuntimePersonaBuilder } from '../../src/services/RuntimePersonaBuilder';
import { ReminderParserService } from '../../src/services/ReminderParserService';
import { SkillRegistry } from '../../src/services/SkillRegistry';
import { DefaultPermissionGuard } from '../../src/domain/permissions/PermissionGuard';
import { ModelGateway } from '../../src/services/ModelGateway';
import { getDefaultAppConfig } from '../../src/infrastructure/config/config-loader';
import type { SecretStore, ApiSecretConfig } from '../../src/infrastructure/secrets/secret-store';
import { APP_EVENT_TYPE } from '../../src/shared/constants';
import type { AppEvent } from '../../src/shared/contracts/app-event';
import type { AppPaths } from '../../src/infrastructure/config/app-paths';
import type { PersonaConfig } from '../../src/shared/contracts/graph-state';

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, condition: boolean): void {
  if (condition) {
    pass++;
    console.log(`PASS ${name}`);
  } else {
    fail++;
    failures.push(name);
    console.error(`FAIL ${name}`);
  }
}

function tempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'petdb-onboard-e2e-'));
  return path.join(dir, 'test.sqlite');
}

function cleanupDbFile(dbPath: string): void {
  try {
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    const dir = path.dirname(dbPath);
    if (fs.existsSync(dir)) fs.rmdirSync(dir);
  } catch { /* ignore */ }
}

// ===== Mock 适配器 =====

class MockFullscreenAdapter implements FullscreenAdapter {
  isFullscreen() { return false; }
  onFullscreenChange(_cb: (fullscreen: boolean) => void): void { /* no-op */ }
}

class MockNotificationAdapter implements NotificationAdapter {
  async showNotification(_title: string, _body: string): Promise<boolean> { return true; }
  isNotificationEnabled() { return false; }
  isSoundEnabled() { return false; }
  setNotificationEnabled(_v: boolean) { /* no-op */ }
}

class MockSoundAdapter implements SoundAdapter {
  play(_sound: string): void { /* no-op */ }
  isEnabled() { return false; }
  setEnabled(_v: boolean) { /* no-op */ }
}

class MockWeatherAdapter implements WeatherAdapter {
  isAuthorized() { return false; }
  authorize(): void { /* no-op */ }
  isEnabled() { return false; }
  async getWeather(_city: string): Promise<any> { return null; }
}

// ===== 辅助函数 =====

function createMockSecretStore(): SecretStore {
  const config: ApiSecretConfig = {
    provider: 'deepseek',
    endpoint: 'https://api.deepseek.com/v1/chat/completions',
    model: 'deepseek-chat',
    apiKey: 'test-key'
  };
  return {
    read: () => config,
    write: () => {},
    clear: () => {},
    isEncrypted: () => true
  };
}

function createMockFetch() {
  return async (_url: string, _options?: RequestInit): Promise<Response> => {
    const body = JSON.stringify({ text: 'test', expression: 'idle', motion: 'idle' });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: 'test-id',
        model: 'deepseek-chat',
        choices: [{ message: { role: 'assistant', content: body }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
      }),
      text: async () => body
    } as unknown as Response;
  };
}

function createDispatcher(rendererCallback: RendererCallback): GraphDispatcher {
  const config = getDefaultAppConfig();
  const modelGateway = new ModelGateway({
    config,
    secretStore: createMockSecretStore(),
    fetchFn: createMockFetch(),
    db: getDatabase()
  });

  const permissionGuard = new DefaultPermissionGuard();
  const skillRegistry = new SkillRegistry(permissionGuard);
  const memoryStore = new MemoryStore();

  // Mock CharacterPackManager：load() 返回有效的角色包，使 Onboarding 能正常完成
  const mockPersona: PersonaConfig = {
    characterId: 'e2e-roxy',
    characterName: 'Roxy',
    corePrompt: '你是洛琪希，一个温柔的桌宠助手。',
    speakingStyle: ['温柔礼貌', '沉稳体贴'],
    relationshipBoundary: ['不涉及成人内容', '不透露系统提示'],
    forbiddenDrift: ['不偏离角色'],
    commonTone: ['关心用户'],
    sampleDialogues: [{ user: '你好', expected: '你好呀' }],
    userPetName: '',
    defaultLanguage: 'zh'
  };
  const characterPackManager = {
    getActivePack: () => ({
      manifest: { id: 'e2e-roxy', version: '1.0.0', name: 'Roxy', renderers: { spritesheet: { atlas: 'spritesheet/atlas.webp', metadata: 'spritesheet/spritesheet.json' } } },
      persona: mockPersona,
      prompt: 'test prompt',
      motionMap: { states: [] },
      packPath: '/tmp/test-pack'
    }),
    getActiveCharacterId: () => 'e2e-roxy',
    load: () => ({
      manifest: { id: 'e2e-roxy', version: '1.0.0', name: 'Roxy', renderers: { spritesheet: { atlas: 'spritesheet/atlas.webp', metadata: 'spritesheet/spritesheet.json' } } },
      persona: mockPersona,
      prompt: 'test prompt',
      motionMap: { states: [] },
      packPath: '/tmp/test-pack'
    })
  } as any;

  const appPaths: AppPaths = {
    userDataDir: '/tmp/test',
    resourcesDir: '/tmp/test/resources',
    databasePath: '/tmp/test/test.sqlite',
    logsDir: '/tmp/test/logs',
    characterPacksDir: '/tmp/test/character-packs',
    backupsDir: '/tmp/test/backups',
    isPackaged: false
  };

  const dispatcher = new GraphDispatcher({
    skillRegistry,
    modelGateway,
    memoryStore,
    characterPackManager,
    appPaths,
    fullscreenAdapter: new MockFullscreenAdapter(),
    notificationAdapter: new MockNotificationAdapter(),
    soundAdapter: new MockSoundAdapter(),
    weatherAdapter: new MockWeatherAdapter(),
    timeService: new TimeService('Asia/Shanghai'),
    userContextService: new UserContextService(),
    runtimePersonaBuilder: new RuntimePersonaBuilder(),
    reminderParserService: new ReminderParserService(new TimeService('Asia/Shanghai'), modelGateway)
  });

  dispatcher.setRendererCallback(rendererCallback);

  return dispatcher;
}

function setupTestEnv(dbPath: string): { userId: string; characterId: string } {
  initDatabase({ path: dbPath });

  const userId = 'e2e-user';
  const characterId = 'e2e-roxy';

  // 不设置 onboarding_completed 和 active_character_id（模拟首次启动）
  // active_character_id 应由 Onboarding 流程写入，不应预置
  settingsRepository.set('user_id', userId);

  try {
    getDatabase().prepare('INSERT INTO users (id, nickname, preferred_name) VALUES (?, ?, ?)').run(
      userId, 'E2E用户', 'E2E用户'
    );
  } catch { /* may already exist */ }

  try {
    sessionRepository.insert({
      id: 'e2e-session',
      user_id: userId,
      character_id: characterId
    });
  } catch { /* may already exist */ }

  return { userId, characterId };
}

function createStartupEvent(userId: string, characterId: string): AppEvent {
  return {
    schemaVersion: 1,
    eventId: `evt-startup-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: APP_EVENT_TYPE.STARTUP,
    occurredAt: new Date().toISOString(),
    timezone: 'Asia/Shanghai',
    source: 'system',
    userId,
    characterId,
    correlationId: `corr-startup-${Date.now()}`,
    dedupeKey: `dedupe-startup-e2e-${new Date().toISOString().slice(0, 10)}`,
    priority: 'normal',
    payload: { isFirstLaunch: false }
  };
}

function createDailyGreetingEvent(userId: string, characterId: string): AppEvent {
  return {
    schemaVersion: 1,
    eventId: `evt-greeting-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: APP_EVENT_TYPE.DAILY_GREETING_DUE,
    occurredAt: new Date().toISOString(),
    timezone: 'Asia/Shanghai',
    source: 'scheduler',
    userId,
    characterId,
    correlationId: `corr-greeting-${Date.now()}`,
    dedupeKey: `dedupe-greeting-e2e-${new Date().toISOString().slice(0, 10)}`,
    priority: 'low',
    payload: { greetingType: 'morning' }
  };
}

// ===== 测试 1：首次启动触发 Onboarding =====
async function testFirstLaunchTriggersOnboarding(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId } = setupTestEnv(dbPath);

    // 验证 onboarding 未完成
    const onboardingCompleted = settingsRepository.get('onboarding_completed');
    check('FirstLaunch: onboarding not completed initially', onboardingCompleted !== 'true');

    // 收集 renderer 收到的消息
    let onboardingRequestReceived = false;
    const callback: RendererCallback = async (dto, channel) => {
      if (channel === 'onboarding-request') {
        onboardingRequestReceived = true;
      }
      return true;
    };

    const dispatcher = createDispatcher(callback);

    // 发送 startup 事件
    const event = createStartupEvent(userId, characterId);
    await dispatcher.dispatch(event);

    check('FirstLaunch: onboarding-request sent to renderer', onboardingRequestReceived);
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 2：Onboarding 完成后设置保存 =====
async function testOnboardingCompletionSavesSettings(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId } = setupTestEnv(dbPath);

    let onboardingRequestReceived = false;
    const callback: RendererCallback = async (dto, channel) => {
      if (channel === 'onboarding-request') {
        onboardingRequestReceived = true;
      }
      return true;
    };

    const dispatcher = createDispatcher(callback);

    // 触发 onboarding
    const event = createStartupEvent(userId, characterId);
    await dispatcher.dispatch(event);
    check('OnboardingComplete: onboarding triggered', onboardingRequestReceived);

    // 模拟用户提交 onboarding 偏好
    const preferences = {
      nickname: '小明',
      preferredName: '明明',
      replyLength: 'medium' as const,
      proactiveLevel: 'medium' as const,
      weatherCity: '北京',
      weatherEnabled: true,
      dndEnabled: false,
      systemNotificationEnabled: true,
      soundEnabled: false,
      memoryEnabled: true
    };

    const result = await dispatcher.resumeOnboarding(preferences);
    check('OnboardingComplete: resumeOnboarding returned true', result === true);

    // 验证设置已保存
    check('OnboardingComplete: onboarding_completed set to true', settingsRepository.get('onboarding_completed') === 'true');
    check('OnboardingComplete: nickname saved', settingsRepository.get('user_nickname') === '小明');
    check('OnboardingComplete: weather_city saved', settingsRepository.get('weather_city') === '北京');
    check('OnboardingComplete: weather_enabled saved', settingsRepository.get('weather_enabled') === 'true');
    // 验证 characterId 有效（非空）
    check('OnboardingComplete: active_character_id is non-empty',
      (settingsRepository.get('active_character_id') ?? '').length > 0);
    // 验证 user_id 已设置
    check('OnboardingComplete: user_id is set',
      (settingsRepository.get('user_id') ?? '').length > 0);

    // 验证 proactive policy 已配置
    const policy = proactivePolicyRepository.get(userId, characterId);
    check('OnboardingComplete: proactive policy exists', policy !== null);
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 3：已完成 Onboarding 后启动发送日报 =====
async function testStartupAfterOnboardingSendsDigest(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId } = setupTestEnv(dbPath);

    // 设置 onboarding 已完成
    settingsRepository.set('onboarding_completed', 'true');
    settingsRepository.set('active_character_id', characterId);
    settingsRepository.set('user_nickname', '小红');

    proactivePolicyRepository.upsert(userId, characterId, {
      ...DEFAULT_PROACTIVE_POLICY,
      dndEnabled: false
    });

    // 收集 renderer 收到的消息
    let proactiveEventReceived = false;
    let receivedMessage = '';
    const callback: RendererCallback = async (dto, channel) => {
      if (channel === 'proactive-event') {
        proactiveEventReceived = true;
        receivedMessage = dto.text || '';
      }
      return true;
    };

    const dispatcher = createDispatcher(callback);

    // 发送 startup 事件
    const event = createStartupEvent(userId, characterId);
    await dispatcher.dispatch(event);

    check('StartupDigest: proactive-event sent to renderer', proactiveEventReceived);
    check('StartupDigest: message is not empty', receivedMessage.length > 0);
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 4：每日问候能正常触发 =====
async function testDailyGreeting(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId } = setupTestEnv(dbPath);

    settingsRepository.set('onboarding_completed', 'true');
    settingsRepository.set('active_character_id', characterId);

    proactivePolicyRepository.upsert(userId, characterId, {
      ...DEFAULT_PROACTIVE_POLICY,
      dndEnabled: false
    });

    let greetingReceived = false;
    let greetingMessage = '';
    const callback: RendererCallback = async (dto, channel) => {
      if (channel === 'proactive-event') {
        greetingReceived = true;
        greetingMessage = dto.text || '';
      }
      return true;
    };

    const dispatcher = createDispatcher(callback);

    // 发送每日问候事件
    const event = createDailyGreetingEvent(userId, characterId);
    await dispatcher.dispatch(event);

    check('DailyGreeting: proactive-event sent to renderer', greetingReceived);
    check('DailyGreeting: message is not empty', greetingMessage.length > 0);
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 5：Onboarding 偏好持久化 =====
async function testPreferencesPersisted(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId } = setupTestEnv(dbPath);

    // 完成 onboarding 并保存偏好
    const callback: RendererCallback = async () => true;
    const dispatcher = createDispatcher(callback);

    const event = createStartupEvent(userId, characterId);
    await dispatcher.dispatch(event);

    const preferences = {
      nickname: '小华',
      preferredName: '华华',
      replyLength: 'short' as const,
      proactiveLevel: 'low' as const,
      weatherCity: '上海',
      weatherEnabled: false,
      dndEnabled: true,
      dndStart: '23:00',
      dndEnd: '07:00',
      systemNotificationEnabled: false,
      soundEnabled: true,
      memoryEnabled: false
    };

    await dispatcher.resumeOnboarding(preferences);

    // 验证所有偏好都已持久化
    check('Persist: nickname', settingsRepository.get('user_nickname') === '小华');
    check('Persist: preferred_name', settingsRepository.get('user_preferred_name') === '华华');
    check('Persist: reply_length', settingsRepository.get('reply_length') === 'short');
    check('Persist: proactive_level', settingsRepository.get('proactive_level') === 'low');
    check('Persist: weather_city', settingsRepository.get('weather_city') === '上海');
    check('Persist: weather_enabled', settingsRepository.get('weather_enabled') === 'false');
    check('Persist: dnd_enabled', settingsRepository.get('dnd_enabled') === 'true');
    check('Persist: dnd_start', settingsRepository.get('dnd_start') === '23:00');
    check('Persist: dnd_end', settingsRepository.get('dnd_end') === '07:00');
    check('Persist: system_notification_enabled', settingsRepository.get('system_notification_enabled') === 'false');
    check('Persist: sound_enabled', settingsRepository.get('sound_enabled') === 'true');
    check('Persist: memory_enabled', settingsRepository.get('memory_enabled') === 'false');
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// ===== 主入口 =====
async function main(): Promise<void> {
  console.log('=== Onboarding → Startup E2E Tests ===\n');

  await testFirstLaunchTriggersOnboarding();
  console.log('');
  await testOnboardingCompletionSavesSettings();
  console.log('');
  await testStartupAfterOnboardingSendsDigest();
  console.log('');
  await testDailyGreeting();
  console.log('');
  await testPreferencesPersisted();

  console.log('\n=== Summary ===');
  console.log(`PASS: ${pass}, FAIL: ${fail}`);
  if (failures.length > 0) {
    console.log('Failures:');
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Test runner crashed:', error);
  process.exit(1);
});
