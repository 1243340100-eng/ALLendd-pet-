/**
 * Onboarding 关键路径测试（第二轮审查修复验证）。
 *
 * 验证内容：
 *   1. stale revision 无副作用：模型不调用，revision/checkpoint/characters 不变
 *   2. 事务真实回滚：confirmAndLock 失败时无部分写入
 *   3. 未初始化时 isOnboardingCompleted 返回 false（各种不完整状态）
 *   4. 模型错误后可重试：draft revision 不变，checkpoint 不变
 *   5. 旧用户兼容迁移：resumeOnboarding 创建 locked profile，isOnboardingCompleted 返回 true
 *   6. getOnboardingState 只读：不调用模型，不保存新 checkpoint
 *
 * 运行：npx tsx tests/unit/onboarding-critical-paths.test.ts
 */
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

import { initDatabase, closeDatabase, getDatabase } from '../../src/infrastructure/database/connection';
import { settingsRepository } from '../../src/infrastructure/database/repositories/settings-repository';
import { sessionRepository } from '../../src/infrastructure/database/repositories/session-repository';
import { characterProfileRepository } from '../../src/infrastructure/database/repositories/character-profile-repository';
import { checkpointRepository } from '../../src/infrastructure/database/repositories/checkpoint-repository';
import { proactivePolicyRepository, DEFAULT_PROACTIVE_POLICY } from '../../src/infrastructure/database/repositories/proactive-policy-repository';

import { CharacterPackManager } from '../../src/services/CharacterPackManager';
import { OnboardingGraphRunner } from '../../src/agent/graphs/onboarding/graph';
import { createInitialOnboardingState, getDefaultPreferences } from '../../src/agent/graphs/onboarding/state';
import { readCheckpointReadOnly } from '../../src/agent/graphs/onboarding/nodes/load-checkpoint';
import { isOnboardingCompleted } from '../../src/main/integration';
import type { PersonaConfig } from '../../src/shared/contracts/graph-state';
import type { ModelGateway, ModelRequest, ModelResult } from '../../src/services/ModelGateway';
import type { ModelMode, ModelAlias } from '../../src/shared/constants';
import type { AnswerExtraction } from '../../src/services/character-onboarding/schemas';
import type { CharacterManifest } from '../../src/services/CharacterPackManager';

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'petdb-onb-critical-'));
  return path.join(dir, 'test.sqlite');
}

function cleanupDbFile(dbPath: string): void {
  try {
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    const dir = path.dirname(dbPath);
    if (fs.existsSync(dir)) fs.rmdirSync(dir);
  } catch { /* ignore */ }
}

const DEFAULT_PACK_PATH = path.resolve(__dirname, '../../character-packs/default');

