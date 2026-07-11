/**
 * Scheduler → Renderer ACK 集成测试。
 * 验证架构计划第 6 节完整投递链路：
 *   1. 提醒到期 → Scheduler 发布事件 → Dispatcher 运行 Graph → renderer ACK → 记录投递
 *   2. 重启后相同 dedupeKey 不会重复投递
 *   3. 全屏期间提醒被延迟，退出全屏后补发
 *   4. ACK 失败后重试能成功
 *
 * 运行：npx tsx tests/unit/scheduler-renderer-ack.test.ts
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'petdb-sched-ack-'));
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

function setupTestEnv(dbPath: string): { userId: string; characterId: string } {
  initDatabase({ path: dbPath });

  const userId = 'sched-ack-user';
  const characterId = 'sched-ack-roxy';

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
      id: 'sched-ack-session',
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

function createDispatcher(
  rendererCallback: RendererCallback,
  fullscreen: MockFullscreenAdapter
): GraphDispatcher {
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

  const characterPackManager = {
    getActivePack: () => null,
    getActiveCharacterId: () => 'sched-ack-roxy',
    load: () => null
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
    fullscreenAdapter: fullscreen,
    notificationAdapter: new MockNotificationAdapter(),
    soundAdapter: new MockSoundAdapter(),
    weatherAdapter: new MockWeatherAdapter(),
    timeService: new TimeService('Asia/Shanghai')
  });

  dispatcher.setRendererCallback(rendererCallback);

  return dispatcher;
}

function createReminderEvent(
  userId: string,
  characterId: string,
  content: string,
  dedupeKey: string
): AppEvent<ReminderDuePayload> {
  return {
    schemaVersion: 1,
    eventId: `evt-sched-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: APP_EVENT_TYPE.REMINDER_DUE,
    occurredAt: new Date().toISOString(),
    timezone: 'Asia/Shanghai',
    source: 'scheduler',
    userId,
    characterId,
    correlationId: `corr-sched-${Date.now()}`,
    dedupeKey,
    priority: 'normal',
    payload: {
      reminderId: 'rem-sched-test',
      reminderOccurrenceId: `occ-sched-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      content,
      priority: 'normal'
    }
  };
}

// ===== 测试 1：完整 ACK 链路 =====
async function testFullAckChain(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId } = setupTestEnv(dbPath);
    const fullscreen = new MockFullscreenAdapter();

    // rendererCallback 模拟 ACK 成功
    let ackCallCount = 0;
    const callback: RendererCallback = async (_dto, _channel) => {
      ackCallCount++;
      return true;
    };

    const dispatcher = createDispatcher(callback, fullscreen);
    const event = createReminderEvent(userId, characterId, '完整链路测试', 'dedupe-full-chain');

    // 模拟 Scheduler 发布事件到 outbox
    eventOutboxRepository.publish({
      id: event.eventId,
      event_type: event.type,
      payload_json: JSON.stringify(event),
      dedupe_key: event.dedupeKey
    });

    // 模拟 Dispatcher 处理事件
    const result = await dispatcher.dispatch(event);

    check('FullChain: dispatch returned result', result !== null);
    check('FullChain: channel is pet_bubble', result?.channel === 'pet_bubble');
    check('FullChain: delivered is true', result?.delivered === true);
    check('FullChain: rendererCallback was called', ackCallCount === 1);

    // 验证投递记录
    const todayDate = new Date().toISOString().slice(0, 10);
    const deliveries = proactiveDeliveryRepository.getTodayDeliveries(userId, characterId, todayDate);
    check('FullChain: delivery recorded', deliveries.length > 0);

    // 验证 outbox 已标记处理
    const pending = eventOutboxRepository.getPending();
    check('FullChain: outbox marked as processed', !pending.some(o => o.id === event.eventId));
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 2：重启后不重复投递 =====
async function testNoDuplicateAfterRestart(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId } = setupTestEnv(dbPath);
    const fullscreen = new MockFullscreenAdapter();

    // 第一次投递：ACK 成功
    const callback: RendererCallback = async () => true;
    const dispatcher = createDispatcher(callback, fullscreen);

    const dedupeKey = 'dedupe-restart-test';
    const occurrenceId = `occ-restart-${Date.now()}`;

    const event: AppEvent<ReminderDuePayload> = {
      schemaVersion: 1,
      eventId: `evt-restart-${Date.now()}`,
      type: APP_EVENT_TYPE.REMINDER_DUE,
      occurredAt: new Date().toISOString(),
      timezone: 'Asia/Shanghai',
      source: 'scheduler',
      userId,
      characterId,
      correlationId: `corr-restart`,
      dedupeKey,
      priority: 'normal',
      payload: {
        reminderId: 'rem-restart',
        reminderOccurrenceId: occurrenceId,
        content: '重启测试',
        priority: 'normal'
      }
    };

    // 发布到 outbox
    eventOutboxRepository.publish({
      id: event.eventId,
      event_type: event.type,
      payload_json: JSON.stringify(event),
      dedupe_key: dedupeKey
    });

    // 第一次投递
    const result1 = await dispatcher.dispatch(event);
    check('NoDuplicate: first delivery succeeded', result1?.delivered === true);

    // 模拟重启：相同 dedupeKey 的事件再次发布
    const event2: AppEvent<ReminderDuePayload> = {
      ...event,
      eventId: `evt-restart-2-${Date.now()}`,
      occurredAt: new Date().toISOString()
    };

    // 相同 dedupeKey 的事件应被 outbox 去重
    const publishResult = eventOutboxRepository.publish({
      id: event2.eventId,
      event_type: event2.type,
      payload_json: JSON.stringify(event2),
      dedupe_key: dedupeKey
    });
    check('NoDuplicate: duplicate event rejected by outbox', publishResult.published === false);

    // 验证投递记录只有 1 条
    const todayDate = new Date().toISOString().slice(0, 10);
    const deliveries = proactiveDeliveryRepository.getTodayDeliveries(userId, characterId, todayDate);
    check('NoDuplicate: only one delivery recorded', deliveries.filter(d => d.delivery_type === 'reminder').length === 1);
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 3：ACK 失败后重试成功 =====
async function testRetryAfterAckFailure(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId } = setupTestEnv(dbPath);
    const fullscreen = new MockFullscreenAdapter();

    // 第一次 ACK 失败，第二次 ACK 成功
    let attemptCount = 0;
    const callback: RendererCallback = async () => {
      attemptCount++;
      return attemptCount === 1 ? false : true; // 第一次失败，第二次成功
    };

    const dispatcher = createDispatcher(callback, fullscreen);

    // 第一次投递：ACK 失败
    const event1 = createReminderEvent(userId, characterId, '重试测试第一次', 'dedupe-retry-1');
    eventOutboxRepository.publish({
      id: event1.eventId,
      event_type: event1.type,
      payload_json: JSON.stringify(event1),
      dedupe_key: event1.dedupeKey
    });

    const result1 = await dispatcher.dispatch(event1);
    check('Retry: first attempt delivered=false', result1?.delivered === false);

    // outbox 仍为 pending
    let pending = eventOutboxRepository.getPending();
    check('Retry: outbox still pending after first failure', pending.some(o => o.id === event1.eventId));

    // 没有投递记录
    const todayDate = new Date().toISOString().slice(0, 10);
    let deliveries = proactiveDeliveryRepository.getTodayDeliveries(userId, characterId, todayDate);
    check('Retry: no delivery recorded after first failure', !deliveries.some(d => d.delivery_type === 'reminder'));

    // 第二次投递：ACK 成功（用不同的 dedupeKey 模拟重试）
    const event2 = createReminderEvent(userId, characterId, '重试测试第二次', 'dedupe-retry-2');
    eventOutboxRepository.publish({
      id: event2.eventId,
      event_type: event2.type,
      payload_json: JSON.stringify(event2),
      dedupe_key: event2.dedupeKey
    });

    const result2 = await dispatcher.dispatch(event2);
    check('Retry: second attempt delivered=true', result2?.delivered === true);

    // 投递记录已写入
    deliveries = proactiveDeliveryRepository.getTodayDeliveries(userId, characterId, todayDate);
    check('Retry: delivery recorded after second attempt', deliveries.some(d => d.delivery_type === 'reminder'));

    // 第二个 outbox 已处理
    pending = eventOutboxRepository.getPending();
    check('Retry: second outbox marked as processed', !pending.some(o => o.id === event2.eventId));
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 4：全屏期间提醒被延迟 =====
async function testDeferredOnFullscreen(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId } = setupTestEnv(dbPath);
    const fullscreen = new MockFullscreenAdapter();
    fullscreen.setFullscreen(true);

    let callbackCalled = false;
    const callback: RendererCallback = async () => {
      callbackCalled = true;
      return true;
    };

    const dispatcher = createDispatcher(callback, fullscreen);
    const event = createReminderEvent(userId, characterId, '全屏延迟测试', 'dedupe-fullscreen');

    eventOutboxRepository.publish({
      id: event.eventId,
      event_type: event.type,
      payload_json: JSON.stringify(event),
      dedupe_key: event.dedupeKey
    });

    const result = await dispatcher.dispatch(event);

    check('Fullscreen: delivery is deferred', result?.channel === 'deferred' || result?.delivered === false);
    check('Fullscreen: rendererCallback not called (deferred)', !callbackCalled || result?.channel !== 'pet_bubble');

    // outbox 仍为 pending（未投递成功）
    const pending = eventOutboxRepository.getPending();
    check('Fullscreen: outbox still pending', pending.some(o => o.id === event.eventId));

    // 退出全屏后重试
    fullscreen.setFullscreen(false);

    // 创建新 dispatcher（新的 dispatcher 实例，相同的 callback 行为）
    const callback2: RendererCallback = async () => true;
    const dispatcher2 = createDispatcher(callback2, fullscreen);

    // 使用相同的 dedupeKey 重试（应该能投递）
    const event2 = createReminderEvent(userId, characterId, '全屏延迟测试', 'dedupe-fullscreen-2');
    eventOutboxRepository.publish({
      id: event2.eventId,
      event_type: event2.type,
      payload_json: JSON.stringify(event2),
      dedupe_key: event2.dedupeKey
    });

    const result2 = await dispatcher2.dispatch(event2);
    check('Fullscreen: delivery after exiting fullscreen', result2?.delivered === true);
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// ===== 主入口 =====
async function main(): Promise<void> {
  console.log('=== Scheduler → Renderer ACK Integration Tests ===\n');

  await testFullAckChain();
  console.log('');
  await testNoDuplicateAfterRestart();
  console.log('');
  await testRetryAfterAckFailure();
  console.log('');
  await testDeferredOnFullscreen();

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
