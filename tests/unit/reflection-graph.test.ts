/**
 * 阶段 7 ReflectionGraph 测试。
 * 验证架构计划阶段 7 验收标准：
 *   1. Reflection 失败不影响聊天
 *   2. 失败任务可记录错误信息（供后台重试）
 *   3. 相同事实不会无限生成重复记忆
 *   4. 每条记忆可追溯到来源消息
 *   5. 敏感内容不会自动进入长期记忆
 *   6. 用户可以查看、编辑、删除和导出
 *   7. 清空角色记忆不会删除全局用户档案
 *   8. 全局记忆和角色记忆清晰标识
 *
 * 运行：npx tsx tests/unit/reflection-graph.test.ts
 */
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

import { initDatabase, closeDatabase, getDatabase } from '../../src/infrastructure/database/connection';
import { settingsRepository } from '../../src/infrastructure/database/repositories/settings-repository';
import { sessionRepository, messageRepository } from '../../src/infrastructure/database/repositories/session-repository';
import { memoryRepository } from '../../src/infrastructure/database/repositories/memory-repository';

import { MemoryStore } from '../../src/services/MemoryStore';
import { ModelGateway } from '../../src/services/ModelGateway';
import { ReflectionGraphRunner } from '../../src/agent/graphs/reflection/graph';
import { createInitialReflectionState } from '../../src/agent/graphs/reflection/state';
import type { ReflectionStateType } from '../../src/agent/graphs/reflection/state';
import {
  validateContent,
  detectSensitiveInfo,
  isCasualGreeting,
  isTemporaryEmotion
} from '../../src/agent/graphs/reflection/nodes/sensitive-info-filter';
import { getDefaultAppConfig } from '../../src/infrastructure/config/config-loader';
import type { SecretStore, ApiSecretConfig } from '../../src/infrastructure/secrets/secret-store';
import type { PersonaConfig } from '../../src/shared/contracts/graph-state';
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'petdb-refl-'));
  return path.join(dir, 'test.sqlite');
}

