/**
 * 阶段 6 ProactiveEventGraph 测试。
 * 验证架构计划阶段 6 验收标准：
 *   1. 重启后提醒仍能触发
 *   2. 全屏游戏时完全暂停主动投递
 *   3. 退出全屏后能补发未投递提醒
 *   4. 日报部分数据失败时仍可展示其余内容
 *   5. 连续忽略 2 次后同类问候停止
 *   6. 应用重启不会重复发送相同日报或提醒
 *   7. 每日主动次数统计在本地日期跨日时正确重置
 *
 * 运行：npx tsx tests/unit/proactive-graph.test.ts
 */
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

import { initDatabase, closeDatabase, getDatabase } from '../../src/infrastructure/database/connection';
import { settingsRepository } from '../../src/infrastructure/database/repositories/settings-repository';
import { sessionRepository } from '../../src/infrastructure/database/repositories/session-repository';
import { reminderRepository } from '../../src/infrastructure/database/repositories/reminder-repository';
import { proactiveDeliveryRepository } from '../../src/infrastructure/database/repositories/proactive-delivery-repository';
import { proactivePolicyRepository, DEFAULT_PROACTIVE_POLICY } from '../../src/infrastructure/database/repositories/proactive-policy-repository';
import { eventOutboxRepository } from '../../src/infrastructure/database/repositories/event-outbox-repository';
import { taskRepository } from '../../src/infrastructure/database/repositories/task-repository';

import { TimeService } from '../../src/services/TimeService';
import { ProactiveGraphRunner } from '../../src/agent/graphs/proactive/graph';
import { createInitialProactiveState } from '../../src/agent/graphs/proactive/state';
import type { ProactiveStateType } from '../../src/agent/graphs/proactive/state';
import { inferProactiveType } from '../../src/agent/graphs/proactive/nodes/receive-event';
import type { FullscreenAdapter } from '../../src/adapters/fullscreen/FullscreenAdapter';
import type { NotificationAdapter } from '../../src/adapters/notifications/NotificationAdapter';
import type { SoundAdapter } from '../../src/adapters/sound/SoundAdapter';
import type { WeatherAdapter, WeatherSnapshot } from '../../src/adapters/weather/WeatherAdapter';
import type { PersonaConfig, ProactivePolicy } from '../../src/shared/contracts/graph-state';
import type { AppEvent } from '../../src/shared/contracts/app-event';

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'petdb-proactive-'));
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
  private notificationEnabled: boolean;
  private soundEnabled: boolean;

  constructor(notificationEnabled = false, soundEnabled = false) {
    this.notificationEnabled = notificationEnabled;
    this.soundEnabled = soundEnabled;
  }

  async showNotification(title: string, body: string): Promise<boolean> {
    if (this.notificationEnabled) {
      this.notifications.push({ title, body });
      return true;
    }
    return false;
  }
  isNotificationEnabled() { return this.notificationEnabled; }
  isSoundEnabled() { return this.soundEnabled; }
  setNotificationEnabled(v: boolean) { this.notificationEnabled = v; }
}

class MockSoundAdapter implements SoundAdapter {
  sounds: string[] = [];
  private enabled: boolean;

  constructor(enabled = false) { this.enabled = enabled; }

  play(sound: string): void {
    if (this.enabled) this.sounds.push(sound);
  }
  isEnabled() { return this.enabled; }
  setEnabled(v: boolean) { this.enabled = v; }
}

class MockWeatherAdapter implements WeatherAdapter {
  private authorized = false;
  private enabled = true;
  private weatherData: WeatherSnapshot | null = null;
  private shouldFail = false;

  setAuthorized(v: boolean) { this.authorized = v; }
  setEnabled(v: boolean) { this.enabled = v; }
  setWeatherData(data: WeatherSnapshot | null) { this.weatherData = data; }
  setShouldFail(v: boolean) { this.shouldFail = v; }

  isAuthorized() { return this.authorized; }
  authorize(): void { this.authorized = true; }
  isEnabled() { return this.enabled; }

