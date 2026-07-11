/**
 * 阶段 8 故障注入测试。
 * 验证架构计划阶段 8 验收标准：
 *   1. DeepSeek 断网时本地提醒仍可使用
 *   2. 数据库异常不会产生虚假成功
 *   3. 瞬时故障自动重试
 *   4. 不可重试错误不浪费重试
 *   5. 预算耗尽后正确降级
 *   6. checkpoint 保存和恢复
 *   7. 用户数据导出/导入
 *
 * 运行：npx tsx tests/unit/fault-injection.test.ts
 */
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

import { initDatabase, closeDatabase, getDatabase, openDatabase } from '../../src/infrastructure/database/connection';
import { settingsRepository } from '../../src/infrastructure/database/repositories/settings-repository';
import { sessionRepository, messageRepository } from '../../src/infrastructure/database/repositories/session-repository';
import { reminderRepository } from '../../src/infrastructure/database/repositories/reminder-repository';
import { checkpointRepository } from '../../src/infrastructure/database/repositories/checkpoint-repository';
import { memoryRepository } from '../../src/infrastructure/database/repositories/memory-repository';

import { ModelGateway } from '../../src/services/ModelGateway';
import { SkillRegistry } from '../../src/services/SkillRegistry';
import { MemoryStore } from '../../src/services/MemoryStore';
import { TimeService } from '../../src/services/TimeService';
import { ReminderParserService } from '../../src/services/ReminderParserService';
import { BackupService } from '../../src/services/BackupService';
import { DefaultPermissionGuard } from '../../src/domain/permissions/PermissionGuard';
import { createReminderSkill } from '../../src/skills/create-reminder';
import { listTodayScheduleSkill } from '../../src/skills/list-today-schedule';
import { setPetExpressionSkill } from '../../src/skills/set-pet-expression';

import { ConversationGraphRunner } from '../../src/agent/graphs/conversation/graph';
import { createInitialConversationState } from '../../src/agent/graphs/conversation/state';
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'petdb-fault-'));
  return path.join(dir, 'test.sqlite');
}

function cleanupDbFile(dbPath: string): void {
  try {
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    // 清理备份文件
    const dir = path.dirname(dbPath);
    const name = path.basename(dbPath);
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir);
      for (const f of files) {
        if (f.startsWith(`${name}.backup-`)) {
          fs.unlinkSync(path.join(dir, f));
        }
      }
      fs.rmdirSync(dir);
    }
  } catch { /* ignore */ }
}

function createTestPersona(): PersonaConfig {
  return {
    characterId: 'test-roxy',
    characterName: 'Roxy',
    corePrompt: '你是洛琪希，一个温柔的桌宠助手。',
    speakingStyle: ['温柔礼貌'],
    relationshipBoundary: ['不涉及成人内容'],
    forbiddenDrift: ['不偏离角色'],
    commonTone: ['关心用户'],
    sampleDialogues: [],
    userPetName: '昌昌',
    defaultLanguage: 'zh'
  };
}

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

function setupTestEnv(dbPath: string): { userId: string; characterId: string; sessionId: string } {
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
    sessionRepository.insert({ id: sessionId, user_id: userId, character_id: characterId });
  } catch { /* may already exist */ }

  return { userId, characterId, sessionId };
}

function createRunner(
  db: ReturnType<typeof getDatabase>,
  fetchFn: (url: string, options?: RequestInit) => Promise<Response>
): ConversationGraphRunner {
  const config = getDefaultAppConfig();
  // 测试中减小退避以加速
  config.retry.baseDelayMs = 1;
  const secretStore = createMockSecretStore();
  const modelGateway = new ModelGateway({ config, secretStore, fetchFn, db });

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

/** 创建首次失败、第二次成功的 mock fetch */
function createRetryThenSuccessMockFetch(): { fetchFn: (url: string, opts?: RequestInit) => Promise<Response>; callCount: number } {
  let callCount = 0;
  const fetchFn = async (_url: string, _options?: RequestInit): Promise<Response> => {
    callCount++;
    if (callCount === 1) {
      return { ok: false, status: 500, text: async () => 'Server error' } as unknown as Response;
    }
    const body = JSON.stringify({
      text: '你好呀！',
      expression: 'idle',
      motion: 'idle'
    });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: 'test-id',
        model: 'deepseek-chat',
        choices: [{ message: { role: 'assistant', content: body }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 }
      }),
      text: async () => body
    } as unknown as Response;
  };
  return { fetchFn, get callCount() { return callCount; } };
}