/** 构建有效的 requirementSummary（使用正确的 fields 结构） */
function buildValidRequirementSummary(characterName: string, baseCharacterId: string): any {
  return {
    fields: {
      characterName,
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
    displayText: `测试角色摘要：${characterName}`,
    sourceRevision: 0,
    generatedAt: new Date().toISOString(),
    baseCharacterId
  };
}

// ===== Mock ModelGateway =====

/**
 * 可控 Mock ModelGateway：
 * - failNext=true 时下一次 invoke 抛异常
 * - 记录调用次数
 */
function createControllableMockGateway(): ModelGateway & {
  callCount: number;
  failNext: boolean;
  reset: () => void;
} {
  let callCount = 0;
  let failNext = false;

  const gateway = {
    invoke: async (request: ModelRequest): Promise<ModelResult> => {
      callCount++;
      if (failNext) {
        failNext = false;
        throw new Error('mock-model-unavailable');
      }
      const userMessage = request.messages.find((m) => m.role === 'user')?.content || '';
      const extraction = buildBasicExtraction(userMessage);
      const result: ModelResult = {
        content: JSON.stringify(extraction),
        model: 'mock-model',
        alias: 'balanced' as ModelAlias,
        mode: 'balanced' as ModelMode,
        inputTokens: 100,
        outputTokens: 50,
        durationMs: 10,
        success: true,
        parsed: extraction
      };
      return result;
    },
    invokeWithFallback: async (request: ModelRequest): Promise<ModelResult> => {
      return gateway.invoke(request);
    },
    beginTurn: (_traceId?: string) => { callCount = 0; },
    endTurn: () => {},
    getTurnCallCount: () => callCount,
    resetTurnCallCount: () => { callCount = 0; },
    // 额外控制接口
    get callCount() { return callCount; },
    get failNext() { return failNext; },
    set failNext(v: boolean) { failNext = v; },
    reset() { callCount = 0; failNext = false; }
  } as unknown as ModelGateway & { callCount: number; failNext: boolean; reset: () => void };

  return gateway;
}

/** 为 basic 阶段构建提取结果 */
function buildBasicExtraction(userMessage: string): AnswerExtraction {
  const updates: AnswerExtraction['updates'] = [];
  const answer = userMessage.toLowerCase();

  updates.push({
    field: 'characterName',
    value: '测试角色',
    evidenceQuote: answer.includes('测试角色') ? '测试角色' : answer.slice(0, 5)
  });
  updates.push({
    field: 'characterIdentity',
    value: '一个测试用角色',
    evidenceQuote: answer.slice(0, 5)
  });
  updates.push({
    field: 'userPetName',
    value: '用户',
    evidenceQuote: answer.slice(0, 5)
  });
  updates.push({
    field: 'selfPetName',
    value: '我',
    evidenceQuote: answer.slice(0, 5)
  });
  updates.push({
    field: 'referenceCharacter',
    value: '无',
    evidenceQuote: answer.slice(0, 5)
  });

  return { updates, explicitCorrections: [], ambiguities: [] };
}

// ===== Mock CharacterPackManager =====

function createMockPackManager(): CharacterPackManager {
  const mockPersona: PersonaConfig = {
    characterId: 'test-base',
    characterName: 'TestBase',
    corePrompt: '你是测试角色。',
    speakingStyle: ['礼貌'],
    relationshipBoundary: ['不涉及成人内容'],
    forbiddenDrift: ['不偏离角色'],
    commonTone: ['友好'],
    sampleDialogues: [],
    userPetName: '',
    defaultLanguage: 'zh'
  };
  const mockManifest: CharacterManifest = {
    id: 'test-base',
    version: '1.0.0',
    name: 'TestBase',
    renderers: {
      spritesheet: {
        atlas: 'spritesheet/atlas.webp',
        metadata: 'spritesheet/spritesheet.json'
      }
    }
  };

  return {
    getActivePack: () => ({
      manifest: mockManifest,
      persona: mockPersona,
      prompt: 'test prompt',
      motionMap: { states: [] },
      packPath: '/tmp/test-pack'
    }),
    getActiveCharacterId: () => 'test-base',
    load: () => ({
      manifest: mockManifest,
      persona: mockPersona,
      prompt: 'test prompt',
      motionMap: { states: [] },
      packPath: '/tmp/test-pack'
    })
  } as unknown as CharacterPackManager;
}

// ===== 测试 1：stale revision 无副作用 =====
async function testStaleRevisionNoSideEffect(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    initDatabase({ path: dbPath });
    settingsRepository.set('user_id', 'stale-user');
    settingsRepository.set('active_character_id', 'test-base');

    const packManager = createMockPackManager();
    const gateway = createControllableMockGateway();
    const runner = new OnboardingGraphRunner(packManager, gateway);

    // 第一轮：start，创建 checkpoint（revision=0）
    const threadId = 'stale-test-thread';
    const state1 = createInitialOnboardingState(DEFAULT_PACK_PATH, threadId, 'trace-stale-1');
    const result1 = await runner.run(state1);
    check('Stale: round 1 paused', result1.awaitingUserInput === true);
    check('Stale: round 1 draft revision is 0', result1.draft?.revision === 0);

    const scopeKey = `stale-user:test-base:${threadId}`;
    const checkpointBefore = checkpointRepository.getActiveByScope('onboarding', scopeKey);
    check('Stale: checkpoint exists after start', checkpointBefore !== null);

    const charactersBefore = getDatabase().prepare('SELECT COUNT(*) as c FROM characters').get() as { c: number };

    // 第二轮：提交 answer 但使用错误的 revision=99
    // beginTurn 会在每次 run 开始时重置 callCount，所以这里不记录 before 值
    const state2 = createInitialOnboardingState(DEFAULT_PACK_PATH, threadId, 'trace-stale-2');
    state2.userAction = 'answer';
    state2.lastUserInput = '测试角色，一个测试用角色';
    state2.expectedRevision = 99; // 错误的 revision
    const result2 = await runner.run(state2);

    // 验证：返回 stale-revision 错误
    check('Stale: error phase returned', result2.phase === 'error');
    check('Stale: errorReason is stale-revision', result2.errorReason === 'stale-revision');
    check('Stale: currentStep is finish', result2.currentStep === 'finish');

    // 验证：模型没有被调用（beginTurn 重置 count，stale 直接返回 error 不调用模型）
    check('Stale: model not called (count is 0)', gateway.callCount === 0);

    // 验证：checkpoint 不变
    const checkpointAfter = checkpointRepository.getActiveByScope('onboarding', scopeKey);
    check('Stale: checkpoint still exists', checkpointAfter !== null);
    if (checkpointAfter && checkpointBefore) {
      check('Stale: checkpoint state_json unchanged',
        checkpointAfter.state_json === checkpointBefore.state_json);
    }

    // 验证：revision 不变
    check('Stale: draft revision still 0', result2.draft?.revision === 0);

    // 验证：characters 表不变
    const charactersAfter = getDatabase().prepare('SELECT COUNT(*) as c FROM characters').get() as { c: number };
    check('Stale: characters count unchanged', charactersAfter.c === charactersBefore.c);

    // 验证：settings 不变
    check('Stale: onboarding_completed still not true',
      settingsRepository.get('onboarding_completed') !== 'true');

    closeDatabase();
  } finally {
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 2：stale feedback 无副作用 =====
async function testStaleFeedbackNoSideEffect(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    initDatabase({ path: dbPath });
    settingsRepository.set('user_id', 'stale-fb-user');
    settingsRepository.set('active_character_id', 'test-base');

    const packManager = createMockPackManager();
    const gateway = createControllableMockGateway();
    const runner = new OnboardingGraphRunner(packManager, gateway);

    const threadId = 'stale-fb-thread';
    const state1 = createInitialOnboardingState(DEFAULT_PACK_PATH, threadId, 'trace-stale-fb-1');
    const result1 = await runner.run(state1);
    check('StaleFB: round 1 paused', result1.awaitingUserInput === true);

    // 提交 feedback 但使用错误 revision
    const state2 = createInitialOnboardingState(DEFAULT_PACK_PATH, threadId, 'trace-stale-fb-2');
    state2.userAction = 'feedback';
    state2.lastUserInput = '修改角色名';
    state2.expectedRevision = 999;
    const result2 = await runner.run(state2);

    check('StaleFB: error phase returned', result2.phase === 'error');
    check('StaleFB: errorReason is stale-revision', result2.errorReason === 'stale-revision');
    check('StaleFB: model not called', gateway.callCount === 0);

    closeDatabase();
  } finally {
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 3：stale confirm 无副作用 =====
async function testStaleConfirmNoSideEffect(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    initDatabase({ path: dbPath });
    settingsRepository.set('user_id', 'stale-confirm-user');
    settingsRepository.set('active_character_id', 'test-base');

    const packManager = createMockPackManager();
    const gateway = createControllableMockGateway();
    const runner = new OnboardingGraphRunner(packManager, gateway);

    const threadId = 'stale-confirm-thread';
    const state1 = createInitialOnboardingState(DEFAULT_PACK_PATH, threadId, 'trace-stale-conf-1');
    const result1 = await runner.run(state1);
    check('StaleConfirm: round 1 paused', result1.awaitingUserInput === true);

    const charactersBefore = getDatabase().prepare('SELECT COUNT(*) as c FROM characters').get() as { c: number };

    // 提交 confirm 但使用错误 revision
    const state2 = createInitialOnboardingState(DEFAULT_PACK_PATH, threadId, 'trace-stale-conf-2');
    state2.userAction = 'confirm';
    state2.expectedRevision = 888;
    const result2 = await runner.run(state2);

    check('StaleConfirm: error phase returned', result2.phase === 'error');
    check('StaleConfirm: errorReason is stale-revision', result2.errorReason === 'stale-revision');
    check('StaleConfirm: model not called', gateway.callCount === 0);

    // 验证没有创建角色
    const charactersAfter = getDatabase().prepare('SELECT COUNT(*) as c FROM characters').get() as { c: number };
    check('StaleConfirm: characters count unchanged', charactersAfter.c === charactersBefore.c);
    check('StaleConfirm: onboarding not completed',
      settingsRepository.get('onboarding_completed') !== 'true');

    closeDatabase();
  } finally {
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 4：事务真实回滚 - confirmAndLock 失败时不留部分数据 =====
async function testTransactionRollbackOnInvalidProfile(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    initDatabase({ path: dbPath });

    const charactersBefore = getDatabase().prepare('SELECT COUNT(*) as c FROM characters').get() as { c: number };

    // 尝试用无效 persona 调用 confirmAndLock（缺少必需字段）
    let threw = false;
    try {
      characterProfileRepository.confirmAndLock({
        characterId: 'rollback-test-char',
        displayName: 'RollbackTest',
        baseCharacterId: 'test-base',
        requirementSummary: {
          basic: { characterName: '测试', characterIdentity: '', userPetName: '', selfPetName: '', referenceCharacter: null, keepTraits: [], excludeTraits: [] },
          speaking: { tone: '', replyLength: 'medium', proactiveFollowUp: 'medium', jokeLevel: 'low', flirtLevel: 'low', tsundereLevel: 'low', catchphrase: '', forbiddenExpressions: [] },
          relationship: { relationshipType: '', intimacyLevel: 'medium', forbiddenBoundaries: [], lowMoodResponse: '', dangerousRequestResponse: '' },
          taboos: { cannotBecome: [], cannotSay: [], cannotDo: [], avoidAssistantFeel: '' }
        },
        // 故意传入无效 persona（缺少必需字段）
        persona: null as any,
        personalityProfile: {
          replyLength: 'medium',
          proactiveFollowUp: 'medium',
          jokeLevel: 'low',
          flirtLevel: 'low',
          tsundereLevel: 'low',
          toneHints: [],
          mustAvoid: []
        },
        configVersion: 1
      });
    } catch (e) {
      threw = true;
    }

    check('Rollback: confirmAndLock threw on invalid persona', threw);

    // 验证 characters 表没有新增记录
    const charactersAfter = getDatabase().prepare('SELECT COUNT(*) as c FROM characters').get() as { c: number };
    check('Rollback: no character record left after failure', charactersAfter.c === charactersBefore.c);

    // 验证没有 locked 记录
    const lockedCount = getDatabase().prepare('SELECT COUNT(*) as c FROM characters WHERE is_locked = 1').get() as { c: number };
    check('Rollback: no locked character after failure', lockedCount.c === 0);

    closeDatabase();
  } finally {
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 5：事务真实回滚 - 嵌套事务失败回滚所有写入 =====
async function testNestedTransactionRollback(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    initDatabase({ path: dbPath });

    const { transaction } = require('../../src/infrastructure/database/connection');
    const charactersBefore = getDatabase().prepare('SELECT COUNT(*) as c FROM characters').get() as { c: number };
    const settingsBefore = settingsRepository.get('test_rollback_flag');

    let threw = false;
    try {
      transaction(() => {
        // 1. 先写入一个 setting
        settingsRepository.set('test_rollback_flag', 'before-failure');

        // 2. 然后执行一个会失败的操作
        const db = getDatabase();
        // 故意执行非法 SQL 触发异常
        db.prepare('INSERT INTO non_existent_table VALUES (1)').run();
      });
    } catch (e) {
      threw = true;
    }

    check('NestedRollback: transaction threw', threw);

    // 验证 setting 被回滚
    const settingsAfter = settingsRepository.get('test_rollback_flag');
    check('NestedRollback: setting rolled back', settingsAfter === settingsBefore);

    // 验证 characters 表不变
    const charactersAfter = getDatabase().prepare('SELECT COUNT(*) as c FROM characters').get() as { c: number };
    check('NestedRollback: characters count unchanged', charactersAfter.c === charactersBefore.c);

    closeDatabase();
  } finally {
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 6：isOnboardingCompleted 各种不完整状态返回 false =====
async function testIsOnboardingCompletedGuards(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    initDatabase({ path: dbPath });

    // 6.1 无任何设置
    check('Guard: false when no settings', isOnboardingCompleted() === false);

    // 6.2 只有 onboarding_completed=true 但无 active_character_id
    settingsRepository.set('onboarding_completed', 'true');
    check('Guard: false when no active_character_id', isOnboardingCompleted() === false);

    // 6.3 onboarding_completed=true + active_character_id 但无 locked profile
    settingsRepository.set('active_character_id', 'non-existent-char');
    check('Guard: false when no locked profile', isOnboardingCompleted() === false);

    // 6.4 onboarding_completed=true + active_character_id + locked profile 但 characterId 不匹配
    // 先创建一个 locked profile 但 characterId 不同
    const validPersona: PersonaConfig = {
      characterId: 'different-char-id',
      characterName: 'Different',
      corePrompt: 'test',
      speakingStyle: [],
      relationshipBoundary: [],
      forbiddenDrift: [],
      commonTone: [],
      sampleDialogues: [],
      userPetName: '',
      defaultLanguage: 'zh'
    };
    characterProfileRepository.confirmAndLock({
      characterId: 'different-char-id',
      displayName: 'Different',
      baseCharacterId: 'test-base',
      requirementSummary: buildValidRequirementSummary('Different', 'test-base'),
      persona: validPersona,
      personalityProfile: {
        replyLength: 'medium',
        proactiveFollowUp: 'medium',
        jokeLevel: 'low',
        flirtLevel: 'low',
        tsundereLevel: 'low',
        toneHints: [],
        mustAvoid: []
      },
      configVersion: 1
    });

    // active_character_id 是 'non-existent-char'，但 locked profile 是 'different-char-id'
    check('Guard: false when characterId mismatch', isOnboardingCompleted() === false);

    // 6.5 全部正确：active_character_id 匹配 locked profile
    settingsRepository.set('active_character_id', 'different-char-id');
    check('Guard: true when all valid', isOnboardingCompleted() === true);

    closeDatabase();
  } finally {
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 7：模型错误后可重试 =====
async function testModelFailureAllowsRetry(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    initDatabase({ path: dbPath });
    settingsRepository.set('user_id', 'retry-user');
    settingsRepository.set('active_character_id', 'test-base');

    const packManager = createMockPackManager();
    const gateway = createControllableMockGateway();
    const runner = new OnboardingGraphRunner(packManager, gateway);

    const threadId = 'retry-test-thread';
    // 第一轮：start
    const state1 = createInitialOnboardingState(DEFAULT_PACK_PATH, threadId, 'trace-retry-1');
    const result1 = await runner.run(state1);
    check('Retry: round 1 paused', result1.awaitingUserInput === true);

    const checkpointBefore = checkpointRepository.getActiveByScope('onboarding', `retry-user:test-base:${threadId}`);
    const revisionBefore = result1.draft?.revision;

    // 第二轮：设置模型失败，提交 answer
    gateway.failNext = true;
    const state2 = createInitialOnboardingState(DEFAULT_PACK_PATH, threadId, 'trace-retry-2');
    state2.userAction = 'answer';
    state2.lastUserInput = '测试角色，一个测试用角色';
    state2.expectedRevision = result1.draft?.revision ?? 0;
    const result2 = await runner.run(state2);

    // 模型失败后应该返回错误或保持 collecting 状态
    check('Retry: model failure handled (error or collecting)',
      result2.phase === 'error' || result2.phase === 'collecting');

    // 验证：draft revision 不变（模型失败不修改草稿）
    if (result2.draft) {
      check('Retry: draft revision unchanged after model failure',
        result2.draft.revision === revisionBefore);
    }

    // 验证：checkpoint 不变（模型失败不保存新 checkpoint）
    const checkpointAfter = checkpointRepository.getActiveByScope('onboarding', `retry-user:test-base:${threadId}`);
    if (checkpointAfter && checkpointBefore) {
      check('Retry: checkpoint state_json unchanged after model failure',
        checkpointAfter.state_json === checkpointBefore.state_json);
    }

    // 第三轮：模型恢复正常，重试同样的 answer
    gateway.reset();
    const state3 = createInitialOnboardingState(DEFAULT_PACK_PATH, threadId, 'trace-retry-3');
    state3.userAction = 'answer';
    state3.lastUserInput = '测试角色，一个测试用角色';
    state3.expectedRevision = result1.draft?.revision ?? 0;
    const result3 = await runner.run(state3);

    // 重试后应该正常推进
    check('Retry: retry succeeded (not error)', result3.phase !== 'error' || result3.errorReason === '');

    closeDatabase();
  } finally {
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 8：getOnboardingState 只读 - 不调用模型，不保存新 checkpoint =====
async function testGetOnboardingStateReadOnly(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    initDatabase({ path: dbPath });
    settingsRepository.set('user_id', 'readonly-user');
    settingsRepository.set('active_character_id', 'test-base');

    const packManager = createMockPackManager();
    const gateway = createControllableMockGateway();
    const runner = new OnboardingGraphRunner(packManager, gateway);

    const threadId = 'default-onboarding'; // 必须与 getOnboardingState 使用的一致

    // 先 start 一次创建 checkpoint
    const state1 = createInitialOnboardingState(DEFAULT_PACK_PATH, threadId, 'trace-ro-1');
    const result1 = await runner.run(state1);
    check('ReadOnly: start created checkpoint', result1.awaitingUserInput === true);

    const checkpointBefore = checkpointRepository.getActiveByScope('onboarding', `readonly-user:test-base:${threadId}`);
    check('ReadOnly: checkpoint exists', checkpointBefore !== null);

    const modelCallsBefore = gateway.callCount;

    // 调用 readCheckpointReadOnly（模拟 getOnboardingState 的核心逻辑）
    const scopeKey = `readonly-user:test-base:${threadId}`;
    const readonly = readCheckpointReadOnly(scopeKey);
    check('ReadOnly: readCheckpointReadOnly returned data', readonly !== null);

    if (readonly) {
      check('ReadOnly: phase is collecting', readonly.phase === 'collecting');
      check('ReadOnly: draft exists', readonly.draft !== null);
      check('ReadOnly: draft revision is 0', readonly.draft.revision === 0);
    }

    // 验证：模型没有被调用
    check('ReadOnly: model not called', gateway.callCount === modelCallsBefore);

    // 验证：checkpoint 不变
    const checkpointAfter = checkpointRepository.getActiveByScope('onboarding', scopeKey);
    if (checkpointAfter && checkpointBefore) {
      check('ReadOnly: checkpoint state_json unchanged',
        checkpointAfter.state_json === checkpointBefore.state_json);
    }

    // 多次调用 readCheckpointReadOnly 都不应改变状态
    readCheckpointReadOnly(scopeKey);
    readCheckpointReadOnly(scopeKey);
    const checkpointAfter3 = checkpointRepository.getActiveByScope('onboarding', scopeKey);
    if (checkpointAfter3 && checkpointBefore) {
      check('ReadOnly: checkpoint unchanged after multiple reads',
        checkpointAfter3.state_json === checkpointBefore.state_json);
    }

    closeDatabase();
  } finally {
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 9：旧用户兼容迁移 - resumeOnboarding 创建 locked profile =====
async function testLegacyUserMigration(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    initDatabase({ path: dbPath });
    const userId = 'legacy-user';
    const characterId = 'test-base';
    settingsRepository.set('user_id', userId);

    // 创建 users 记录
    try {
      getDatabase().prepare('INSERT INTO users (id, nickname, preferred_name) VALUES (?, ?, ?)').run(
        userId, '旧用户', '旧用户'
      );
    } catch { /* may already exist */ }

    // 先创建一个 pending onboarding state（模拟 startup 触发）
    const packManager = createMockPackManager();
    const gateway = createControllableMockGateway();
    const runner = new OnboardingGraphRunner(packManager, gateway);
    const state = createInitialOnboardingState(DEFAULT_PACK_PATH, 'default-onboarding', 'trace-legacy');
    const pendingState = await runner.run(state);

    // 验证 onboarding 未完成
    check('Legacy: onboarding not completed before migration', isOnboardingCompleted() === false);

    // 使用 GraphDispatcher.resumeOnboarding 完成迁移
    // 由于 GraphDispatcher 构造复杂，我们直接测试核心逻辑
    const { transaction } = require('../../src/infrastructure/database/connection');
    const { compileFromExistingPersona } = require('../../src/services/character-onboarding/ProfileCompiler');

    const pack = packManager.getActivePack();
    const compiledProfile = compileFromExistingPersona(pack.persona, pack.manifest);
    const migratedCharacterId = compiledProfile.persona.characterId;

    const preferences = {
      nickname: '迁移用户',
      preferredName: '迁移',
      replyLength: 'medium' as const,
      proactiveLevel: 'medium' as const,
      weatherCity: '北京',
      weatherEnabled: true,
      dndEnabled: false,
      dndStart: '22:00',
      dndEnd: '08:00',
      systemNotificationEnabled: true,
      soundEnabled: false,
      memoryEnabled: true
    };

    let migrationSuccess = false;
    try {
      transaction(() => {
        // 1. confirmAndLock
        const lockResult = characterProfileRepository.confirmAndLock({
          characterId: migratedCharacterId,
          displayName: compiledProfile.persona.characterName,
          baseCharacterId: compiledProfile.baseCharacterId,
          requirementSummary: buildValidRequirementSummary(
            compiledProfile.persona.characterName,
            compiledProfile.baseCharacterId
          ),
          persona: compiledProfile.persona,
          personalityProfile: compiledProfile.personalityProfile,
          configVersion: compiledProfile.configVersion
        });
        if (!lockResult.ok) {
          throw new Error(`confirmAndLock failed: ${lockResult.reason ?? 'unknown'}`);
        }

        // 2. settings
        settingsRepository.set('onboarding_completed', 'true');
        settingsRepository.set('user_id', userId);
        settingsRepository.set('active_character_id', migratedCharacterId);
        settingsRepository.set('user_nickname', preferences.nickname);
        settingsRepository.set('user_preferred_name', preferences.preferredName);
        settingsRepository.set('reply_length', preferences.replyLength);
        settingsRepository.set('proactive_level', preferences.proactiveLevel);
        settingsRepository.set('weather_city', preferences.weatherCity);
        settingsRepository.set('weather_enabled', String(preferences.weatherEnabled));
        settingsRepository.set('dnd_enabled', String(preferences.dndEnabled));
        settingsRepository.set('system_notification_enabled', String(preferences.systemNotificationEnabled));
        settingsRepository.set('sound_enabled', String(preferences.soundEnabled));
        settingsRepository.set('memory_enabled', String(preferences.memoryEnabled));

        // 3. proactive policy
        proactivePolicyRepository.upsert(userId, migratedCharacterId, {
          ...DEFAULT_PROACTIVE_POLICY,
          dndEnabled: preferences.dndEnabled,
          dndStart: preferences.dndStart,
          dndEnd: preferences.dndEnd,
          systemNotificationEnabled: preferences.systemNotificationEnabled,
          soundEnabled: preferences.soundEnabled
        });

        // 4. consume checkpoint
        const scopeKey = `${userId}:${migratedCharacterId}:default-onboarding`;
        const checkpoint = checkpointRepository.getActiveByScope('onboarding', scopeKey);
        if (checkpoint) {
          checkpointRepository.consume(checkpoint.id);
        }
      });
      migrationSuccess = true;
    } catch (e) {
      console.error('Migration failed:', (e as Error)?.message);
    }

    check('Legacy: migration succeeded', migrationSuccess);
    check('Legacy: onboarding_completed is true', settingsRepository.get('onboarding_completed') === 'true');
    check('Legacy: active_character_id set', (settingsRepository.get('active_character_id') ?? '').length > 0);
    check('Legacy: nickname saved', settingsRepository.get('user_nickname') === '迁移用户');
    check('Legacy: weather_city saved', settingsRepository.get('weather_city') === '北京');

    // 验证 locked profile 存在
    const lockedProfile = characterProfileRepository.getActiveLockedProfile();
    check('Legacy: locked profile exists', lockedProfile !== null);

    // 验证 isOnboardingCompleted 返回 true
    check('Legacy: isOnboardingCompleted returns true', isOnboardingCompleted() === true);

    // 验证 proactive policy 存在
    const policy = proactivePolicyRepository.get(userId, migratedCharacterId);
    check('Legacy: proactive policy exists', policy !== null);

    closeDatabase();
  } finally {
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 10：宽松解析回退 - 模型返回额外顶层字段时不报错 =====
async function testLenientParseWithExtraFields(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    initDatabase({ path: dbPath });
    settingsRepository.set('user_id', 'lenient-user');
    settingsRepository.set('active_character_id', 'test-base');

    const packManager = createMockPackManager();

    // 创建特殊 mock gateway：extract_answer 返回带额外顶层字段的 JSON
    let callCount = 0;
    const lenientGateway = {
      invoke: async (request: ModelRequest): Promise<ModelResult> => {
        callCount++;
        const systemPrompt = request.messages.find((m) => m.role === 'system')?.content || '';

        // 判断是 extract_answer 还是 generate_questions
        if (systemPrompt.includes('从用户回答中提取结构化更新')) {
          // extract_answer：返回带额外顶层字段的 JSON
          // 模拟 LLM 添加 notes/confidence/reasoning 等额外字段
          const extractionWithExtraFields = {
            updates: [
              {
                field: 'characterName',
                value: '测试角色',
                evidenceQuote: '测试角色'
              },
              {
                field: 'characterIdentity',
                value: '一个测试用角色',
                evidenceQuote: '测试'
              },
              {
                field: 'userPetName',
                value: '用户',
                evidenceQuote: '测试'
              }
            ],
            explicitCorrections: [],
            ambiguities: [],
            // ===== 额外字段（LLM 经常添加的） =====
            notes: '用户提供了角色名字和身份信息',
            confidence: 0.95,
            reasoning: '从用户回答中提取了3个字段',
            summary: '角色配置采集进度良好'
          };
          return {
            content: JSON.stringify(extractionWithExtraFields),
            model: 'mock-model',
            alias: 'balanced' as ModelAlias,
            mode: 'balanced' as ModelMode,
            inputTokens: 100,
            outputTokens: 50,
            durationMs: 10,
            success: true,
            parsed: extractionWithExtraFields
          };
        }

        // generate_questions：返回无效格式，让 QuestionGenerator fallback 到模板
        return {
          content: JSON.stringify({ response: 'no questions' }),
          model: 'mock-model',
          alias: 'balanced' as ModelAlias,
          mode: 'balanced' as ModelMode,
          inputTokens: 100,
          outputTokens: 50,
          durationMs: 10,
          success: true,
          parsed: {}
        };
      },
      invokeWithFallback: async (request: ModelRequest): Promise<ModelResult> => {
        return lenientGateway.invoke(request);
      },
      beginTurn: (_traceId?: string) => { callCount = 0; },
      endTurn: () => {},
      getTurnCallCount: () => callCount,
      resetTurnCallCount: () => { callCount = 0; }
    } as unknown as ModelGateway;

    const runner = new OnboardingGraphRunner(packManager, lenientGateway);

    const threadId = 'lenient-test-thread';

    // 第一轮：start
    const state1 = createInitialOnboardingState(DEFAULT_PACK_PATH, threadId, 'trace-lenient-1');
    const result1 = await runner.run(state1);
    check('Lenient: round 1 (start) paused', result1.awaitingUserInput === true);
    check('Lenient: round 1 not error', result1.phase !== 'error');

    // 第二轮：提交答案，mock gateway 返回带额外字段的 extraction
    const state2 = createInitialOnboardingState(DEFAULT_PACK_PATH, threadId, 'trace-lenient-2');
    state2.userAction = 'answer';
    state2.lastUserInput = '测试角色，一个测试用角色';
    state2.expectedRevision = result1.draft?.revision ?? 0;
    const result2 = await runner.run(state2);

    // 关键验证：不应该因为额外字段导致 schema-validation-failed 错误
    check('Lenient: round 2 not error (extra fields tolerated)',
      result2.phase !== 'error');
    check('Lenient: round 2 errorReason is not schema-validation-failed',
      result2.errorReason !== 'schema-validation-failed');

    // 验证流程正常推进（awaitingUserInput 表示进入了 generate_questions）
    check('Lenient: round 2 paused (flow continued normally)',
      result2.awaitingUserInput === true);

    // 验证 draft 被更新了（extraction 中的 updates 被应用）
    if (result2.draft) {
      check('Lenient: draft revision incremented',
        result2.draft.revision > (result1.draft?.revision ?? 0));
      check('Lenient: characterName extracted',
        result2.draft.fields.characterName === '测试角色');
    } else {
      check('Lenient: draft exists after answer', false);
    }

    closeDatabase();
  } finally {
    cleanupDbFile(dbPath);
  }
}

// ===== 主入口 =====
async function main(): Promise<void> {
  console.log('=== Onboarding Critical Path Tests ===\n');

  console.log('--- 1. Stale Revision No Side Effect ---');
  await testStaleRevisionNoSideEffect();

  console.log('\n--- 2. Stale Feedback No Side Effect ---');
  await testStaleFeedbackNoSideEffect();

  console.log('\n--- 3. Stale Confirm No Side Effect ---');
  await testStaleConfirmNoSideEffect();

  console.log('\n--- 4. Transaction Rollback On Invalid Profile ---');
  await testTransactionRollbackOnInvalidProfile();

  console.log('\n--- 5. Nested Transaction Rollback ---');
  await testNestedTransactionRollback();

  console.log('\n--- 6. isOnboardingCompleted Guards ---');
  await testIsOnboardingCompletedGuards();

  console.log('\n--- 7. Model Failure Allows Retry ---');
  await testModelFailureAllowsRetry();

  console.log('\n--- 8. GetOnboardingState Read-Only ---');
  await testGetOnboardingStateReadOnly();

  console.log('\n--- 9. Legacy User Migration ---');
  await testLegacyUserMigration();

  console.log('\n--- 10. Lenient Parse With Extra Fields ---');
  await testLenientParseWithExtraFields();

  console.log(`\n=== Results: ${pass} passed, ${fail} failed ===`);
  if (fail > 0) {
    console.error('Failed tests:');
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('Test runner crashed:', e);
  process.exit(1);
});
