/**
 * Renderer ACK 测试。
 * 验证架构计划第 6 节"提醒 ACK"验收标准：
 *   1. ACK 成功：renderer 确认显示后，Dispatcher 标记 delivered 并记录投递
 *   2. ACK 超时：5 秒内未收到 ACK，Dispatcher 保持 delivered=false
 *   3. Renderer 销毁：窗口关闭/崩溃时，所有 pending ACK 被拒绝
 *
 * 运行：npx tsx tests/unit/renderer-ack.test.ts
 */
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

import { initDatabase, closeDatabase, getDatabase } from '../../src/infrastructure/database/connection';
import { settingsRepository } from '../../src/infrastructure/database/repositories/settings-repository';
import { sessionRepository } from '../../src/infrastructure/database/repositories/session-repository';
import { proactiveDeliveryRepository } from '../../src/infrastructure/database/repositories/proactive-delivery-repository';
import { eventOutboxRepository } from '../../src/infrastructure/database/repositories/event-outbox-repository';
import { proactivePolicyRepository, DEFAULT_PROACTIVE_POLICY } from '../../src/infrastructure/database/repositories/proactive-policy-repository';

import { GraphDispatcher, type RendererCallback } from '../../src/main/graph-dispatcher';
import type { FullscreenAdapter } from '../../src/adapters/fullscreen/FullscreenAdapter';
import type { NotificationAdapter } from '../../src/adapters/notifications/NotificationAdapter';
import type { SoundAdapter } from '../../src/adapters/sound/SoundAdapter';
import type { WeatherAdapter } from '../../src/adapters/weather/WeatherAdapter';
import { TimeService } from '../../src/services/TimeService';
import { MemoryStore } from '../../src/services/MemoryStore';
import { SkillRegistry } from '../../src/services/SkillRegistry';
import { DefaultPermissionGuard } from '../../src/domain/permissions/PermissionGuard';
import { ModelGateway } from '../../src/services/ModelGateway';
import { getDefaultAppConfig } from '../../src/infrastructure/config/config-loader';
import type { SecretStore, ApiSecretConfig } from '../../src/infrastructure/secrets/secret-store';
import { APP_EVENT_TYPE } from '../../src/shared/constants';
import type { AppEvent, ReminderDuePayload } from '../../src/shared/contracts/app-event';
import type { AppPaths } from '../../src/infrastructure/config/app-paths';

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'petdb-ack-'));
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
  private fullscreen = false;
  setFullscreen(v: boolean) { this.fullscreen = v; }
  isFullscreen() { return this.fullscreen; }
  onFullscreenChange(_cb: (fullscreen: boolean) => void): void { /* no-op */ }
}

class MockNotificationAdapter implements NotificationAdapter {
  notifications: Array<{ title: string; body: string }> = [];
  async showNotification(title: string, body: string): Promise<boolean> {
    this.notifications.push({ title, body });
    return true;
  }
  isNotificationEnabled() { return false; }
  isSoundEnabled() { return false; }
  setNotificationEnabled(_v: boolean) { /* no-op */ }
}

class MockSoundAdapter implements SoundAdapter {
  sounds: string[] = [];
  play(sound: string): void { this.sounds.push(sound); }
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

function setupTestEnv(dbPath: string): {
  userId: string;
  characterId: string;
} {
  initDatabase({ path: dbPath });

  const userId = 'ack-test-user';
  const characterId = 'ack-test-roxy';

  settingsRepository.set('onboarding_completed', 'true');
  settingsRepository.set('user_id', userId);
  settingsRepository.set('active_character_id', characterId);

  try {
    getDatabase().prepare('INSERT INTO users (id, nickname, preferred_name) VALUES (?, ?, ?)').run(
      userId, '测试用户', '测试用户'
    );
  } catch { /* may already exist */ }

  try {
    sessionRepository.insert({
      id: 'ack-test-session',
      user_id: userId,
      character_id: characterId
    });
  } catch { /* may already exist */ }

  proactivePolicyRepository.upsert(userId, characterId, {
    ...DEFAULT_PROACTIVE_POLICY,
    dndEnabled: false
  });

  return { userId, characterId };
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

  // CharacterPackManager stub
  const characterPackManager = {
    getActivePack: () => null,
    getActiveCharacterId: () => 'ack-test-roxy',
    load: () => null
  } as any;

  // AppPaths stub
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
    timeService: new TimeService('Asia/Shanghai')
  });

  dispatcher.setRendererCallback(rendererCallback);

  return dispatcher;
}

function createReminderEvent(userId: string, characterId: string, content: string): AppEvent<ReminderDuePayload> {
  const occurrenceId = `occ-ack-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    schemaVersion: 1,
    eventId: `evt-ack-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: APP_EVENT_TYPE.REMINDER_DUE,
    occurredAt: new Date().toISOString(),
    timezone: 'Asia/Shanghai',
    source: 'scheduler',
    userId,
    characterId,
    correlationId: `corr-ack-${Date.now()}`,
    dedupeKey: `dedupe-ack-${content}-${Date.now()}`,
    priority: 'normal',
    payload: {
      reminderId: 'rem-ack-test-001',
      reminderOccurrenceId: occurrenceId,
      content,
      priority: 'normal'
    }
  };
}

