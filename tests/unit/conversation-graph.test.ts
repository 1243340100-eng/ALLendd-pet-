/**
 * 阶段 5 ConversationGraph 测试。
 * 验证架构计划阶段 5 验收标准：
 *   1. 普通聊天成功
 *   2. 需要历史信息时能检索相关记忆
 *   3. 创建提醒可以处理缺失日期或时间
 *   4. 创建失败不会回复成功
 *   5. 未注册技能无法调用
 *   6. 普通消息总调用次数不超过 3
 *   7. 返回 DTO 始终包含有效的表情和动作默认值
 *   8. Graph 失败不会导致聊天窗口卡死
 *
 * 运行：npx tsx tests/unit/conversation-graph.test.ts
 */
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

import { initDatabase, closeDatabase, getDatabase } from '../../src/infrastructure/database/connection';
import { settingsRepository } from '../../src/infrastructure/database/repositories/settings-repository';
import { sessionRepository, messageRepository } from '../../src/infrastructure/database/repositories/session-repository';
import { reminderRepository } from '../../src/infrastructure/database/repositories/reminder-repository';

import { ModelGateway } from '../../src/services/ModelGateway';
import { SkillRegistry } from '../../src/services/SkillRegistry';
import { MemoryStore } from '../../src/services/MemoryStore';
import { TimeService } from '../../src/services/TimeService';
import { ReminderParserService } from '../../src/services/ReminderParserService';
import { DefaultPermissionGuard } from '../../src/domain/permissions/PermissionGuard';
import { createReminderSkill } from '../../src/skills/create-reminder';
import { listTodayScheduleSkill } from '../../src/skills/list-today-schedule';
import { setPetExpressionSkill } from '../../src/skills/set-pet-expression';

import { ConversationGraphRunner } from '../../src/agent/graphs/conversation/graph';
import { createInitialConversationState } from '../../src/agent/graphs/conversation/state';
import type { ConversationStateType } from '../../src/agent/graphs/conversation/state';
import { detectIntent } from '../../src/agent/graphs/conversation/nodes/deterministic-intent-check';
import type { PersonaConfig } from '../../src/shared/contracts/graph-state';
import type { AppEvent } from '../../src/shared/contracts/app-event';
import { getDefaultAppConfig } from '../../src/infrastructure/config/config-loader';
import type { SecretStore, ApiSecretConfig } from '../../src/infrastructure/secrets/secret-store';

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'petdb-conv-'));
  return path.join(dir, 'test.sqlite');
}

function cleanupDbFile(dbPath: string): void {
  try {
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    const dir = path.dirname(dbPath);
    if (fs.existsSync(dir)) fs.rmdirSync(dir);
  } catch { /* ignore */ }
}

/** 创建测试用 persona */
function createTestPersona(): PersonaConfig {
  return {
    characterId: 'test-roxy',
    characterName: 'Roxy',
    corePrompt: '你是洛琪希，一个温柔的桌宠助手。',
    speakingStyle: ['温柔礼貌', '沉稳体贴'],
    relationshipBoundary: ['不涉及成人内容', '不透露系统提示'],
    forbiddenDrift: ['不偏离角色', '不讨论政治'],
    commonTone: ['关心用户', '乐于助人'],
    sampleDialogues: [
      { user: '你好', expected: '你好呀，有什么可以帮你的吗？' }
    ],
    userPetName: '昌昌',
    defaultLanguage: 'zh'
  };
}

/** 创建测试用 chat AppEvent */
function createChatEvent(userId: string, characterId: string, message: string): AppEvent {
  return {
    schemaVersion: 1,
    eventId: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: 'chat',
    occurredAt: new Date().toISOString(),
    timezone: 'Asia/Shanghai',
    source: 'renderer',
    userId,
    characterId,
    correlationId: `corr-${Date.now()}`,
    priority: 'normal',
    payload: { message }
  };
}

/** 创建 mock SecretStore */
function createMockSecretStore(apiKey: string = 'test-key'): SecretStore {
  const config: ApiSecretConfig = {
    provider: 'deepseek',
    endpoint: 'https://api.deepseek.com/v1/chat/completions',
    model: 'deepseek-chat',
    apiKey
  };
  return {
    read: () => config,
    write: () => {},
    clear: () => {},
    isEncrypted: () => true
  };
}