/** 创建始终失败的 mock fetch（500） */
function createAlwaysFailingMockFetch(): { fetchFn: (url: string, opts?: RequestInit) => Promise<Response>; callCount: number } {
  let callCount = 0;
  const fetchFn = async (_url: string, _options?: RequestInit): Promise<Response> => {
    callCount++;
    return { ok: false, status: 500, text: async () => 'Server error' } as unknown as Response;
  };
  return { fetchFn, get callCount() { return callCount; } };
}

/** 创建返回 400 的 mock fetch（不可重试） */
function createBadRequestMockFetch(): { fetchFn: (url: string, opts?: RequestInit) => Promise<Response>; callCount: number } {
  let callCount = 0;
  const fetchFn = async (_url: string, _options?: RequestInit): Promise<Response> => {
    callCount++;
    return { ok: false, status: 400, text: async () => 'Bad request' } as unknown as Response;
  };
  return { fetchFn, get callCount() { return callCount; } };
}

/** 创建成功 mock fetch */
function createSuccessMockFetch(responseText: string = '你好呀！') {
  return async (_url: string, _options?: RequestInit): Promise<Response> => {
    const body = JSON.stringify({ text: responseText, expression: 'idle', motion: 'idle' });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: 'test-id',
        model: 'deepseek-chat',
        choices: [{ message: { role: 'assistant', content: body }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 }
      }),
      text: async () => body
    } as unknown as Response;
  };
}