// ===== 测试 1：ACK 成功 =====
async function testAckSuccess(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId } = setupTestEnv(dbPath);

    // rendererCallback 模拟 ACK 成功：renderer 收到事件并确认显示
    const successCallback: RendererCallback = async (dto, channel) => {
      // 模拟 renderer 成功显示气泡后调用 ackProactiveEvent
      if (channel === 'proactive-event' && dto.reminderOccurrenceId) {
        return true; // ACK 成功
      }
      return true;
    };

    const dispatcher = createDispatcher(successCallback);

    // 将事件加入 outbox（模拟 Scheduler 发布事件）
    const event = createReminderEvent(userId, characterId, 'ACK 成功测试');
    eventOutboxRepository.publish({
      id: event.eventId,
      event_type: event.type,
      payload_json: JSON.stringify(event),
      dedupe_key: event.dedupeKey
    });

    const result = await dispatcher.dispatch(event);

    check('ACK Success: dispatch returned result', result !== null);
    check('ACK Success: channel is pet_bubble', result?.channel === 'pet_bubble');
    check('ACK Success: delivered is true', result?.delivered === true);
    check('ACK Success: has deliveryId', Boolean(result?.deliveryId));

    // 验证投递已记录
    const todayDate = new Date().toISOString().slice(0, 10);
    const deliveries = proactiveDeliveryRepository.getTodayDeliveries(userId, characterId, todayDate);
    check('ACK Success: delivery recorded in DB', deliveries.length > 0);
    check('ACK Success: delivery type is reminder', deliveries.some(d => d.delivery_type === 'reminder'));

    // 验证 outbox 已标记为已处理
    const pending = eventOutboxRepository.getPending();
    check('ACK Success: outbox marked as processed', !pending.some(o => o.id === event.eventId));
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 2：ACK 超时 =====
async function testAckTimeout(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId } = setupTestEnv(dbPath);

    // rendererCallback 模拟 ACK 超时：renderer 未响应（返回 false）
    const timeoutCallback: RendererCallback = async (_dto, _channel) => {
      // 模拟 5 秒超时后未收到 ACK
      return false;
    };

    const dispatcher = createDispatcher(timeoutCallback);

    const event = createReminderEvent(userId, characterId, 'ACK 超时测试');
    eventOutboxRepository.publish({
      id: event.eventId,
      event_type: event.type,
      payload_json: JSON.stringify(event),
      dedupe_key: event.dedupeKey
    });

    const result = await dispatcher.dispatch(event);

    check('ACK Timeout: dispatch returned result', result !== null);
    check('ACK Timeout: channel is pet_bubble', result?.channel === 'pet_bubble');
    check('ACK Timeout: delivered is false (no ACK)', result?.delivered === false);
    check('ACK Timeout: has deliveryId', Boolean(result?.deliveryId));

    // 验证投递未记录
    const todayDate = new Date().toISOString().slice(0, 10);
    const deliveries = proactiveDeliveryRepository.getTodayDeliveries(userId, characterId, todayDate);
    check('ACK Timeout: no delivery recorded in DB', !deliveries.some(d => d.delivery_type === 'reminder'));

    // 验证 outbox 未标记为已处理（以便重试）
    const pending = eventOutboxRepository.getPending();
    check('ACK Timeout: outbox still pending (for retry)', pending.some(o => o.id === event.eventId));
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 3：Renderer 销毁 =====
async function testRendererDestroyed(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId } = setupTestEnv(dbPath);

    // rendererCallback 模拟窗口已销毁：立即返回 false
    // 在 main.js 中，当 mainWindow.isDestroyed() 为 true 时，
    // deliverToRendererWithAck 直接返回 Promise.resolve(false)
    const destroyedCallback: RendererCallback = async (_dto, _channel) => {
      // 模拟窗口销毁，renderer 无法接收消息
      return false;
    };

    const dispatcher = createDispatcher(destroyedCallback);

    const event = createReminderEvent(userId, characterId, 'Renderer 销毁测试');
    eventOutboxRepository.publish({
      id: event.eventId,
      event_type: event.type,
      payload_json: JSON.stringify(event),
      dedupe_key: event.dedupeKey
    });

    const result = await dispatcher.dispatch(event);

    check('Renderer Destroyed: dispatch returned result', result !== null);
    check('Renderer Destroyed: channel is pet_bubble', result?.channel === 'pet_bubble');
    check('Renderer Destroyed: delivered is false', result?.delivered === false);

    // 验证投递未记录（窗口销毁 = 未显示）
    const todayDate = new Date().toISOString().slice(0, 10);
    const deliveries = proactiveDeliveryRepository.getTodayDeliveries(userId, characterId, todayDate);
    check('Renderer Destroyed: no delivery recorded', !deliveries.some(d => d.delivery_type === 'reminder'));

    // 验证 outbox 仍为 pending（可重试）
    const pending = eventOutboxRepository.getPending();
    check('Renderer Destroyed: outbox still pending (for retry)', pending.some(o => o.id === event.eventId));
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// ===== 主入口 =====
async function main(): Promise<void> {
  console.log('=== Renderer ACK Tests ===\n');

  await testAckSuccess();
  console.log('');
  await testAckTimeout();
  console.log('');
  await testRendererDestroyed();

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
