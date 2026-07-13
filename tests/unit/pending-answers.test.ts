/**
 * pendingAnswers 单元测试（M2）。
 *
 * 覆盖场景：
 *   1. 重启恢复：revision + fingerprint 匹配时从 checkpoint 恢复 pendingAnswers
 *   2. 过期拒绝：revision 不匹配时丢弃 pendingAnswers
 *   3. 过期拒绝：fingerprint 不匹配时丢弃 pendingAnswers
 *   4. 提交后清理：serializeCheckpointState 不包含 pendingAnswers（Graph save 自然清除）
 *   5. savePendingAnswersToCheckpoint：保存成功
 *   6. savePendingAnswersToCheckpoint：revision 不匹配时拒绝保存
 *   7. clearPendingAnswersFromCheckpoint：清除成功
 *   8. clearPendingAnswersFromCheckpoint：无 checkpoint 时返回 ok
 *   9. computeQuestionSetFingerprint：相同问题集相同指纹，不同问题集不同指纹
 *
 * 运行：npx tsx tests/unit/pending-answers.test.ts
 */
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

import { initDatabase, closeDatabase, getDatabase } from '../../src/infrastructure/database/connection';
import { checkpointRepository } from '../../src/infrastructure/database/repositories/checkpoint-repository';
import {
  readCheckpointReadOnly,
  savePendingAnswersToCheckpoint,
  clearPendingAnswersFromCheckpoint,
  computeQuestionSetFingerprint,
  serializeCheckpointState
} from '../../src/agent/graphs/onboarding/nodes/load-checkpoint';
import {
  createInitialDraft,
  type OnboardingQuestion,
  type PendingAnswerEntry,
  type CharacterRequirementDraft
} from '../../src/services/character-onboarding/schemas';
import type { OnboardingStateType } from '../../src/agent/graphs/onboarding/state';

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'petdb-pending-'));
  return path.join(dir, 'test.sqlite');
}

function cleanupDbFile(dbPath: string): void {
  try {
    closeDatabase();
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    const dir = path.dirname(dbPath);
    if (fs.existsSync(dir)) fs.rmdirSync(dir);
  } catch { /* ignore */ }
}

function buildQuestions(): OnboardingQuestion[] {
  return [
    {
      id: 'q-tone',
      fieldPaths: ['tone'],
      type: 'single_choice',
      question: '请选择语气风格',
      options: [
        { id: 'A', label: '温柔', value: 'gentle' },
        { id: 'B', label: '活泼', value: 'lively' }
      ],
      allowOther: false,
      required: true
    },
    {
      id: 'q-catchphrase',
      fieldPaths: ['catchphrase'],
      type: 'text',
      question: '请输入口头禅',
      allowOther: false,
      required: false
    }
  ];
}

function buildPendingAnswers(revision: number, fingerprint: string): { revision: number; questionSetFingerprint: string; answers: PendingAnswerEntry[] } {
  return {
    revision,
    questionSetFingerprint: fingerprint,
    answers: [
      { questionId: 'q-tone', selectedOptionIds: ['A'] },
      { questionId: 'q-catchphrase', customText: '喵~' }
    ]
  };
}

/** 构造 checkpoint state_json（含 pendingAnswers） */
function buildStateJson(draft: CharacterRequirementDraft, questions: OnboardingQuestion[], pendingAnswers: unknown): string {
  return JSON.stringify({
    draft,
    currentStage: draft.stage,
    previousQuestions: [],
    summary: null,
    phase: 'collecting',
    currentQuestions: questions,
    completionProgress: 0.3,
    pendingAnswers
  });
}

/** 构造最小 OnboardingStateType 供 serializeCheckpointState 使用 */
function buildMinimalState(draft: CharacterRequirementDraft, questions: OnboardingQuestion[]): OnboardingStateType {
  return {
    userId: 'test-user',
    characterId: 'test-char',
    baseManifest: { id: 'test-base', version: '1.0.0', name: 'Test', renderers: {} },
    onboardingThreadId: 'test-thread',
    traceId: 'test-trace',
    expectedRevision: -1,
    userAction: 'start',
    userMessage: '',
    currentStep: 'determine_stage',
    draft,
    currentStage: draft.stage,
    previousQuestions: [],
    currentQuestions: questions,
    summary: null,
    phase: 'collecting',
    completionProgress: 0.3,
    errors: [],
    errorReason: '',
    isCompleted: false,
    awaitingUserInput: false,
    checkpointReason: '',
    pendingAnswers: null,
    targetStage: null,
    userPreferences: null as never,
    baseCharacterId: 'test-base',
    configVersion: 1,
    compiledProfile: null,
    onboardingCompleted: false
  } as unknown as OnboardingStateType;
}