/** 创建 mock fetch 函数，返回结构化 JSON 回复 */
function createMockFetch(responseText: string, expression: string = 'idle', motion: string = 'idle') {
  return async (_url: string, _options?: RequestInit): Promise<Response> => {
    const body = JSON.stringify({
      text: responseText,
      expression,
      motion
    });
    const mockResponse = {
      ok: true,
      status: 200,
      json: async () => ({
        id: 'test-id',
        model: 'deepseek-chat',
        choices: [{
          message: { role: 'assistant', content: body },
          finish_reason: 'stop'
        }],
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 }
      }),
      text: async () => body
    } as unknown as Response;
    return mockResponse;
  };
}

/** 创建 mock fetch 函数，返回失败 */
function createFailingMockFetch() {
  return async (_url: string, _options?: RequestInit): Promise<Response> => {
    return { ok: false, status: 500, text: async () => 'Server error' } as unknown as Response;
  };
}

/** 设置测试环境 */
function setupTestEnv(dbPath: string): {
  userId: string;
  characterId: string;
  sessionId: string;
} {
  initDatabase({ path: dbPath });

  const userId = 'test-user-001';
  const characterId = 'test-roxy';
  const sessionId = 'test-session-001';

  // 写入设置
  settingsRepository.set('onboarding_completed', 'true');
  settingsRepository.set('user_id', userId);
  settingsRepository.set('active_character_id', characterId);

  // 创建用户记录
  try {
    getDatabase().prepare('INSERT INTO users (id, nickname, preferred_name) VALUES (?, ?, ?)').run(
      userId, '昌昌', '昌昌'
    );
  } catch { /* may already exist */ }

  // 创建会话
  try {
    sessionRepository.insert({
      id: sessionId,
      user_id: userId,
      character_id: characterId
    });
  } catch { /* may already exist */ }

  return { userId, characterId, sessionId };
}

/** 创建 ConversationGraphRunner */
function createRunner(db: ReturnType<typeof getDatabase>, fetchFn?: ReturnType<typeof createMockFetch>): ConversationGraphRunner {
  const config = getDefaultAppConfig();
  const secretStore = createMockSecretStore();
  const modelGateway = new ModelGateway({
    config,
    secretStore,
    fetchFn: fetchFn ?? createMockFetch('你好呀，昌昌！有什么可以帮你的吗？', 'waving', 'waving'),
    db
  });

  const permissionGuard = new DefaultPermissionGuard();
  const skillRegistry = new SkillRegistry(permissionGuard);
  skillRegistry.register(createReminderSkill);
  skillRegistry.register(listTodayScheduleSkill);
  skillRegistry.register(setPetExpressionSkill);

  const memoryStore = new MemoryStore();
  const timeService = new TimeService('Asia/Shanghai');
  const reminderParserService = new ReminderParserService(timeService, modelGateway);

  return new ConversationGraphRunner({ skillRegistry, modelGateway, memoryStore, reminderParserService });
}