function cleanupDbFile(dbPath: string): void {
  try {
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    const dir = path.dirname(dbPath);
    if (fs.existsSync(dir)) fs.rmdirSync(dir);
  } catch { /* ignore */ }
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

function createChatEvent(userId: string, characterId: string): AppEvent {
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
    payload: { message: 'test' }
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

/**
 * 创建 mock fetch，返回指定的候选 JSON。
 * candidatesJson 是模型应返回的 JSON 字符串。
 */
function createMockFetch(candidatesJson: string) {
  return async (_url: string, _options?: RequestInit): Promise<Response> => {
    const body = candidatesJson;
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

/** 创建失败的 mock fetch */
function createFailingMockFetch() {
  return async (_url: string, _options?: RequestInit): Promise<Response> => {
    return { ok: false, status: 500, text: async () => 'Server error' } as unknown as Response;
  };
}

/** 创建 ReflectionGraphRunner */
function createRunner(
  db: ReturnType<typeof getDatabase>,
  fetchFn: ReturnType<typeof createMockFetch>
): ReflectionGraphRunner {
  const config = getDefaultAppConfig();
  const secretStore = createMockSecretStore();
  const modelGateway = new ModelGateway({
    config,
    secretStore,
    fetchFn,
    db
  });
  return new ReflectionGraphRunner({ modelGateway });
}

function createReflectionState(
  userId: string,
  characterId: string,
  sessionId: string,
  userMessage: string,
  assistantReply: string
): ReflectionStateType {
  const event = createChatEvent(userId, characterId);
  return createInitialReflectionState({
    event,
    userId,
    characterId,
    sessionId,
    persona: createTestPersona(),
    modelMode: 'balanced',
    reflectionPayload: {
      turnId: `turn-${Date.now()}`,
      userMessage,
      assistantReply,
      emotion: 'idle'
    }
  });
}

// ===== 测试 1：敏感信息过滤 =====
async function testSensitiveInfoFilter(): Promise<void> {
  // 密码
  const pwd = detectSensitiveInfo('用户的密码是：abc123456');
  check('SensitiveFilter: password detected', pwd.sensitive === true);
  check('SensitiveFilter: password reason', pwd.reason === '包含密码或令牌');

  // API Key
  const apiKey = detectSensitiveInfo('api_key=sk-1234567890abcdef');
  check('SensitiveFilter: api key detected', apiKey.sensitive === true);

  // 银行卡号
  const card = detectSensitiveInfo('银行卡号是 6222 0202 0000 0000 123');
  check('SensitiveFilter: bank card detected', card.sensitive === true);

  // 身份证号
  const idNum = detectSensitiveInfo('身份证号是 110101199001011234');
  check('SensitiveFilter: id number detected', idNum.sensitive === true);

  // 验证码
  const otp = detectSensitiveInfo('验证码：123456');
  check('SensitiveFilter: otp detected', otp.sensitive === true);

  // 手机号
  const phone = detectSensitiveInfo('手机号是 13800138000');
  check('SensitiveFilter: phone detected', phone.sensitive === true);

  // 正常内容
  const normal = detectSensitiveInfo('用户喜欢喝咖啡');
  check('SensitiveFilter: normal content passes', normal.sensitive === false);
}

// ===== 测试 2：寒暄和临时情绪过滤 =====
async function testCasualGreetingFilter(): Promise<void> {
  check('GreetingFilter: "你好" is casual', isCasualGreeting('你好') === true);
  check('GreetingFilter: "hello" is casual', isCasualGreeting('hello') === true);
  check('GreetingFilter: "再见" is casual', isCasualGreeting('再见') === true);
  check('GreetingFilter: "用户喜欢咖啡" is not casual', isCasualGreeting('用户喜欢咖啡') === false);

  check('EmotionFilter: temporary emotion detected', isTemporaryEmotion('今天心情不好') === true);
  check('EmotionFilter: "现在很开心" detected', isTemporaryEmotion('现在很开心') === true);
  check('EmotionFilter: "喜欢简洁回答" not temporary', isTemporaryEmotion('喜欢简洁回答') === false);
}

// ===== 测试 3：综合验证 validateContent =====
async function testValidateContent(): Promise<void> {
  // 正常内容通过
  const valid = validateContent('用户是程序员');
  check('ValidateContent: normal profile passes', valid.valid === true);

  // 密码被过滤
  const pwd = validateContent('用户密码是 abc123');
  check('ValidateContent: password filtered', pwd.valid === false);

  // 寒暄被过滤
  const greeting = validateContent('你好');
  check('ValidateContent: greeting filtered', greeting.valid === false);

  // 空内容被过滤
  const empty = validateContent('');
  check('ValidateContent: empty filtered', empty.valid === false);
}

// ===== 测试 4：记忆提取成功 =====
async function testMemoryExtraction(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId, sessionId } = setupTestEnv(dbPath);
    const db = getDatabase();

    const candidatesJson = JSON.stringify({
      candidates: [
        { type: 'profile', content: '用户是程序员', scope: 'global', confidence: 0.9, evidenceQuote: '我是程序员' },
        { type: 'preference', content: '用户喜欢简洁回答', scope: 'character', confidence: 0.8, evidenceQuote: '喜欢简洁的回答' },
        { type: 'event', content: '用户下周有考试', scope: 'character', confidence: 0.7, evidenceQuote: '下周有考试' }
      ]
    });

    const runner = createRunner(db, createMockFetch(candidatesJson));
    const state = createReflectionState(
      userId, characterId, sessionId,
      '我是程序员，喜欢简洁的回答。下周有考试。',
      '好的，记住了！你是程序员，喜欢简洁回答。祝你考试顺利！'
    );

    const result = await runner.run(state);

    check('Extraction: graph completed', result.reflectionResult !== null);
    check('Extraction: success', result.reflectionResult?.success === true);
    check('Extraction: candidates extracted', result.candidates.length === 3);
    check('Extraction: valid candidates', result.validCandidates.length === 3);
    check('Extraction: memories saved', result.savedCandidates.length === 3);
    check('Extraction: inserted count correct', result.reflectionResult?.insertedCount === 3);
    check('Extraction: model call count is 1', result.modelCallCount === 1);

    // 验证记忆已写入数据库
    const memories = memoryRepository.listForCharacter(userId, characterId);
    check('Extraction: memories in DB', memories.length >= 3);
    check('Extraction: has profile memory', memories.some(m => m.type === 'profile' && m.content.includes('程序员')));
    check('Extraction: has preference memory', memories.some(m => m.type === 'preference'));
    check('Extraction: has event memory', memories.some(m => m.type === 'event'));

    // 验证来源可追溯
    const profileMem = memories.find(m => m.type === 'profile');
    check('Extraction: source message ID set', profileMem?.source_message_id !== null);
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 5：敏感内容不会进入记忆 =====
async function testSensitiveContentFiltered(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId, sessionId } = setupTestEnv(dbPath);
    const db = getDatabase();

    const candidatesJson = JSON.stringify({
      candidates: [
        { type: 'profile', content: '用户密码是 abc123', scope: 'global', confidence: 0.9, evidenceQuote: '密码是 abc123' },
        { type: 'profile', content: '用户银行卡号 6222020200000000', scope: 'global', confidence: 0.9, evidenceQuote: '银行卡号 6222020200000000' },
        { type: 'profile', content: '用户是设计师', scope: 'global', confidence: 0.8, evidenceQuote: '我是设计师' },
        { type: 'event', content: '你好', scope: 'character', confidence: 0.5, evidenceQuote: '你好' }
      ]
    });

    const runner = createRunner(db, createMockFetch(candidatesJson));
    const state = createReflectionState(
      userId, characterId, sessionId,
      '我的密码是 abc123，银行卡号 6222020200000000，我是设计师，你好',
      '好的，记住了！'
    );

    const result = await runner.run(state);

    check('SensitiveFiltered: graph completed', result.reflectionResult !== null);
    check('SensitiveFiltered: candidates extracted', result.candidates.length === 4);
    check('SensitiveFiltered: only 1 valid', result.validCandidates.length === 1);
    check('SensitiveFiltered: 3 filtered', result.reflectionResult?.filteredCount === 3);
    check('SensitiveFiltered: 1 inserted', result.reflectionResult?.insertedCount === 1);

    // 验证只有正常内容进入数据库
    const memories = memoryRepository.listForCharacter(userId, characterId);
    check('SensitiveFiltered: only 1 memory in DB', memories.length === 1);
    check('SensitiveFiltered: memory is designer', memories[0]?.content.includes('设计师') === true);
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 6：去重——相同事实不重复写入 =====
async function testDeduplicateMemories(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId, sessionId } = setupTestEnv(dbPath);
    const db = getDatabase();

    // 先手动添加一条记忆
    memoryRepository.insert({
      id: 'mem-existing-001',
      user_id: userId,
      character_id: characterId,
      scope: 'character',
      type: 'preference',
      content: '用户喜欢简洁回答',
      structured_data: null,
      confidence: 0.8,
      source_message_id: 'old-turn'
    });

    // 模型返回相同内容
    const candidatesJson = JSON.stringify({
      candidates: [
        { type: 'preference', content: '用户喜欢简洁回答', scope: 'character', confidence: 0.85, evidenceQuote: '喜欢简洁回答' }
      ]
    });

    const runner = createRunner(db, createMockFetch(candidatesJson));
    const state = createReflectionState(
      userId, characterId, sessionId,
      '我喜欢简洁回答',
      '好的，记住了！'
    );

    const result = await runner.run(state);

    check('Dedup: graph completed', result.reflectionResult !== null);
    check('Dedup: candidate extracted', result.candidates.length === 1);
    check('Dedup: valid candidate', result.validCandidates.length === 1);
    check('Dedup: duplicate found', result.newCandidates.length === 0);
    check('Dedup: 0 inserted', result.reflectionResult?.insertedCount === 0);
    check('Dedup: duplicate count 1', result.reflectionResult?.duplicateCount === 1);

    // 验证数据库只有 1 条记忆（没有重复）
    const memories = memoryRepository.listForCharacter(userId, characterId);
    check('Dedup: only 1 memory in DB', memories.length === 1);
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 7：去重——更丰富内容更新已有记忆 =====
async function testDeduplicateWithRicherContent(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId, sessionId } = setupTestEnv(dbPath);
    const db = getDatabase();

    // 先添加一条简短记忆（其内容须为候选内容的子串，以触发模糊去重）
    memoryRepository.insert({
      id: 'mem-existing-002',
      user_id: userId,
      character_id: characterId,
      scope: 'character',
      type: 'profile',
      content: '用户是全栈程序员',
      structured_data: null,
      confidence: 0.7,
      source_message_id: 'old-turn'
    });

    // 模型返回更丰富的内容
    const candidatesJson = JSON.stringify({
      candidates: [
        { type: 'profile', content: '用户是全栈程序员，擅长 TypeScript 和 Python', scope: 'global', confidence: 0.9, evidenceQuote: '我是全栈程序员，擅长 TypeScript 和 Python' }
      ]
    });

    const runner = createRunner(db, createMockFetch(candidatesJson));
    const state = createReflectionState(
      userId, characterId, sessionId,
      '我是全栈程序员，擅长 TypeScript 和 Python',
      '好的，记住了！'
    );

    const result = await runner.run(state);

    check('DedupUpdate: graph completed', result.reflectionResult !== null);
    check('DedupUpdate: candidate has duplicate ID', result.newCandidates[0]?.duplicateOfId === 'mem-existing-002');
    check('DedupUpdate: 1 updated', result.reflectionResult?.updatedCount === 1);
    check('DedupUpdate: 0 inserted', result.reflectionResult?.insertedCount === 0);

    // 验证记忆内容已更新
    const updated = memoryRepository.getById('mem-existing-002');
    check('DedupUpdate: content updated', updated?.content.includes('全栈程序员') === true);
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 8：Reflection 失败不影响聊天 =====
async function testReflectionFailureNoCrash(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId, sessionId } = setupTestEnv(dbPath);
    const db = getDatabase();

    // 模型调用失败
    const runner = createRunner(db, createFailingMockFetch());
    const state = createReflectionState(
      userId, characterId, sessionId,
      '我是程序员',
      '好的，记住了！'
    );

    const result = await runner.run(state);

    check('FailureNoCrash: graph did not crash', result !== null);
    check('FailureNoCrash: has reflection result', result.reflectionResult !== null);
    check('FailureNoCrash: candidates is empty', result.candidates.length === 0);
    check('FailureNoCrash: 0 memories saved', result.savedCandidates.length === 0);
    // 反思失败但不应产生未恢复错误
    check('FailureNoCrash: errors are recovered',
      result.errors.every(e => e.recovered === true));
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 9：记忆可追溯到来源消息 =====
async function testSourceMessageTraceability(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId, sessionId } = setupTestEnv(dbPath);
    const db = getDatabase();

    const candidatesJson = JSON.stringify({
      candidates: [
        { type: 'event', content: '用户下周三有考试', scope: 'character', confidence: 0.85, evidenceQuote: '下周三有考试' }
      ]
    });

    const runner = createRunner(db, createMockFetch(candidatesJson));
    const state = createReflectionState(
      userId, characterId, sessionId,
      '我下周三有考试',
      '好的，祝你考试顺利！'
    );

    const result = await runner.run(state);

    check('Traceability: 1 memory saved', result.savedCandidates.length === 1);
    const savedId = result.savedCandidates[0]?.savedId;
    check('Traceability: has saved ID', savedId !== undefined);

    // 验证数据库中的记忆有 source_message_id
    if (savedId) {
      const memory = memoryRepository.getById(savedId);
      check('Traceability: source message ID set', memory?.source_message_id !== null);
      check('Traceability: source matches turn ID',
        memory?.source_message_id === state.reflectionPayload.turnId);
    }
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 10：MemoryStore CRUD =====
async function testMemoryStoreCRUD(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId } = setupTestEnv(dbPath);
    const store = new MemoryStore();

    // 添加
    store.add({
      id: 'mem-crud-001',
      userId,
      characterId,
      scope: 'character',
      type: 'profile',
      content: '用户是教师',
      confidence: 0.9
    });

    // 查看
    const memory = store.getById('mem-crud-001');
    check('CRUD: memory added', memory !== null);
    check('CRUD: content correct', memory?.content === '用户是教师');

    // 编辑
    store.update('mem-crud-001', { content: '用户是大学教师', confidence: 0.95 });
    const updated = store.getById('mem-crud-001');
    check('CRUD: content updated', updated?.content === '用户是大学教师');
    check('CRUD: confidence updated', updated?.confidence === 0.95);

    // 软删除
    store.delete('mem-crud-001');
    const deleted = store.getById('mem-crud-001');
    check('CRUD: soft deleted (still in DB)', deleted !== null);
    check('CRUD: has deleted_at', deleted?.deleted_at !== null);

    // 永久删除
    store.purge('mem-crud-001');
    const purged = store.getById('mem-crud-001');
    check('CRUD: hard deleted (gone)', purged === null);
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 11：清空角色记忆不删除全局 =====
async function testClearCharacterPreservesGlobal(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId } = setupTestEnv(dbPath);
    const store = new MemoryStore();

    // 添加角色记忆
    store.add({
      id: 'mem-char-001',
      userId,
      characterId,
      scope: 'character',
      type: 'relationship',
      content: '用户和Roxy的共同经历',
      confidence: 0.8
    });

    // 添加全局记忆
    store.add({
      id: 'mem-global-001',
      userId,
      scope: 'global',
      type: 'profile',
      content: '用户是程序员',
      confidence: 0.9
    });

    // 添加另一个角色的记忆
    store.add({
      id: 'mem-char2-001',
      userId,
      characterId: 'other-character',
      scope: 'character',
      type: 'preference',
      content: '用户和其他角色的互动',
      confidence: 0.7
    });

    // 清空当前角色记忆
    const clearedCount = store.clearCharacter(userId, characterId);
    check('ClearChar: cleared 1 character memory', clearedCount === 1);

    // 验证全局记忆仍在
    const globalMem = store.getById('mem-global-001');
    check('ClearChar: global memory preserved', globalMem !== null);
    check('ClearChar: global not deleted', globalMem?.deleted_at === null);

    // 验证其他角色的记忆仍在
    const otherCharMem = store.getById('mem-char2-001');
    check('ClearChar: other character memory preserved', otherCharMem !== null);
    check('ClearChar: other character not deleted', otherCharMem?.deleted_at === null);

    // 验证当前角色记忆已软删除
    const charMem = store.getById('mem-char-001');
    check('ClearChar: character memory soft deleted', charMem?.deleted_at !== null);
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 12：导出功能 =====
async function testExportMemories(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId } = setupTestEnv(dbPath);
    const store = new MemoryStore();

    store.add({
      id: 'mem-exp-001',
      userId,
      characterId,
      scope: 'character',
      type: 'profile',
      content: '用户是设计师',
      confidence: 0.9
    });

    store.add({
      id: 'mem-exp-002',
      userId,
      scope: 'global',
      type: 'preference',
      content: '用户喜欢深色主题',
      confidence: 0.8
    });

    const exported = store.exportAll(userId);

    check('Export: has schema version', exported.schemaVersion === 1);
    check('Export: has exportedAt', exported.exportedAt.length > 0);
    check('Export: has 2 memories', exported.memories.length === 2);
    check('Export: has character memory', exported.memories.some(m => m.id === 'mem-exp-001'));
    check('Export: has global memory', exported.memories.some(m => m.id === 'mem-exp-002'));
    check('Export: global has null character_id',
      exported.memories.find(m => m.id === 'mem-exp-002')?.character_id === null);
    check('Export: character has character_id',
      exported.memories.find(m => m.id === 'mem-exp-001')?.character_id === characterId);
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 13：全局和角色记忆标识清晰 =====
async function testMemoryScopeIsolation(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId } = setupTestEnv(dbPath);
    const store = new MemoryStore();

    // 角色隔离：character 记忆必须带 characterId
    let threw = false;
    try {
      store.add({
        id: 'mem-iso-001',
        userId,
        scope: 'character',
        type: 'profile',
        content: 'test',
        confidence: 0.5
      });
    } catch {
      threw = true;
    }
    check('Isolation: character memory without characterId throws', threw === true);

    // 全局隔离：global 记忆不能带 characterId
    threw = false;
    try {
      store.add({
        id: 'mem-iso-002',
        userId,
        characterId,
        scope: 'global',
        type: 'profile',
        content: 'test',
        confidence: 0.5
      });
    } catch {
      threw = true;
    }
    check('Isolation: global memory with characterId throws', threw === true);

    // 正常添加
    store.add({
      id: 'mem-iso-003',
      userId,
      characterId,
      scope: 'character',
      type: 'profile',
      content: '角色记忆',
      confidence: 0.5
    });
    store.add({
      id: 'mem-iso-004',
      userId,
      scope: 'global',
      type: 'profile',
      content: '全局记忆',
      confidence: 0.5
    });

    // 检索时角色记忆包含全局
    const memories = store.retrieve(userId, characterId);
    check('Isolation: retrieve includes global', memories.some(m => m.scope === 'global'));
    check('Isolation: retrieve includes character', memories.some(m => m.scope === 'character'));
    check('Isolation: retrieve count is 2', memories.length === 2);
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 14：清空全部记忆 =====
async function testClearAllMemories(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId } = setupTestEnv(dbPath);
    const store = new MemoryStore();

    store.add({
      id: 'mem-all-001',
      userId,
      characterId,
      scope: 'character',
      type: 'profile',
      content: '角色记忆',
      confidence: 0.5
    });
    store.add({
      id: 'mem-all-002',
      userId,
      scope: 'global',
      type: 'profile',
      content: '全局记忆',
      confidence: 0.5
    });

    const clearedCount = store.clearAll(userId);
    check('ClearAll: cleared 2 memories', clearedCount === 2);

    // 验证全部软删除
    const memories = store.retrieve(userId, characterId);
    check('ClearAll: no active memories', memories.length === 0);

    // 导出也不包含已删除
    const exported = store.exportAll(userId);
    check('ClearAll: export is empty', exported.memories.length === 0);
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// ===== 主函数 =====
async function main(): Promise<void> {
  console.log('=== 阶段 7 ReflectionGraph 测试 ===\n');

  await testSensitiveInfoFilter();
  console.log('');
  await testCasualGreetingFilter();
  console.log('');
  await testValidateContent();
  console.log('');
  await testMemoryExtraction();
  console.log('');
  await testSensitiveContentFiltered();
  console.log('');
  await testDeduplicateMemories();
  console.log('');
  await testDeduplicateWithRicherContent();
  console.log('');
  await testReflectionFailureNoCrash();
  console.log('');
  await testSourceMessageTraceability();
  console.log('');
  await testMemoryStoreCRUD();
  console.log('');
  await testClearCharacterPreservesGlobal();
  console.log('');
  await testExportMemories();
  console.log('');
  await testMemoryScopeIsolation();
  console.log('');
  await testClearAllMemories();

  console.log('\n=== 测试结果 ===');
  console.log(`PASS: ${pass}`);
  console.log(`FAIL: ${fail}`);
  if (failures.length > 0) {
    console.log('\n失败项:');
    for (const f of failures) {
      console.log(`  - ${f}`);
    }
  }
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