function saveCheckpoint(scopeKey: string, stateJson: string, reason = 'test'): void {
  checkpointRepository.save({
    id: `onboarding-${scopeKey}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    graph_type: 'onboarding',
    state_json: stateJson,
    reason,
    scope_key: scopeKey
  });
}

// ===== 测试 1：重启恢复（revision + fingerprint 匹配） =====
function testRestartRestore(): void {
  console.log('\n--- 测试 1：重启恢复（revision + fingerprint 匹配） ---');
  const dbPath = tempDbPath();
  try {
    initDatabase({ path: dbPath });
    const scopeKey = 'test-user:test-char:test-thread';
    const questions = buildQuestions();
    const draft = createInitialDraft();
    draft.revision = 5;
    const fingerprint = computeQuestionSetFingerprint(questions);
    const pendingAnswers = buildPendingAnswers(5, fingerprint);

    saveCheckpoint(scopeKey, buildStateJson(draft, questions, pendingAnswers));

    const readonly = readCheckpointReadOnly(scopeKey);
    check('1.1 readCheckpointReadOnly 返回非 null', readonly !== null);
    check('1.2 pendingAnswers 非 null', readonly?.pendingAnswers !== null);
    check('1.3 pendingAnswers.revision = 5', readonly?.pendingAnswers?.revision === 5);
    check('1.4 pendingAnswers.answers 长度 = 2', readonly?.pendingAnswers?.answers.length === 2);
    check('1.5 第一条 answers questionId = q-tone',
      readonly?.pendingAnswers?.answers[0]?.questionId === 'q-tone');
    check('1.6 第一条 answers selectedOptionIds = [A]',
      JSON.stringify(readonly?.pendingAnswers?.answers[0]?.selectedOptionIds) === JSON.stringify(['A']));
    check('1.7 第二条 answers customText = "喵~"',
      readonly?.pendingAnswers?.answers[1]?.customText === '喵~');
  } finally {
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 2：过期拒绝（revision 不匹配） =====
function testExpiredRevisionMismatch(): void {
  console.log('\n--- 测试 2：过期拒绝（revision 不匹配） ---');
  const dbPath = tempDbPath();
  try {
    initDatabase({ path: dbPath });
    const scopeKey = 'test-user:test-char:test-thread-rev';
    const questions = buildQuestions();
    const draft = createInitialDraft();
    draft.revision = 5;
    const fingerprint = computeQuestionSetFingerprint(questions);
    // pendingAnswers.revision = 3，但 draft.revision = 5 → 不匹配
    const pendingAnswers = buildPendingAnswers(3, fingerprint);

    saveCheckpoint(scopeKey, buildStateJson(draft, questions, pendingAnswers));

    const readonly = readCheckpointReadOnly(scopeKey);
    check('2.1 readCheckpointReadOnly 返回非 null', readonly !== null);
    check('2.2 pendingAnswers 被丢弃（null）', readonly?.pendingAnswers === null);
    // 关键：draft 不被修改
    check('2.3 draft 仍存在', readonly?.draft !== null);
    check('2.4 draft.revision 仍是 5', readonly?.draft.revision === 5);
  } finally {
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 3：过期拒绝（fingerprint 不匹配） =====
function testExpiredFingerprintMismatch(): void {
  console.log('\n--- 测试 3：过期拒绝（fingerprint 不匹配） ---');
  const dbPath = tempDbPath();
  try {
    initDatabase({ path: dbPath });
    const scopeKey = 'test-user:test-char:test-thread-fp';
    const questions = buildQuestions();
    const draft = createInitialDraft();
    draft.revision = 5;
    // pendingAnswers 的指纹是旧的（不匹配当前 questions）
    const pendingAnswers = buildPendingAnswers(5, 'old-fingerprint-that-does-not-match');

    saveCheckpoint(scopeKey, buildStateJson(draft, questions, pendingAnswers));

    const readonly = readCheckpointReadOnly(scopeKey);
    check('3.1 readCheckpointReadOnly 返回非 null', readonly !== null);
    check('3.2 pendingAnswers 被丢弃（null）', readonly?.pendingAnswers === null);
    check('3.3 draft 不受影响', readonly?.draft !== null);
    check('3.4 draft.revision 仍是 5', readonly?.draft.revision === 5);
  } finally {
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 4：提交后清理（serializeCheckpointState 不包含 pendingAnswers） =====
function testSerializeExcludesPendingAnswers(): void {
  console.log('\n--- 测试 4：提交后清理（serializeCheckpointState 不包含 pendingAnswers） ---');
  const questions = buildQuestions();
  const draft = createInitialDraft();
  draft.revision = 5;
  const state = buildMinimalState(draft, questions);
  // 即使 state.pendingAnswers 有值，serializeCheckpointState 也不应包含它
  state.pendingAnswers = buildPendingAnswers(5, computeQuestionSetFingerprint(questions));

  const serialized = serializeCheckpointState(state);
  const parsed = JSON.parse(serialized);
  check('4.1 序列化结果不包含 pendingAnswers 字段', parsed.pendingAnswers === undefined);
  check('4.2 序列化结果包含 draft', parsed.draft !== undefined);
  check('4.3 序列化结果包含 currentQuestions', Array.isArray(parsed.currentQuestions));
  check('4.4 序列化结果包含 phase', parsed.phase !== undefined);
}

// ===== 测试 5：savePendingAnswersToCheckpoint 保存成功 =====
function testSavePendingAnswersSuccess(): void {
  console.log('\n--- 测试 5：savePendingAnswersToCheckpoint 保存成功 ---');
  const dbPath = tempDbPath();
  try {
    initDatabase({ path: dbPath });
    const scopeKey = 'test-user:test-char:test-thread-save';
    const questions = buildQuestions();
    const draft = createInitialDraft();
    draft.revision = 7;

    // 先保存一个不含 pendingAnswers 的 checkpoint
    saveCheckpoint(scopeKey, buildStateJson(draft, questions, null));

    // 保存 pendingAnswers
    const answers: PendingAnswerEntry[] = [
      { questionId: 'q-tone', selectedOptionIds: ['B'] }
    ];
    const result = savePendingAnswersToCheckpoint(scopeKey, answers, 7);
    check('5.1 保存返回 ok=true', result.ok === true);

    // 验证 checkpoint 已更新
    const readonly = readCheckpointReadOnly(scopeKey);
    check('5.2 readCheckpointReadOnly 返回非 null', readonly !== null);
    check('5.3 pendingAnswers 非 null', readonly?.pendingAnswers !== null);
    check('5.4 pendingAnswers.revision = 7', readonly?.pendingAnswers?.revision === 7);
    check('5.5 pendingAnswers.answers 长度 = 1', readonly?.pendingAnswers?.answers.length === 1);
    check('5.6 answers[0].questionId = q-tone', readonly?.pendingAnswers?.answers[0]?.questionId === 'q-tone');
    check('5.7 answers[0].selectedOptionIds = [B]',
      JSON.stringify(readonly?.pendingAnswers?.answers[0]?.selectedOptionIds) === JSON.stringify(['B']));
  } finally {
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 6：savePendingAnswersToCheckpoint revision 不匹配时拒绝 =====
function testSavePendingAnswersRevisionMismatch(): void {
  console.log('\n--- 测试 6：savePendingAnswersToCheckpoint revision 不匹配时拒绝 ---');
  const dbPath = tempDbPath();
  try {
    initDatabase({ path: dbPath });
    const scopeKey = 'test-user:test-char:test-thread-save-rev';
    const questions = buildQuestions();
    const draft = createInitialDraft();
    draft.revision = 7;

    saveCheckpoint(scopeKey, buildStateJson(draft, questions, null));

    // 尝试用错误的 revision 保存
    const answers: PendingAnswerEntry[] = [
      { questionId: 'q-tone', selectedOptionIds: ['A'] }
    ];
    const result = savePendingAnswersToCheckpoint(scopeKey, answers, 99);
    check('6.1 保存返回 ok=false', result.ok === false);
    check('6.2 reason 包含 "revision-mismatch"', result.reason === 'revision-mismatch');

    // 验证 checkpoint 未被修改
    const readonly = readCheckpointReadOnly(scopeKey);
    check('6.3 pendingAnswers 仍是 null（未保存）', readonly?.pendingAnswers === null);
  } finally {
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 7：clearPendingAnswersFromCheckpoint 清除成功 =====
function testClearPendingAnswersSuccess(): void {
  console.log('\n--- 测试 7：clearPendingAnswersFromCheckpoint 清除成功 ---');
  const dbPath = tempDbPath();
  try {
    initDatabase({ path: dbPath });
    const scopeKey = 'test-user:test-char:test-thread-clear';
    const questions = buildQuestions();
    const draft = createInitialDraft();
    draft.revision = 3;
    const fingerprint = computeQuestionSetFingerprint(questions);
    const pendingAnswers = buildPendingAnswers(3, fingerprint);

    saveCheckpoint(scopeKey, buildStateJson(draft, questions, pendingAnswers));

    // 确认有 pendingAnswers
    const before = readCheckpointReadOnly(scopeKey);
    check('7.1 清除前 pendingAnswers 非 null', before?.pendingAnswers !== null);

    // 清除
    const result = clearPendingAnswersFromCheckpoint(scopeKey, 3);
    check('7.2 清除返回 ok=true', result.ok === true);

    // 验证已清除
    const after = readCheckpointReadOnly(scopeKey);
    check('7.3 清除后 pendingAnswers 是 null', after?.pendingAnswers === null);
    // draft 不受影响
    check('7.4 draft 仍存在', after?.draft !== null);
    check('7.5 draft.revision 仍是 3', after?.draft.revision === 3);
  } finally {
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 8：clearPendingAnswersFromCheckpoint 无 checkpoint 时返回 ok =====
function testClearNoCheckpoint(): void {
  console.log('\n--- 测试 8：clearPendingAnswersFromCheckpoint 无 checkpoint 时返回 ok ---');
  const dbPath = tempDbPath();
  try {
    initDatabase({ path: dbPath });
    const scopeKey = 'test-user:test-char:test-thread-no-checkpoint';
    const result = clearPendingAnswersFromCheckpoint(scopeKey, 0);
    check('8.1 无 checkpoint 时返回 ok=true', result.ok === true);
  } finally {
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 9：computeQuestionSetFingerprint 一致性 =====
function testFingerprintConsistency(): void {
  console.log('\n--- 测试 9：computeQuestionSetFingerprint 一致性 ---');
  const questions1 = buildQuestions();
  const questions2 = buildQuestions();
  const fp1 = computeQuestionSetFingerprint(questions1);
  const fp2 = computeQuestionSetFingerprint(questions2);
  check('9.1 相同问题集 → 相同指纹', fp1 === fp2);

  // 改变选项
  const questionsModified: OnboardingQuestion[] = [
    {
      ...questions1[0],
      options: [
        { id: 'A', label: '温柔', value: 'gentle' },
        { id: 'B', label: '活泼', value: 'lively' },
        { id: 'C', label: '冷静', value: 'calm' }  // 新增选项
      ]
    },
    questions1[1]
  ];
  const fpModified = computeQuestionSetFingerprint(questionsModified);
  check('9.2 选项变化 → 指纹不同', fp1 !== fpModified);

  // 改变问题 ID
  const questionsIdChanged: OnboardingQuestion[] = [
    { ...questions1[0], id: 'q-tone-new' },
    questions1[1]
  ];
  const fpIdChanged = computeQuestionSetFingerprint(questionsIdChanged);
  check('9.3 问题 ID 变化 → 指纹不同', fp1 !== fpIdChanged);

  // 空问题集
  const fpEmpty = computeQuestionSetFingerprint([]);
  check('9.4 空问题集 → 空字符串', fpEmpty === '');
}

// ===== 测试 10：pendingAnswers answers 为空时 readCheckpointReadOnly 返回 null =====
function testEmptyAnswersReturnsNull(): void {
  console.log('\n--- 测试 10：pendingAnswers answers 为空时返回 null ---');
  const dbPath = tempDbPath();
  try {
    initDatabase({ path: dbPath });
    const scopeKey = 'test-user:test-char:test-thread-empty';
    const questions = buildQuestions();
    const draft = createInitialDraft();
    draft.revision = 2;
    const fingerprint = computeQuestionSetFingerprint(questions);
    const pendingAnswers = { revision: 2, questionSetFingerprint: fingerprint, answers: [] };

    saveCheckpoint(scopeKey, buildStateJson(draft, questions, pendingAnswers));

    const readonly = readCheckpointReadOnly(scopeKey);
    check('10.1 readCheckpointReadOnly 返回非 null', readonly !== null);
    check('10.2 answers 为空时 pendingAnswers 返回 null', readonly?.pendingAnswers === null);
  } finally {
    cleanupDbFile(dbPath);
  }
}

// ===== 运行所有测试 =====
function main(): void {
  console.log('=== pendingAnswers 单元测试（M2） ===');
  testRestartRestore();
  testExpiredRevisionMismatch();
  testExpiredFingerprintMismatch();
  testSerializeExcludesPendingAnswers();
  testSavePendingAnswersSuccess();
  testSavePendingAnswersRevisionMismatch();
  testClearPendingAnswersSuccess();
  testClearNoCheckpoint();
  testFingerprintConsistency();
  testEmptyAnswersReturnsNull();

  console.log(`\n=== 结果：${pass} 通过，${fail} 失败 ===`);
  if (fail > 0) {
    console.error('失败项：', failures);
    process.exit(1);
  }
}

main();