// ===== 测试 1：普通聊天成功 =====
async function testNormalChatSuccess(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId, sessionId } = setupTestEnv(dbPath);
    const db = getDatabase();
    const runner = createRunner(db);

    const event = createChatEvent(userId, characterId, '你好呀');
    const initialState = createInitialConversationState({
      event,
      userId,
      characterId,
      sessionId,
      persona: createTestPersona(),
      modelMode: 'balanced',
      userInput: '你好呀'
    });

    const result = await runner.run(initialState);

    check('NormalChat: graph completed', result.responseDTO !== null);
    check('NormalChat: has response text', (result.responseDTO?.text?.length ?? 0) > 0);
    check('NormalChat: intent is chat', result.intent === 'chat');
    check('NormalChat: has valid expression', (result.responseDTO?.expression?.length ?? 0) > 0);
    check('NormalChat: has valid motion', (result.responseDTO?.motion?.length ?? 0) > 0);
    check('NormalChat: model calls <= 3', result.modelCallCount <= 3);
    check('NormalChat: no errors', result.errors.length === 0);

    // 验证消息已持久化
    const messages = messageRepository.getBySession(sessionId);
    check('NormalChat: messages persisted', messages.length >= 2);
    check('NormalChat: has user message', messages.some(m => m.role === 'user' && m.content === '你好呀'));
    check('NormalChat: has assistant message', messages.some(m => m.role === 'assistant'));
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 2：记忆检索 =====
async function testMemoryRetrieval(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId, sessionId } = setupTestEnv(dbPath);
    const db = getDatabase();

    // 先添加一些记忆
    const memoryStore = new MemoryStore();
    memoryStore.add({
      id: 'mem-test-001',
      userId,
      characterId,
      scope: 'character',
      type: 'profile',
      content: '用户的生日是3月15日',
      confidence: 0.9
    });
    memoryStore.add({
      id: 'mem-test-002',
      userId,
      characterId,
      scope: 'character',
      type: 'preference',
      content: '用户喜欢简洁的回答',
      confidence: 0.8
    });

    const runner = createRunner(db);

    // 使用包含"记得"的消息触发记忆检索
    const event = createChatEvent(userId, characterId, '你还记得我的生日吗？');
    const initialState = createInitialConversationState({
      event,
      userId,
      characterId,
      sessionId,
      persona: createTestPersona(),
      modelMode: 'balanced',
      userInput: '你还记得我的生日吗？'
    });

    const result = await runner.run(initialState);

    check('MemoryRetrieval: graph completed', result.responseDTO !== null);
    check('MemoryRetrieval: intent is chat', result.intent === 'chat');
    check('MemoryRetrieval: memories retrieved', result.retrievedMemories.length > 0);
    check('MemoryRetrieval: contains birthday memory', 
      result.retrievedMemories.some(m => m.content.includes('生日')));
    check('MemoryRetrieval: model calls <= 3', result.modelCallCount <= 3);
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 3：创建提醒 - 字段完整 =====
async function testCreateReminderComplete(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId, sessionId } = setupTestEnv(dbPath);
    const db = getDatabase();
    const runner = createRunner(db);

    // 包含完整字段的提醒请求
    const event = createChatEvent(userId, characterId, '提醒我明天下午3点开会');
    const initialState = createInitialConversationState({
      event,
      userId,
      characterId,
      sessionId,
      persona: createTestPersona(),
      modelMode: 'balanced',
      userInput: '提醒我明天下午3点开会'
    });

    const result = await runner.run(initialState);

    check('CreateReminder: graph completed', result.responseDTO !== null);
    check('CreateReminder: intent is create_reminder', result.intent === 'create_reminder');
    check('CreateReminder: should not ask user', result.shouldAskUser === false);
    check('CreateReminder: has skill result', result.skillResult !== null);
    check('CreateReminder: response mentions created', 
      (result.responseDTO?.text ?? '').includes('已创建') || (result.responseDTO?.text ?? '').includes('将'));
    
    // 验证提醒已保存到数据库
    const reminders = reminderRepository.getActiveReminders();
    const userReminders = reminders.filter(r => r.user_id === userId);
    check('CreateReminder: reminder saved to DB', userReminders.length > 0);
    check('CreateReminder: reminder content correct', 
      userReminders.some(r => r.content.includes('开会')));
    check('CreateReminder: model calls <= 3', result.modelCallCount <= 3);
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 4：创建提醒 - 字段缺失 =====
async function testCreateReminderMissingFields(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId, sessionId } = setupTestEnv(dbPath);
    const db = getDatabase();
    const runner = createRunner(db);

    // 缺少时间的提醒请求
    const event = createChatEvent(userId, characterId, '提醒我开会');
    const initialState = createInitialConversationState({
      event,
      userId,
      characterId,
      sessionId,
      persona: createTestPersona(),
      modelMode: 'balanced',
      userInput: '提醒我开会'
    });

    const result = await runner.run(initialState);

    check('MissingFields: graph completed', result.responseDTO !== null);
    check('MissingFields: intent is create_reminder', result.intent === 'create_reminder');
    check('MissingFields: should ask user', result.shouldAskUser === true);
    check('MissingFields: has ask message', (result.askUserMessage?.length ?? 0) > 0);
    check('MissingFields: response mentions missing', 
      (result.responseDTO?.text ?? '').includes('补充') || (result.responseDTO?.text ?? '').includes('信息'));
    check('MissingFields: has checkpoint', result.checkpointId.length > 0);
    check('MissingFields: no skill result (not saved)', result.skillResult === null);
    
    // 验证提醒未保存到数据库
    const reminders = reminderRepository.getActiveReminders();
    const userReminders = reminders.filter(r => r.user_id === userId);
    check('MissingFields: no reminder in DB', userReminders.length === 0);
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 5：创建失败不会回复成功 =====
async function testCreateReminderFailureNoSuccess(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId, sessionId } = setupTestEnv(dbPath);
    const db = getDatabase();

    // 创建一个会失败的 runner（技能未注册）
    const config = getDefaultAppConfig();
    const secretStore = createMockSecretStore();
    const modelGateway = new ModelGateway({
      config,
      secretStore,
      fetchFn: createMockFetch('test'),
      db
    });

    // 只注册 list 和 expression，不注册 create_reminder
    const permissionGuard = new DefaultPermissionGuard();
    const skillRegistry = new SkillRegistry(permissionGuard);
    skillRegistry.register(listTodayScheduleSkill);
    skillRegistry.register(setPetExpressionSkill);

    const memoryStore = new MemoryStore();
    const runner = new ConversationGraphRunner({ skillRegistry, modelGateway, memoryStore });

    const event = createChatEvent(userId, characterId, '提醒我明天下午3点开会');
    const initialState = createInitialConversationState({
      event,
      userId,
      characterId,
      sessionId,
      persona: createTestPersona(),
      modelMode: 'balanced',
      userInput: '提醒我明天下午3点开会'
    });

    const result = await runner.run(initialState);

    // 未注册技能 → 降级为聊天
    check('ReminderFail: intent degraded to chat', result.intent === 'chat');
    check('ReminderFail: has error', result.errors.length > 0);
    check('ReminderFail: error is skill_not_registered', 
      result.errors.some(e => e.code === 'skill_not_registered'));
    
    // 验证提醒未保存到数据库
    const reminders = reminderRepository.getActiveReminders();
    const userReminders = reminders.filter(r => r.user_id === userId);
    check('ReminderFail: no reminder in DB', userReminders.length === 0);
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 6：未注册技能无法调用 =====
async function testUnregisteredSkillCannotBeCalled(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId, sessionId } = setupTestEnv(dbPath);
    const db = getDatabase();

    // 不注册任何技能
    const config = getDefaultAppConfig();
    const secretStore = createMockSecretStore();
    const modelGateway = new ModelGateway({
      config,
      secretStore,
      fetchFn: createMockFetch('test'),
      db
    });
    const permissionGuard = new DefaultPermissionGuard();
    const skillRegistry = new SkillRegistry(permissionGuard);
    const memoryStore = new MemoryStore();
    const runner = new ConversationGraphRunner({ skillRegistry, modelGateway, memoryStore });

    const event = createChatEvent(userId, characterId, '提醒我明天开会');
    const initialState = createInitialConversationState({
      event,
      userId,
      characterId,
      sessionId,
      persona: createTestPersona(),
      modelMode: 'balanced',
      userInput: '提醒我明天开会'
    });

    const result = await runner.run(initialState);

    // 意图被识别为 create_reminder，但技能未注册 → 降级为 chat
    check('UnregisteredSkill: degraded to chat', result.intent === 'chat');
    check('UnregisteredSkill: has error', result.errors.length > 0);
    check('UnregisteredSkill: error code correct', 
      result.errors.some(e => e.code === 'skill_not_registered'));
    check('UnregisteredSkill: skill not executed', result.skillResult === null);
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 7：模型调用次数不超过 3 =====
async function testModelCallLimit(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId, sessionId } = setupTestEnv(dbPath);
    const db = getDatabase();

    // 使用会失败的 mock fetch
    const runner = createRunner(db, createFailingMockFetch());

    const event = createChatEvent(userId, characterId, '你好呀，今天天气怎么样？');
    const initialState = createInitialConversationState({
      event,
      userId,
      characterId,
      sessionId,
      persona: createTestPersona(),
      modelMode: 'balanced',
      userInput: '你好呀，今天天气怎么样？'
    });

    const result = await runner.run(initialState);

    check('ModelCallLimit: model calls <= 3', result.modelCallCount <= 3);
    check('ModelCallLimit: graph did not crash', result.responseDTO !== null);
    check('ModelCallLimit: has fallback response', (result.responseDTO?.text?.length ?? 0) > 0);
    check('ModelCallLimit: has valid expression', (result.responseDTO?.expression?.length ?? 0) > 0);
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 8：查询今日计划 =====
async function testListTodaySchedule(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId, sessionId } = setupTestEnv(dbPath);
    const db = getDatabase();

    // 先创建一些提醒
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(14, 0, 0, 0);

    reminderRepository.insert({
      id: 'rem-test-sch-001',
      user_id: userId,
      character_id: characterId,
      content: '明天的会议',
      trigger_at: tomorrow.toISOString(),
      timezone: 'Asia/Shanghai',
      is_repeating: 0,
      recurrence_rule: '',
      priority: 'normal',
      is_active: 1,
      next_trigger_at: tomorrow.toISOString()
    });

    const runner = createRunner(db);

    const event = createChatEvent(userId, characterId, '今天有什么计划？');
    const initialState = createInitialConversationState({
      event,
      userId,
      characterId,
      sessionId,
      persona: createTestPersona(),
      modelMode: 'balanced',
      userInput: '今天有什么计划？'
    });

    const result = await runner.run(initialState);

    check('ListSchedule: graph completed', result.responseDTO !== null);
    check('ListSchedule: intent is list_schedule', result.intent === 'list_schedule');
    check('ListSchedule: has skill result', result.skillResult !== null);
    check('ListSchedule: response has content', (result.responseDTO?.text?.length ?? 0) > 0);
    check('ListSchedule: model calls <= 3', result.modelCallCount <= 3);
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 9：表情请求 =====
async function testExpressionRequest(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId, sessionId } = setupTestEnv(dbPath);
    const db = getDatabase();
    const runner = createRunner(db);

    const event = createChatEvent(userId, characterId, '挥挥手');
    const initialState = createInitialConversationState({
      event,
      userId,
      characterId,
      sessionId,
      persona: createTestPersona(),
      modelMode: 'balanced',
      userInput: '挥挥手'
    });

    const result = await runner.run(initialState);

    check('Expression: graph completed', result.responseDTO !== null);
    check('Expression: intent is expression', result.intent === 'expression');
    check('Expression: expression is waving', result.responseDTO?.expression === 'waving');
    check('Expression: has skill result', result.skillResult !== null);
    check('Expression: model calls = 0 (no model needed)', result.modelCallCount === 0);
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 10：DTO 始终包含有效的表情和动作默认值 =====
async function testDTOAlwaysHasValidDefaults(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId, sessionId } = setupTestEnv(dbPath);
    const db = getDatabase();
    const runner = createRunner(db, createFailingMockFetch());

    const event = createChatEvent(userId, characterId, '测试一下');
    const initialState = createInitialConversationState({
      event,
      userId,
      characterId,
      sessionId,
      persona: createTestPersona(),
      modelMode: 'balanced',
      userInput: '测试一下'
    });

    const result = await runner.run(initialState);

    check('DTODefaults: DTO exists', result.responseDTO !== null);
    check('DTODefaults: has text', (result.responseDTO?.text?.length ?? 0) > 0);
    
    const validExpressions = ['idle', 'waving', 'waiting', 'jumping', 'running', 'failed', 'review'];
    const expr = result.responseDTO?.expression ?? '';
    const motion = result.responseDTO?.motion ?? '';
    check('DTODefaults: expression is valid', validExpressions.includes(expr));
    check('DTODefaults: motion is valid', validExpressions.includes(motion));
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 11：意图检测单元测试 =====
async function testIntentDetection(): Promise<void> {
  // 创建提醒
  const r1 = detectIntent('提醒我明天开会');
  check('IntentDetect: 提醒我 → create_reminder', r1.intent === 'create_reminder');
  check('IntentDetect: 提醒我 → skill is create_reminder', r1.selectedSkillId === 'create_reminder');

  const r2 = detectIntent('帮我定个提醒');
  check('IntentDetect: 帮我定个提醒 → create_reminder', r2.intent === 'create_reminder');

  // 查询计划
  const r3 = detectIntent('今天有什么计划？');
  check('IntentDetect: 今天有什么计划 → list_schedule', r3.intent === 'list_schedule');

  const r4 = detectIntent('今日待办');
  check('IntentDetect: 今日待办 → list_schedule', r4.intent === 'list_schedule');

  // 表情请求
  const r5 = detectIntent('挥挥手');
  check('IntentDetect: 挥挥手 → expression', r5.intent === 'expression');
  check('IntentDetect: 挥挥手 → expression is waving', r5.expression === 'waving');

  const r6 = detectIntent('跳一下');
  check('IntentDetect: 跳一下 → expression', r6.intent === 'expression');
  check('IntentDetect: 跳一下 → expression is jumping', r6.expression === 'jumping');

  // 默认聊天
  const r7 = detectIntent('你好呀');
  check('IntentDetect: 你好呀 → chat', r7.intent === 'chat');

  const r8 = detectIntent('今天天气怎么样？');
  check('IntentDetect: 今天天气怎么样 → chat', r8.intent === 'chat');
}