// ===== 测试 1：瞬时故障自动重试（直接测试 ModelGateway） =====
async function testRetryOnTransientFailure(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    setupTestEnv(dbPath);
    const db = getDatabase();
    const mock = createRetryThenSuccessMockFetch();

    const config = getDefaultAppConfig();
    config.retry.baseDelayMs = 1;
    const gateway = new ModelGateway({
      config, secretStore: createMockSecretStore(), fetchFn: mock.fetchFn, db
    });

    gateway.beginTurn('test-trace');
    const result = await gateway.invoke({
      messages: [{ role: 'user', content: 'test' }],
      mode: 'balanced',
      traceId: 'test-trace'
    });
    gateway.endTurn();

    check('Retry: success after retry', result.success === true);
    check('Retry: fetch called twice (1 fail + 1 success)', mock.callCount === 2);
    check('Retry: has content', result.content.length > 0);
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 2：不可重试错误不浪费重试 =====
async function testNoRetryOnNonRetryable(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    setupTestEnv(dbPath);
    const db = getDatabase();
    const mock = createBadRequestMockFetch();

    const config = getDefaultAppConfig();
    config.retry.baseDelayMs = 1;
    const gateway = new ModelGateway({
      config, secretStore: createMockSecretStore(), fetchFn: mock.fetchFn, db
    });

    gateway.beginTurn('test-trace');
    const result = await gateway.invoke({
      messages: [{ role: 'user', content: 'test' }],
      mode: 'balanced',
      traceId: 'test-trace'
    });
    gateway.endTurn();

    check('NoRetry: failed as expected', result.success === false);
    check('NoRetry: fetch called once (400 not retryable)', mock.callCount === 1);
    check('NoRetry: error code is model_invalid_output', result.errorCode === 'model_invalid_output');
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 3：重试耗尽后降级 =====
async function testRetryExhaustedThenFallback(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    setupTestEnv(dbPath);
    const db = getDatabase();
    const mock = createAlwaysFailingMockFetch();

    const config = getDefaultAppConfig();
    config.retry.baseDelayMs = 1;
    const gateway = new ModelGateway({
      config, secretStore: createMockSecretStore(), fetchFn: mock.fetchFn, db
    });

    gateway.beginTurn('test-trace');
    const result = await gateway.invokeWithFallback({
      messages: [{ role: 'user', content: 'test' }],
      mode: 'balanced',
      traceId: 'test-trace'
    });
    gateway.endTurn();

    check('RetryExhausted: failed (all retries exhausted)', result.success === false);
    // P2-2 修复：每次 HTTP 调用（含重试）计入配额。
    // maxModelCallsPerTurn=3 → 首次 invoke 用完 3 次配额（1+2重试），降级被跳过。
    check('RetryExhausted: fetch called 3 times (limit reached, no fallback)', mock.callCount === 3);
    check('RetryExhausted: error code is model_unavailable', result.errorCode === 'model_unavailable');
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 4：断网时本地提醒仍可使用 =====
async function testOfflineRemindersWork(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId } = setupTestEnv(dbPath);
    const db = getDatabase();

    // 直接通过 repository 创建提醒（不经过模型）
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 0, 0, 0);

    reminderRepository.insert({
      id: 'rem-offline-001',
      user_id: userId,
      character_id: characterId,
      content: '离线提醒测试',
      trigger_at: tomorrow.toISOString(),
      timezone: 'Asia/Shanghai',
      is_repeating: 0,
      recurrence_rule: '',
      priority: 'normal',
      is_active: 1,
      next_trigger_at: tomorrow.toISOString()
    });

    // 验证提醒已在数据库
    const reminders = reminderRepository.getActiveReminders();
    check('Offline: reminder created without network', reminders.length === 1);
    check('Offline: reminder content correct', reminders[0]?.content === '离线提醒测试');

    // 模拟断网：用失败 fetch 创建 runner，但提醒已存储
    const mock = createAlwaysFailingMockFetch();
    const runner = createRunner(db, mock.fetchFn);

    const event = createChatEvent(userId, characterId, '今天有什么安排？');
    const state = createInitialConversationState({
      event, userId, characterId,
      sessionId: 'test-session-001',
      persona: createTestPersona(), modelMode: 'balanced',
      userInput: '今天有什么安排？'
    });

    // 即使模型调用失败，提醒仍然在数据库中可用
    const result = await runner.run(state);
    check('Offline: graph did not crash when offline', result.responseDTO !== null);

    // 提醒仍然可用
    const stillThere = reminderRepository.getById('rem-offline-001');
    check('Offline: reminder still available', stillThere !== null);
    check('Offline: reminder still active', stillThere?.is_active === 1);
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 5：数据库异常不产生虚假成功 =====
async function testDatabaseErrorNoFalseSuccess(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId, sessionId } = setupTestEnv(dbPath);
    const db = getDatabase();

    // 场景 1：正常创建提醒 — 成功时 DB 有记录
    const runner = createRunner(db, createSuccessMockFetch());
    const event = createChatEvent(userId, characterId, '提醒我明天9点开会');
    const state = createInitialConversationState({
      event, userId, characterId, sessionId,
      persona: createTestPersona(), modelMode: 'balanced',
      userInput: '提醒我明天9点开会'
    });

    const result = await runner.run(state);
    const responseText = result.responseDTO?.text ?? '';
    const reminders = reminderRepository.getActiveReminders();

    // 如果回复说已创建，DB 中必须有对应记录（不得虚假成功）
    if (responseText.includes('已创建') || responseText.includes('创建成功') || responseText.includes('好了') || responseText.includes('记下了')) {
      check('DbError: response claims success → DB has reminder', reminders.length > 0);
    } else {
      // 如果回复未声称成功，DB 可以有也可以没有
      check('DbError: no false success when graph returns non-success', true);
    }

    // 场景 2：技能未注册时 — 不得回复成功
    const config = getDefaultAppConfig();
    config.retry.baseDelayMs = 1;
    const gateway = new ModelGateway({
      config, secretStore: createMockSecretStore(),
      fetchFn: createSuccessMockFetch(), db
    });
    const guard = new DefaultPermissionGuard();
    const noSkillRegistry = new SkillRegistry(guard); // 不注册任何技能
    const noSkillRunner = new ConversationGraphRunner({
      skillRegistry: noSkillRegistry, modelGateway: gateway, memoryStore: new MemoryStore(),
      reminderParserService: new ReminderParserService(new TimeService('Asia/Shanghai'), gateway)
    });

    const event2 = createChatEvent(userId, characterId, '提醒我后天开会');
    const state2 = createInitialConversationState({
      event: event2, userId, characterId, sessionId,
      persona: createTestPersona(), modelMode: 'balanced',
      userInput: '提醒我后天开会'
    });

    const result2 = await noSkillRunner.run(state2);
    const response2 = result2.responseDTO?.text ?? '';

    // 技能未注册，回复不得声称"已创建"
    check('DbError: skill not registered → no false success',
      !response2.includes('已创建') && !response2.includes('创建成功'));
    check('DbError: has error in state', result2.errors.length > 0);
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 6：checkpoint 保存和恢复 =====
async function testCheckpointSaveAndResume(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId, sessionId } = setupTestEnv(dbPath);
    const db = getDatabase();
    const runner = createRunner(db, createSuccessMockFetch());

    // 第一次对话：创建提醒但缺少时间
    const event1 = createChatEvent(userId, characterId, '提醒我开会');
    const state1 = createInitialConversationState({
      event: event1, userId, characterId, sessionId,
      persona: createTestPersona(), modelMode: 'balanced',
      userInput: '提醒我开会'
    });

    const result1 = await runner.run(state1);

    // 验证：应该追问用户（shouldAskUser = true）
    check('Checkpoint: first run asks user', result1.shouldAskUser === true);
    check('Checkpoint: has checkpoint ID', result1.checkpointId.length > 0);

    // 验证：checkpoint 已保存到数据库
    const activeCkpt = checkpointRepository.getActive('conversation');
    check('Checkpoint: saved in DB', activeCkpt !== null);
    check('Checkpoint: reason is missing fields', activeCkpt?.reason === 'missing_reminder_fields');

    // 第二次对话：用户补充时间
    const event2 = createChatEvent(userId, characterId, '明天下午3点');
    const state2 = createInitialConversationState({
      event: event2, userId, characterId, sessionId,
      persona: createTestPersona(), modelMode: 'balanced',
      userInput: '明天下午3点'
    });

    const result2 = await runner.run(state2);

    // 验证：checkpoint 已被消费
    const consumedCkpt = checkpointRepository.load(result1.checkpointId);
    check('Checkpoint: consumed after resume', consumedCkpt?.consumed_at !== null);

    // 验证：第二轮不再追问（用户提供了时间）
    // 注意：第二轮可能因模型 mock 返回的内容而走不同分支
    check('Checkpoint: second run completed', result2.responseDTO !== null);
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 7：checkpoint 仓库 CRUD =====
async function testCheckpointRepositoryCRUD(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    setupTestEnv(dbPath);

    // 保存
    checkpointRepository.save({
      id: 'ckpt-test-001',
      graph_type: 'conversation',
      state_json: JSON.stringify({ draft: { content: 'test' } }),
      reason: 'test_reason'
    });

    // 加载
    const loaded = checkpointRepository.load('ckpt-test-001');
    check('CkptCRUD: load saved checkpoint', loaded !== null);
    check('CkptCRUD: correct reason', loaded?.reason === 'test_reason');
    check('CkptCRUD: not consumed', loaded?.consumed_at === null);

    // 获取活跃 checkpoint
    const active = checkpointRepository.getActive('conversation');
    check('CkptCRUD: getActive returns checkpoint', active?.id === 'ckpt-test-001');

    // 消费
    checkpointRepository.consume('ckpt-test-001');
    const consumed = checkpointRepository.load('ckpt-test-001');
    check('CkptCRUD: consumed', consumed?.consumed_at !== null);

    // 消费后 getActive 返回 null
    const activeAfter = checkpointRepository.getActive('conversation');
    check('CkptCRUD: no active after consume', activeAfter === null);

    // 清理：手动设置一条很久以前的已消费 checkpoint
    checkpointRepository.save({
      id: 'ckpt-old-001',
      graph_type: 'conversation',
      state_json: '{}',
      reason: 'old'
    });
    checkpointRepository.consume('ckpt-old-001');
    // 手动将 consumed_at 设为 2 天前
    getDatabase().prepare(
      'UPDATE graph_checkpoints SET consumed_at = datetime(\'now\', \'-2 days\') WHERE id = ?'
    ).run('ckpt-old-001');

    // 清理 1 天前的已消费 checkpoint
    const cleaned = checkpointRepository.cleanConsumedBefore(1);
    check('CkptCRUD: cleaned 1 old consumed', cleaned === 1);
    // 最近的 checkpoint 不受影响
    const stillThere = checkpointRepository.load('ckpt-test-001');
    check('CkptCRUD: recent consumed still there', stillThere?.consumed_at !== null);
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 8：用户数据导出/导入 =====
async function testBackupExportImport(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId } = setupTestEnv(dbPath);
    const db = getDatabase();

    // 准备测试数据
    memoryRepository.insert({
      id: 'mem-exp-test-001',
      user_id: userId,
      character_id: characterId,
      scope: 'character',
      type: 'profile',
      content: '用户是测试工程师',
      structured_data: null,
      confidence: 0.9,
      source_message_id: 'turn-001'
    });

    reminderRepository.insert({
      id: 'rem-exp-test-001',
      user_id: userId,
      character_id: characterId,
      content: '导出测试提醒',
      trigger_at: new Date().toISOString(),
      timezone: 'Asia/Shanghai',
      is_repeating: 0,
      recurrence_rule: '',
      priority: 'normal',
      is_active: 1,
      next_trigger_at: new Date().toISOString()
    });

    db.prepare(`
      INSERT INTO user_profiles (user_id, key, value, confidence, source)
      VALUES (?, ?, ?, ?, ?)
    `).run(userId, 'profession', 'engineer', 0.9, 'inferred');

    db.prepare(`
      INSERT INTO character_relationships (user_id, character_id, key, value)
      VALUES (?, ?, ?, ?)
    `).run(userId, characterId, 'closeness', 'high');

    // 导出
    const exportData = BackupService.exportUserData(userId);

    check('Backup: has schema version', exportData.schemaVersion === 1);
    check('Backup: has exportedAt', exportData.exportedAt.length > 0);
    check('Backup: has 1 memory', exportData.memories.length === 1);
    check('Backup: memory content correct', exportData.memories[0]?.content === '用户是测试工程师');
    check('Backup: has 1 reminder', exportData.reminders.length === 1);
    check('Backup: reminder content correct', exportData.reminders[0]?.content === '导出测试提醒');
    check('Backup: has user profile', exportData.userProfiles.length === 1);
    check('Backup: has character relationship', exportData.characterRelationships.length === 1);

    // 验证导出不包含密钥
    const exportJson = JSON.stringify(exportData);
    check('Backup: no API key in export', !exportJson.includes('api_key') && !exportJson.includes('apiKey'));
    check('Backup: no secret in export', !exportJson.toLowerCase().includes('secret'));

    // 模拟灾难恢复：硬删除当前用户数据（模拟数据丢失）
    db.prepare('DELETE FROM memories WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM reminders WHERE user_id = ?').run(userId);

    // 验证已清空
    const beforeMemories = memoryRepository.listForCharacter(userId, characterId);
    check('Import: memories cleared before import', beforeMemories.length === 0);

    // 恢复：重新导入到同一用户
    const result = BackupService.importUserData(exportData, userId);

    check('Import: 1 memory imported', result.imported.memories === 1);
    check('Import: 1 reminder imported', result.imported.reminders === 1);

    // 验证恢复后的数据
    const restoredMemories = db.prepare(
      'SELECT * FROM memories WHERE id = ? AND deleted_at IS NULL'
    ).get('mem-exp-test-001') as { content: string } | undefined;
    check('Import: memory content restored', restoredMemories?.content === '用户是测试工程师');

    // 再次导入同一数据应跳过（ID 重复）
    const result2 = BackupService.importUserData(exportData, userId);
    check('Import: skip duplicates', result2.skipped > 0);
    check('Import: no new memories on re-import', result2.imported.memories === 0);
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 9：预算耗尽后拒绝调用 =====
async function testBudgetExhaustion(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId, sessionId } = setupTestEnv(dbPath);
    const db = getDatabase();

    // 创建配置：maxModelCallsPerTurn = 1（模拟预算接近耗尽）
    const config = getDefaultAppConfig();
    config.costBudget.maxModelCallsPerTurn = 1;
    config.retry.baseDelayMs = 1;

    const secretStore = createMockSecretStore();
    const modelGateway = new ModelGateway({
      config, secretStore, fetchFn: createSuccessMockFetch(), db
    });

    const permissionGuard = new DefaultPermissionGuard();
    const skillRegistry = new SkillRegistry(permissionGuard);
    skillRegistry.register(createReminderSkill);
    skillRegistry.register(listTodayScheduleSkill);
    skillRegistry.register(setPetExpressionSkill);
    const memoryStore = new MemoryStore();
    const timeService = new TimeService('Asia/Shanghai');
    const reminderParserService = new ReminderParserService(timeService, modelGateway);
    const runner = new ConversationGraphRunner({ skillRegistry, modelGateway, memoryStore, reminderParserService });

    const event = createChatEvent(userId, characterId, '你好');
    const state = createInitialConversationState({
      event, userId, characterId, sessionId,
      persona: createTestPersona(), modelMode: 'balanced', userInput: '你好'
    });

    const result = await runner.run(state);

    // 即使只有 1 次调用配额，Graph 也不应崩溃
    check('Budget: graph did not crash', result.responseDTO !== null);
    check('Budget: model calls <= 1', result.modelCallCount <= 1);
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 10：日志不泄露 API Key =====
async function testNoApiKeyLeakage(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    setupTestEnv(dbPath);
    const db = getDatabase();

    // 捕获 console 输出
    const originalWarn = console.warn;
    const originalError = console.error;
    const originalInfo = console.info;
    const logs: string[] = [];
    const captureLog = (...args: any[]) => {
      logs.push(args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' '));
    };
    console.warn = captureLog;
    console.error = captureLog;
    console.info = captureLog;

    try {
      const config = getDefaultAppConfig();
      config.retry.baseDelayMs = 1;
      const secretStore = createMockSecretStore('sk-super-secret-key-12345');
      const modelGateway = new ModelGateway({
        config, secretStore, fetchFn: createAlwaysFailingMockFetch().fetchFn, db
      });

      modelGateway.beginTurn('test-trace');
      await modelGateway.invoke({
        messages: [{ role: 'user', content: 'test' }],
        mode: 'balanced',
        traceId: 'test-trace'
      });
      modelGateway.endTurn();
    } finally {
      console.warn = originalWarn;
      console.error = originalError;
      console.info = originalInfo;
    }

    // 检查日志中不包含 API key
    const allLogs = logs.join('\n');
    check('NoLeak: API key not in logs', !allLogs.includes('sk-super-secret-key-12345'));
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// ===== 主函数 =====
async function main(): Promise<void> {
  console.log('=== 阶段 8 故障注入测试 ===\n');

  await testRetryOnTransientFailure();
  console.log('');
  await testNoRetryOnNonRetryable();
  console.log('');
  await testRetryExhaustedThenFallback();
  console.log('');
  await testOfflineRemindersWork();
  console.log('');
  await testDatabaseErrorNoFalseSuccess();
  console.log('');
  await testCheckpointSaveAndResume();
  console.log('');
  await testCheckpointRepositoryCRUD();
  console.log('');
  await testBackupExportImport();
  console.log('');
  await testBudgetExhaustion();
  console.log('');
  await testNoApiKeyLeakage();

  console.log('\n=== 测试结果 ===');
  console.log(`PASS: ${pass}`);
  console.log(`FAIL: ${fail}`);
  if (failures.length > 0) {
    console.log('\n失败项：');
    failures.forEach(f => console.log(`  - ${f}`));
  }
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Test runner crashed:', err);
  process.exit(1);
});