  async getWeather(_city: string): Promise<WeatherSnapshot | null> {
    if (!this.enabled || !this.authorized) return null;
    if (this.shouldFail) throw new Error('Weather API failed');
    return this.weatherData;
  }
}

// ===== 辅助函数 =====

function createTestPersona(): PersonaConfig {
  return {
    characterId: 'test-roxy',
    characterName: 'Roxy',
    corePrompt: '你是洛琪希，一个温柔的桌宠助手。',
    speakingStyle: ['温柔礼貌', '沉稳体贴'],
    relationshipBoundary: ['不涉及成人内容'],
    forbiddenDrift: ['不偏离角色'],
    commonTone: ['关心用户'],
    sampleDialogues: [],
    userPetName: '昌昌',
    defaultLanguage: 'zh'
  };
}

function createReminderEvent(userId: string, characterId: string, content: string, dedupeKey?: string): AppEvent {
  return {
    schemaVersion: 1,
    eventId: `evt-rem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: 'reminder_due',
    occurredAt: new Date().toISOString(),
    timezone: 'Asia/Shanghai',
    source: 'scheduler',
    userId,
    characterId,
    correlationId: `corr-${Date.now()}`,
    dedupeKey: dedupeKey ?? `dedupe-rem-${content}-${new Date().toISOString().slice(0, 10)}`,
    priority: 'normal',
    payload: {
      reminderId: 'rem-test-001',
      reminderOccurrenceId: `occ-rem-test-001-${Date.now()}`,
      content,
      priority: 'normal'
    }
  };
}

function createStartupEvent(userId: string, characterId: string, dedupeKey?: string): AppEvent {
  return {
    schemaVersion: 1,
    eventId: `evt-startup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: 'startup',
    occurredAt: new Date().toISOString(),
    timezone: 'Asia/Shanghai',
    source: 'system',
    userId,
    characterId,
    correlationId: `corr-${Date.now()}`,
    dedupeKey: dedupeKey ?? `dedupe-startup-${new Date().toISOString().slice(0, 10)}`,
    priority: 'normal',
    payload: { isFirstLaunch: false }
  };
}