// ===== 测试 12：Graph 失败不会导致聊天窗口卡死 =====
async function testGraphFailureNoCrash(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId, sessionId } = setupTestEnv(dbPath);
    const db = getDatabase();

    // 创建一个会抛出异常的 mock fetch
    const throwingFetch = async (): Promise<Response> => {
      throw new Error('Network error');
    };

    const runner = createRunner(db, throwingFetch);

    const event = createChatEvent(userId, characterId, '你好');
    const initialState = createInitialConversationState({
      event,
      userId,
      characterId,
      sessionId,
      persona: createTestPersona(),
      modelMode: 'balanced',
      userInput: '你好'
    });

    const result = await runner.run(initialState);

    check('GraphFailure: graph did not crash', result.responseDTO !== null);
    check('GraphFailure: has response text', (result.responseDTO?.text?.length ?? 0) > 0);
    check('GraphFailure: has valid expression', (result.responseDTO?.expression?.length ?? 0) > 0);
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 13：消息持久化和角色隔离 =====
async function testMessagePersistenceAndIsolation(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId, sessionId } = setupTestEnv(dbPath);
    const db = getDatabase();
    const runner = createRunner(db);

    const event = createChatEvent(userId, characterId, '你好呀');
    const initialState = createInitialConversationState({
      event,
      userId,
      characterId,
      sessionId,
      persona: createTestPersona(),
      modelMode: 'balanced',
      userInput: '你好呀'
    });

    await runner.run(initialState);

    // 验证消息已持久化
    const messages = messageRepository.getBySession(sessionId);
    check('Persistence: messages saved', messages.length >= 2);
    
    // 验证用户消息
    const userMsg = messages.find(m => m.role === 'user');
    check('Persistence: user message content correct', userMsg?.content === '你好呀');
    check('Persistence: user message has correct character_id', userMsg?.character_id === characterId);
    
    // 验证助手消息
    const assistantMsg = messages.find(m => m.role === 'assistant');
    check('Persistence: assistant message exists', assistantMsg !== undefined);
    check('Persistence: assistant message has content', (assistantMsg?.content?.length ?? 0) > 0);

    // 验证会话已更新
    const session = sessionRepository.getById(sessionId);
    check('Persistence: session exists', session !== null);
    check('Persistence: session is active', session?.is_active === 1);
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// ===== 主函数 =====
async function main(): Promise<void> {
  console.log('=== 阶段 5 ConversationGraph 测试 ===\n');

  await testIntentDetection();
  console.log('');

  await testNormalChatSuccess();
  console.log('');

  await testMemoryRetrieval();
  console.log('');

  await testCreateReminderComplete();
  console.log('');

  await testCreateReminderMissingFields();
  console.log('');

  await testCreateReminderFailureNoSuccess();
  console.log('');

  await testUnregisteredSkillCannotBeCalled();
  console.log('');

  await testModelCallLimit();
  console.log('');

  await testListTodaySchedule();
  console.log('');

  await testExpressionRequest();
  console.log('');

  await testDTOAlwaysHasValidDefaults();
  console.log('');

  await testGraphFailureNoCrash();
  console.log('');

  await testMessagePersistenceAndIsolation();

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