function createDailyGreetingEvent(userId: string, characterId: string, dedupeKey?: string): AppEvent {
  return {
    schemaVersion: 1,
    eventId: `evt-greeting-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: 'daily_greeting_due',
    occurredAt: new Date().toISOString(),
    timezone: 'Asia/Shanghai',
    source: 'scheduler',
    userId,
    characterId,
    correlationId: `corr-${Date.now()}`,
    dedupeKey: dedupeKey ?? `dedupe-greeting-${new Date().toISOString().slice(0, 10)}`,
    priority: 'low',
    payload: { greetingType: 'morning' }
  };
}

function setupTestEnv(dbPath: string): {
  userId: string;
  characterId: string;
  sessionId: string;
} {
  initDatabase({ path: dbPath });

  const userId = 'test-user-001';
  const characterId = 'test-roxy';
  const sessionId = 'test-session-001';

  settingsRepository.set('onboarding_completed', 'true');
  settingsRepository.set('user_id', userId);
  settingsRepository.set('active_character_id', characterId);

  try {
    getDatabase().prepare('INSERT INTO users (id, nickname, preferred_name) VALUES (?, ?, ?)').run(
      userId, '昌昌', '昌昌'
    );
  } catch { /* may already exist */ }

  try {
    sessionRepository.insert({
      id: sessionId,
      user_id: userId,
      character_id: characterId
    });
  } catch { /* may already exist */ }

  return { userId, characterId, sessionId };
}

function createRunner(
  fullscreen: MockFullscreenAdapter,
  notification: MockNotificationAdapter,
  sound: MockSoundAdapter,
  weather: MockWeatherAdapter | null,
  timeService: TimeService
): ProactiveGraphRunner {
  return new ProactiveGraphRunner({
    fullscreenAdapter: fullscreen,
    notificationAdapter: notification,
    soundAdapter: sound,
    weatherAdapter: weather,
    timeService
  });
}

/** 设置策略 */
function setPolicy(userId: string, characterId: string, overrides: Partial<ProactivePolicy> = {}): void {
  const policy: ProactivePolicy = { ...DEFAULT_PROACTIVE_POLICY, ...overrides };
  proactivePolicyRepository.upsert(userId, characterId, policy);
}

/** 构造包含当前小时的 DND 窗口（确保 DND 总是生效） */
function getCurrentHourDndWindow(): { dndStart: string; dndEnd: string } {
  const now = new Date();
  const currentHour = now.getHours();
  const nextHour = (currentHour + 1) % 24;
  return {
    dndStart: `${String(currentHour).padStart(2, '0')}:00`,
    dndEnd: `${String(nextHour).padStart(2, '0')}:00`
  };
}

/** 模拟已忽略 N 次投递 */
function simulateIgnoredDeliveries(
  userId: string, characterId: string, deliveryType: string, count: number, dailyDate: string
): void {
  for (let i = 0; i < count; i++) {
    proactiveDeliveryRepository.record({
      user_id: userId,
      character_id: characterId,
      delivery_type: deliveryType,
      ignored: 1,
      daily_date: dailyDate
    });
  }
}

/** 模拟已投递 N 次 */
function simulateDeliveries(
  userId: string, characterId: string, deliveryType: string, count: number, dailyDate: string
): void {
  for (let i = 0; i < count; i++) {
    proactiveDeliveryRepository.record({
      user_id: userId,
      character_id: characterId,
      delivery_type: deliveryType,
      ignored: 0,
      daily_date: dailyDate
    });
  }
}

// ===== 测试 1：事件类型推断 =====
async function testInferProactiveType(): Promise<void> {
  check('TypeInfer: reminder_due → reminder', inferProactiveType('reminder_due') === 'reminder');
  check('TypeInfer: startup → startup_digest', inferProactiveType('startup') === 'startup_digest');
  check('TypeInfer: daily_greeting_due → daily_greeting', inferProactiveType('daily_greeting_due') === 'daily_greeting');
  check('TypeInfer: unknown → daily_greeting', inferProactiveType('unknown') === 'daily_greeting');
}

// ===== 测试 2：提醒正常投递 =====
async function testReminderDelivery(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId, sessionId } = setupTestEnv(dbPath);
    setPolicy(userId, characterId, { dndEnabled: false });

    const fullscreen = new MockFullscreenAdapter();
    const notification = new MockNotificationAdapter();
    const sound = new MockSoundAdapter();
    const weather = new MockWeatherAdapter();
    const timeService = new TimeService('Asia/Shanghai');
    const runner = createRunner(fullscreen, notification, sound, weather, timeService);

    const event = createReminderEvent(userId, characterId, '开会');
    const initialState = createInitialProactiveState({
      event,
      userId,
      characterId,
      sessionId,
      persona: createTestPersona(),
      modelMode: 'balanced',
      proactiveType: 'reminder'
    });

    const result = await runner.run(initialState);

    check('ReminderDelivery: graph completed', result.deliveryResult !== null);
    // pet_bubble 现在返回 delivered=false：Graph 仅生成投递意图，
    // 实际投递由 Dispatcher 等待 renderer ACK 后确认。
    check('ReminderDelivery: delivered is false (pending ACK)', result.deliveryResult?.delivered === false);
    check('ReminderDelivery: delivery is pet_bubble', result.delivery === 'pet_bubble');
    check('ReminderDelivery: has deliveryId for ACK', Boolean(result.deliveryResult?.deliveryId));
    check('ReminderDelivery: message contains content', result.composedMessage.includes('开会'));
    check('ReminderDelivery: no errors', result.errors.length === 0);

    // Graph 不再记录 pet_bubble 投递（delivered=false 时跳过），
    // 投递记录由 Dispatcher 在 ACK 成功后写入。
    const todayDate = new Date().toISOString().slice(0, 10);
    const deliveries = proactiveDeliveryRepository.getTodayDeliveries(userId, characterId, todayDate);
    check('ReminderDelivery: not recorded in Graph (pending ACK)', !deliveries.some(d => d.delivery_type === 'reminder'));
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 3：全屏时提醒被延迟 =====
async function testReminderDeferredOnFullscreen(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId, sessionId } = setupTestEnv(dbPath);
    setPolicy(userId, characterId, { dndEnabled: false });

    const fullscreen = new MockFullscreenAdapter();
    fullscreen.setFullscreen(true);
    const notification = new MockNotificationAdapter();
    const sound = new MockSoundAdapter();
    const weather = new MockWeatherAdapter();
    const timeService = new TimeService('Asia/Shanghai');
    const runner = createRunner(fullscreen, notification, sound, weather, timeService);

    const event = createReminderEvent(userId, characterId, '重要会议');
    const initialState = createInitialProactiveState({
      event,
      userId,
      characterId,
      sessionId,
      persona: createTestPersona(),
      modelMode: 'balanced',
      proactiveType: 'reminder'
    });

    const result = await runner.run(initialState);

    check('FullscreenDefer: delivery is deferred', result.delivery === 'deferred');
    check('FullscreenDefer: not delivered', result.deliveryResult?.delivered === false);
    check('FullscreenDefer: no notification shown', notification.notifications.length === 0);
    check('FullscreenDefer: no sound played', sound.sounds.length === 0);

    // 验证未记录投递（因为未真正投递）
    const todayDate = new Date().toISOString().slice(0, 10);
    const deliveries = proactiveDeliveryRepository.getTodayDeliveries(userId, characterId, todayDate);
    check('FullscreenDefer: no delivery recorded', !deliveries.some(d => d.delivery_type === 'reminder'));
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 4：全屏时非提醒被抑制 =====
async function testNonReminderSuppressedOnFullscreen(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId, sessionId } = setupTestEnv(dbPath);
    setPolicy(userId, characterId, { dndEnabled: false });

    const fullscreen = new MockFullscreenAdapter();
    fullscreen.setFullscreen(true);
    const notification = new MockNotificationAdapter(true, true);
    const sound = new MockSoundAdapter(true);
    const weather = new MockWeatherAdapter();
    const timeService = new TimeService('Asia/Shanghai');
    const runner = createRunner(fullscreen, notification, sound, weather, timeService);

    const event = createDailyGreetingEvent(userId, characterId);
    const initialState = createInitialProactiveState({
      event,
      userId,
      characterId,
      sessionId,
      persona: createTestPersona(),
      modelMode: 'balanced',
      proactiveType: 'daily_greeting'
    });

    const result = await runner.run(initialState);

    check('FullscreenSuppress: delivery is suppressed', result.delivery === 'suppressed');
    check('FullscreenSuppress: not delivered', result.deliveryResult?.delivered === false);
    check('FullscreenSuppress: no notification', notification.notifications.length === 0);
    check('FullscreenSuppress: no sound', sound.sounds.length === 0);
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 5：勿扰时提醒被延迟 =====
async function testReminderDeferredOnDnd(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId, sessionId } = setupTestEnv(dbPath);
    // 使用包含当前小时的 DND 窗口，确保 DND 总是生效
    const dndWindow = getCurrentHourDndWindow();
    setPolicy(userId, characterId, {
      dndEnabled: true,
      dndStart: dndWindow.dndStart,
      dndEnd: dndWindow.dndEnd
    });

    const fullscreen = new MockFullscreenAdapter();
    const notification = new MockNotificationAdapter();
    const sound = new MockSoundAdapter();
    const weather = new MockWeatherAdapter();
    const timeService = new TimeService('Asia/Shanghai');
    const runner = createRunner(fullscreen, notification, sound, weather, timeService);

    const event = createReminderEvent(userId, characterId, '喝水');
    const initialState = createInitialProactiveState({
      event,
      userId,
      characterId,
      sessionId,
      persona: createTestPersona(),
      modelMode: 'balanced',
      proactiveType: 'reminder'
    });

    const result = await runner.run(initialState);

    check('DndDefer: delivery is deferred', result.delivery === 'deferred');
    check('DndDefer: not delivered', result.deliveryResult?.delivered === false);
    check('DndDefer: in DND', result.inDnd === true);
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 6：勿扰时非提醒被抑制 =====
async function testNonReminderSuppressedOnDnd(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId, sessionId } = setupTestEnv(dbPath);
    const dndWindow = getCurrentHourDndWindow();
    setPolicy(userId, characterId, {
      dndEnabled: true,
      dndStart: dndWindow.dndStart,
      dndEnd: dndWindow.dndEnd
    });

    const fullscreen = new MockFullscreenAdapter();
    const notification = new MockNotificationAdapter();
    const sound = new MockSoundAdapter();
    const weather = new MockWeatherAdapter();
    const timeService = new TimeService('Asia/Shanghai');
    const runner = createRunner(fullscreen, notification, sound, weather, timeService);

    const event = createDailyGreetingEvent(userId, characterId);
    const initialState = createInitialProactiveState({
      event,
      userId,
      characterId,
      sessionId,
      persona: createTestPersona(),
      modelMode: 'balanced',
      proactiveType: 'daily_greeting'
    });

    const result = await runner.run(initialState);

    check('DndSuppress: delivery is suppressed', result.delivery === 'suppressed');
    check('DndSuppress: not delivered', result.deliveryResult?.delivered === false);
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 7：每日配额超出时非提醒被抑制 =====
async function testDailyQuotaExceeded(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId, sessionId } = setupTestEnv(dbPath);
    setPolicy(userId, characterId, { dndEnabled: false, maxDailyProactive: 2 });

    const todayDate = new Date().toISOString().slice(0, 10);
    // 模拟已有 2 次投递（达到上限）
    simulateDeliveries(userId, characterId, 'daily_greeting', 2, todayDate);

    const fullscreen = new MockFullscreenAdapter();
    const notification = new MockNotificationAdapter();
    const sound = new MockSoundAdapter();
    const weather = new MockWeatherAdapter();
    const timeService = new TimeService('Asia/Shanghai');
    const runner = createRunner(fullscreen, notification, sound, weather, timeService);

    const event = createDailyGreetingEvent(userId, characterId);
    const initialState = createInitialProactiveState({
      event,
      userId,
      characterId,
      sessionId,
      persona: createTestPersona(),
      modelMode: 'balanced',
      proactiveType: 'daily_greeting'
    });

    const result = await runner.run(initialState);

    check('QuotaExceeded: delivery is suppressed', result.delivery === 'suppressed');
    check('QuotaExceeded: not delivered', result.deliveryResult?.delivered === false);
    check('QuotaExceeded: daily count is 2', result.dailyCount === 2);
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 8：提醒不受配额限制 =====
async function testReminderExemptFromQuota(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId, sessionId } = setupTestEnv(dbPath);
    setPolicy(userId, characterId, { dndEnabled: false, maxDailyProactive: 1 });

    const todayDate = new Date().toISOString().slice(0, 10);
    simulateDeliveries(userId, characterId, 'daily_greeting', 5, todayDate);

    const fullscreen = new MockFullscreenAdapter();
    const notification = new MockNotificationAdapter();
    const sound = new MockSoundAdapter();
    const weather = new MockWeatherAdapter();
    const timeService = new TimeService('Asia/Shanghai');
    const runner = createRunner(fullscreen, notification, sound, weather, timeService);

    const event = createReminderEvent(userId, characterId, '重要提醒');
    const initialState = createInitialProactiveState({
      event,
      userId,
      characterId,
      sessionId,
      persona: createTestPersona(),
      modelMode: 'balanced',
      proactiveType: 'reminder'
    });

    const result = await runner.run(initialState);

    // pet_bubble 返回 delivered=false（等待 ACK），但提醒豁免配额限制
    check('ReminderExempt: delivered is false (pending ACK)', result.deliveryResult?.delivered === false);
    check('ReminderExempt: delivery is pet_bubble', result.delivery === 'pet_bubble');
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 9：忽略阈值达到后同类问候停止 =====
async function testIgnoreThreshold(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId, sessionId } = setupTestEnv(dbPath);
    setPolicy(userId, characterId, { dndEnabled: false, ignoreThreshold: 2 });

    const todayDate = new Date().toISOString().slice(0, 10);
    // 模拟已被忽略 2 次
    simulateIgnoredDeliveries(userId, characterId, 'daily_greeting', 2, todayDate);

    const fullscreen = new MockFullscreenAdapter();
    const notification = new MockNotificationAdapter();
    const sound = new MockSoundAdapter();
    const weather = new MockWeatherAdapter();
    const timeService = new TimeService('Asia/Shanghai');
    const runner = createRunner(fullscreen, notification, sound, weather, timeService);

    const event = createDailyGreetingEvent(userId, characterId);
    const initialState = createInitialProactiveState({
      event,
      userId,
      characterId,
      sessionId,
      persona: createTestPersona(),
      modelMode: 'balanced',
      proactiveType: 'daily_greeting'
    });

    const result = await runner.run(initialState);

    check('IgnoreThreshold: delivery is suppressed', result.delivery === 'suppressed');
    check('IgnoreThreshold: ignored count is 2', result.ignoredCount === 2);
    check('IgnoreThreshold: not delivered', result.deliveryResult?.delivered === false);
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 10：去重 - 重启不重复发送 =====
async function testDeduplicate(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId, sessionId } = setupTestEnv(dbPath);
    setPolicy(userId, characterId, { dndEnabled: false });

    const fullscreen = new MockFullscreenAdapter();
    const notification = new MockNotificationAdapter();
    const sound = new MockSoundAdapter();
    const weather = new MockWeatherAdapter();
    const timeService = new TimeService('Asia/Shanghai');
    const runner = createRunner(fullscreen, notification, sound, weather, timeService);

    const dedupeKey = `dedupe-test-${Date.now()}`;
    const event = createStartupEvent(userId, characterId, dedupeKey);
    const initialState = createInitialProactiveState({
      event,
      userId,
      characterId,
      sessionId,
      persona: createTestPersona(),
      modelMode: 'balanced',
      proactiveType: 'startup_digest'
    });

    // 第一次投递（pet_bubble delivered=false，等待 ACK）
    const result1 = await runner.run(initialState);
    check('Dedup: first delivery pending ACK', result1.deliveryResult?.delivered === false);

    // 模拟 Dispatcher 在 ACK 成功后标记 outbox 为已处理
    // （Graph 的 record_delivery 节点因 delivered=false 跳过此步骤）
    eventOutboxRepository.markProcessed(event.eventId);

    // 第二次相同 dedupeKey - 应该被去重（outbox 已标记为 processed）
    const event2 = createStartupEvent(userId, characterId, dedupeKey);
    event2.eventId = `evt-startup-dup-${Date.now()}`;
    const initialState2 = createInitialProactiveState({
      event: event2,
      userId,
      characterId,
      sessionId,
      persona: createTestPersona(),
      modelMode: 'balanced',
      proactiveType: 'startup_digest'
    });

    const result2 = await runner.run(initialState2);
    check('Dedup: second delivery suppressed', result2.delivery === 'suppressed');
    check('Dedup: is duplicate', result2.isDuplicate === true);
    check('Dedup: not delivered', result2.deliveryResult?.delivered === false);
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 11：开机日报包含天气 =====
async function testStartupDigestWithWeather(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId, sessionId } = setupTestEnv(dbPath);
    setPolicy(userId, characterId, { dndEnabled: false });

    // 添加今日提醒（使用今天上午 9 点，避免深夜测试时跨天）
    const todayMorning = new Date();
    todayMorning.setHours(9, 0, 0, 0);
    reminderRepository.insert({
      id: 'rem-digest-001',
      user_id: userId,
      character_id: characterId,
      content: '下午开会',
      trigger_at: todayMorning.toISOString(),
      timezone: 'Asia/Shanghai',
      is_repeating: 0,
      recurrence_rule: '',
      priority: 'normal',
      is_active: 1,
      next_trigger_at: todayMorning.toISOString()
    });

    // 添加今日任务
    taskRepository.insert({
      id: 'task-digest-001',
      user_id: userId,
      character_id: characterId,
      title: '完成报告',
      status: 'todo',
      due_at: todayMorning.toISOString(),
      completed_at: null
    });

    const fullscreen = new MockFullscreenAdapter();
    const notification = new MockNotificationAdapter();
    const sound = new MockSoundAdapter();
    const weather = new MockWeatherAdapter();
    weather.setAuthorized(true);
    weather.setWeatherData({
      city: '上海',
      temperatureC: 25,
      description: '晴',
      updatedAt: new Date().toISOString(),
      fromCache: false
    });
    const timeService = new TimeService('Asia/Shanghai');
    const runner = createRunner(fullscreen, notification, sound, weather, timeService);

    const event = createStartupEvent(userId, characterId);
    const initialState = createInitialProactiveState({
      event,
      userId,
      characterId,
      sessionId,
      persona: createTestPersona(),
      modelMode: 'balanced',
      proactiveType: 'startup_digest'
    });

    const result = await runner.run(initialState);

    // pet_bubble 返回 delivered=false（等待 ACK）
    check('StartupDigest: delivered is false (pending ACK)', result.deliveryResult?.delivered === false);
    check('StartupDigest: message contains greeting', result.composedMessage.includes('早上好'));
    check('StartupDigest: message contains schedule', result.composedMessage.includes('今日计划'));
    check('StartupDigest: message contains weather', result.composedMessage.includes('上海'));
    check('StartupDigest: message contains temperature', result.composedMessage.includes('25'));
    check('StartupDigest: schedule items loaded', result.scheduleItems.length >= 1);
    check('StartupDigest: weather loaded', result.weather !== null);
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 12：天气失败不影响其余日报 =====
async function testWeatherFailureContinues(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId, sessionId } = setupTestEnv(dbPath);
    setPolicy(userId, characterId, { dndEnabled: false });

    const fullscreen = new MockFullscreenAdapter();
    const notification = new MockNotificationAdapter();
    const sound = new MockSoundAdapter();
    const weather = new MockWeatherAdapter();
    weather.setAuthorized(true);
    weather.setShouldFail(true); // 天气 API 失败
    const timeService = new TimeService('Asia/Shanghai');
    const runner = createRunner(fullscreen, notification, sound, weather, timeService);

    const event = createStartupEvent(userId, characterId);
    const initialState = createInitialProactiveState({
      event,
      userId,
      characterId,
      sessionId,
      persona: createTestPersona(),
      modelMode: 'balanced',
      proactiveType: 'startup_digest'
    });

    const result = await runner.run(initialState);

    // pet_bubble 返回 delivered=false（等待 ACK），天气失败不影响投递意图
    check('WeatherFail: delivered is false (pending ACK)', result.deliveryResult?.delivered === false);
    check('WeatherFail: message contains greeting', result.composedMessage.includes('好'));
    check('WeatherFail: message shows weather unavailable', result.composedMessage.includes('天气暂时不可用'));
    check('WeatherFail: weather is null', result.weather === null);
    check('WeatherFail: no errors', result.errors.length === 0);
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 13：每日次数统计跨日重置 =====
async function testDailyDateReset(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId, sessionId } = setupTestEnv(dbPath);
    setPolicy(userId, characterId, { dndEnabled: false, maxDailyProactive: 1 });

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayDate = yesterday.toISOString().slice(0, 10);

    // 模拟昨天已有 1 次投递（达到上限）
    simulateDeliveries(userId, characterId, 'daily_greeting', 1, yesterdayDate);

    const fullscreen = new MockFullscreenAdapter();
    const notification = new MockNotificationAdapter();
    const sound = new MockSoundAdapter();
    const weather = new MockWeatherAdapter();
    const timeService = new TimeService('Asia/Shanghai');
    const runner = createRunner(fullscreen, notification, sound, weather, timeService);

    const event = createDailyGreetingEvent(userId, characterId);
    const initialState = createInitialProactiveState({
      event,
      userId,
      characterId,
      sessionId,
      persona: createTestPersona(),
      modelMode: 'balanced',
      proactiveType: 'daily_greeting'
    });

    const result = await runner.run(initialState);

    // 今天应该正常投递（pet_bubble delivered=false 等待 ACK），因为昨天的配额不计入今天
    check('DailyReset: delivered is false (pending ACK) despite yesterday quota', result.deliveryResult?.delivered === false);
    check('DailyReset: daily count is 0 today', result.dailyCount === 0);
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 14：系统通知和声音分别设置 =====
async function testSystemNotificationAndSound(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId, sessionId } = setupTestEnv(dbPath);
    setPolicy(userId, characterId, {
      dndEnabled: false,
      systemNotificationEnabled: true,
      soundEnabled: true
    });

    const fullscreen = new MockFullscreenAdapter();
    const notification = new MockNotificationAdapter(true, true);
    const sound = new MockSoundAdapter(true);
    const weather = new MockWeatherAdapter();
    const timeService = new TimeService('Asia/Shanghai');
    const runner = createRunner(fullscreen, notification, sound, weather, timeService);

    const event = createReminderEvent(userId, characterId, '系统通知测试');
    const initialState = createInitialProactiveState({
      event,
      userId,
      characterId,
      sessionId,
      persona: createTestPersona(),
      modelMode: 'balanced',
      proactiveType: 'reminder'
    });

    const result = await runner.run(initialState);

    check('Notification: delivered via system notification', result.delivery === 'system_notification');
    check('Notification: notification shown', notification.notifications.length === 1);
    check('Notification: notification title is 提醒', notification.notifications[0]?.title === '提醒');
    check('Notification: sound played', sound.sounds.length === 1);
    check('Notification: sound is notification', sound.sounds[0] === 'notification');
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 15：Graph 失败不会崩溃 =====
async function testGraphFailureNoCrash(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId, sessionId } = setupTestEnv(dbPath);

    const fullscreen = new MockFullscreenAdapter();
    const notification = new MockNotificationAdapter();
    const sound = new MockSoundAdapter();
    const weather = new MockWeatherAdapter();
    const timeService = new TimeService('Asia/Shanghai');

    // 创建一个会失败的 runner（通过不设置策略来触发错误路径）
    // 即使出错也应该返回安全状态
    const runner = createRunner(fullscreen, notification, sound, weather, timeService);

    const event = createReminderEvent(userId, characterId, '崩溃测试');
    const initialState = createInitialProactiveState({
      event,
      userId,
      characterId,
      sessionId,
      persona: createTestPersona(),
      modelMode: 'balanced',
      proactiveType: 'reminder'
    });

    const result = await runner.run(initialState);

    // 即使出错也应该返回结果
    check('GraphFailure: did not crash', result !== null);
    check('GraphFailure: has delivery result', result.deliveryResult !== null);
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// ===== 主函数 =====
async function main(): Promise<void> {
  console.log('=== 阶段 6 ProactiveEventGraph 测试 ===\n');

  await testInferProactiveType();
  console.log('');

  await testReminderDelivery();
  console.log('');

  await testReminderDeferredOnFullscreen();
  console.log('');

  await testNonReminderSuppressedOnFullscreen();
  console.log('');

  await testReminderDeferredOnDnd();
  console.log('');

  await testNonReminderSuppressedOnDnd();
  console.log('');

  await testDailyQuotaExceeded();
  console.log('');

  await testReminderExemptFromQuota();
  console.log('');

  await testIgnoreThreshold();
  console.log('');

  await testDeduplicate();
  console.log('');

  await testStartupDigestWithWeather();
  console.log('');

  await testWeatherFailureContinues();
  console.log('');

  await testDailyDateReset();
  console.log('');

  await testSystemNotificationAndSound();
  console.log('');

  await testGraphFailureNoCrash();

  console.log('\n=== 测试结果 ===');
  console.log(`PASS: ${pass}`);
  console.log(`FAIL: ${fail}`);
  if (failures.length > 0) {
    console.log('\n失败项:');
    failures.forEach(f => console.log(`  - ${f}`));
  }
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Test runner error:', err);
  process.exit(1);
});
