/**
 * targetStage 局部修改单元测试（M2）。
 *
 * 覆盖场景：
 *   1. determine_stage：feedback + targetStage → 直接路由到 generate_questions（不调用模型提取）
 *   2. generate_questions：targetStage 存在时为该阶段全部字段生成卡片
 *   3. generate_questions：targetStage 消费后清除（设为 null）
 *   4. 局部修改隔离：targetStage 只修改目标阶段字段，不清空其他阶段数据
 *   5. targetStage='review' 防御性重定向到 build_summary
 *
 * 运行：npx tsx tests/unit/target-stage.test.ts
 */
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

import { initDatabase, closeDatabase } from '../../src/infrastructure/database/connection';
import { settingsRepository } from '../../src/infrastructure/database/repositories/settings-repository';

import { determineStage } from '../../src/agent/graphs/onboarding/nodes/determine-stage';
import { createGenerateQuestionsNode } from '../../src/agent/graphs/onboarding/nodes/generate-questions';
import { createInitialOnboardingState, type OnboardingStateType } from '../../src/agent/graphs/onboarding/state';
import {
  createInitialDraft,
  ONBOARDING_STAGE,
  getFieldsForStage,
  DRAFT_FIELD_NAMES,
  type CharacterRequirementDraft
} from '../../src/services/character-onboarding/schemas';
import type { ModelGateway, ModelRequest, ModelResult } from '../../src/services/ModelGateway';
import type { ModelMode, ModelAlias } from '../../src/shared/constants';
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'petdb-target-'));
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

const DEFAULT_PACK_PATH = path.resolve(__dirname, '../../character-packs/default');

/** Mock ModelGateway：question generation 返回固定结构 */
function createMockGateway(): ModelGateway {
  const gateway = {
    invoke: async (request: ModelRequest): Promise<ModelResult> => {
      // generateQuestionsWithModel 调用模型生成问题
      // 返回一个简单的 JSON，包含 questions 数组
      const userMessage = request.messages.find((m) => m.role === 'user')?.content || '';
      // 从用户消息中解析阶段
      const stageMatch = userMessage.match(/currentStage[":\s]+(\w+)/);
      const stage = stageMatch?.[1] ?? 'basic';

      const fields = getFieldsForStage(stage as ONBOARDING_STAGE);
      // 为每个字段生成一个问题
      const questions = fields.map((f, i) => ({
        id: `q-${stage}-${f}-${i}`,
        fieldPaths: [f],
        type: 'text' as const,
        question: `请回答 ${f} 的内容`,
        allowOther: false,
        required: true
      }));

      const result: ModelResult = {
        content: JSON.stringify({ questions }),
        model: 'mock-model',
        alias: 'balanced' as ModelAlias,
        mode: 'balanced' as ModelMode,
        inputTokens: 100,
        outputTokens: 50,
        durationMs: 10,
        success: true,
        parsed: { questions }
      };
      return result;
    },
    invokeWithFallback: async (request: ModelRequest): Promise<ModelResult> => {
      return gateway.invoke(request);
    },
    beginTurn: () => {},
    endTurn: () => {},
    getTurnCallCount: () => 0,
    resetTurnCallCount: () => {}
  } as unknown as ModelGateway;
  return gateway;
}

/** 构造一个已填充全部阶段数据的 draft（CoverageValidator 会判定为 REVIEW） */
function buildFilledDraft(): CharacterRequirementDraft {
  const draft = createInitialDraft();
  // basic 阶段全部填充
  draft.fields.characterName = '测试角色';
  draft.fields.characterIdentity = '一位测试角色';
  draft.fields.userPetName = '用户';
  draft.fields.selfPetName = '老师';
  draft.fields.referenceCharacter = '参考';
  draft.fields.keepTraits = ['温柔'];
  draft.fields.excludeTraits = ['冷漠'];
  // speaking 阶段全部填充
  draft.fields.tone = '温柔';
  draft.fields.replyLength = 'medium';
  draft.fields.proactiveFollowUp = 'medium';
  draft.fields.jokeLevel = 'low';
  draft.fields.flirtLevel = 'low';
  draft.fields.tsundereLevel = 'low';
  draft.fields.catchphrase = '你好';
  draft.fields.forbiddenExpressions = ['脏话'];
  // relationship 阶段全部填充
  draft.fields.relationshipType = '朋友';
  draft.fields.intimacyLevel = 'medium';
  draft.fields.forbiddenBoundaries = ['无'];
  draft.fields.lowMoodResponse = '安慰';
  draft.fields.dangerousRequestResponse = '拒绝';
  // taboos 阶段全部填充
  draft.fields.cannotBecome = '无';
  draft.fields.cannotSay = '脏话';
  draft.fields.cannotDo = '违法';
  draft.fields.avoidAssistantFeel = '无';
  draft.stage = ONBOARDING_STAGE.REVIEW;
  draft.revision = 5;
  return draft;
}

function buildState(draft: CharacterRequirementDraft, overrides: Partial<OnboardingStateType> = {}): OnboardingStateType {
  const base = createInitialOnboardingState(DEFAULT_PACK_PATH, 'test-thread', 'test-trace');
  return {
    ...base,
    draft,
    currentStage: draft.stage,
    phase: 'collecting',
    userAction: 'feedback',
    targetStage: null,
    expectedRevision: -1,
    ...overrides
  };
}

// ===== 测试 1：determine_stage 路由 =====
async function testDetermineStageRouting(): Promise<void> {
  console.log('\n--- 测试 1：determine_stage feedback + targetStage 路由 ---');

  // 1a：feedback + targetStage='basic' → 直接路由到 generate_questions
  const draft = buildFilledDraft();
  const state1 = buildState(draft, {
    userAction: 'feedback',
    targetStage: ONBOARDING_STAGE.BASIC
  });
  const result1 = await determineStage(state1);
  check('1.1 currentStep = generate_questions', result1.currentStep === 'generate_questions');
  check('1.2 currentStage = basic（目标阶段）', result1.currentStage === ONBOARDING_STAGE.BASIC);
  check('1.3 phase = collecting', result1.phase === 'collecting');

  // 1b：feedback + targetStage='speaking' → 路由到 speaking
  const state2 = buildState(draft, {
    userAction: 'feedback',
    targetStage: ONBOARDING_STAGE.SPEAKING
  });
  const result2 = await determineStage(state2);
  check('1.4 targetStage=speaking → currentStage = speaking', result2.currentStage === ONBOARDING_STAGE.SPEAKING);
  check('1.5 currentStep = generate_questions', result2.currentStep === 'generate_questions');

  // 1c：feedback + targetStage='taboos' → 路由到 taboos
  const state3 = buildState(draft, {
    userAction: 'feedback',
    targetStage: ONBOARDING_STAGE.TABOOS
  });
  const result3 = await determineStage(state3);
  check('1.6 targetStage=taboos → currentStage = taboos', result3.currentStage === ONBOARDING_STAGE.TABOOS);

  // 1d：start + draft 完整 → 走正常 CoverageValidator 路径，路由到 build_summary
  const state4 = buildState(draft, {
    userAction: 'start',
    targetStage: null
  });
  const result4 = await determineStage(state4);
  // draft 已完整 → 应该路由到 build_summary（review 阶段）
  check('1.7 start + draft 完整 → build_summary', result4.currentStep === 'build_summary');
}

// ===== 测试 2：generate_questions 为目标阶段全部字段生成卡片 =====
async function testGenerateQuestionsForTargetStage(): Promise<void> {
  console.log('\n--- 测试 2：generate_questions 为目标阶段全部字段生成卡片 ---');
  const dbPath = tempDbPath();
  try {
    initDatabase({ path: dbPath });
    settingsRepository.set('user_id', 'test-user');
    settingsRepository.set('active_character_id', 'test-char');

    const draft = buildFilledDraft();
    const gateway = createMockGateway();
    const generateQuestions = createGenerateQuestionsNode(gateway);

    // targetStage='basic' → 应为 basic 阶段全部 7 个字段生成卡片
    const state = buildState(draft, {
      userAction: 'feedback',
      targetStage: ONBOARDING_STAGE.BASIC
    });

    const result = await generateQuestions(state);
    const basicFields = getFieldsForStage(ONBOARDING_STAGE.BASIC);
    check('2.1 currentQuestions 非空', Array.isArray(result.currentQuestions) && result.currentQuestions.length > 0);
    // QuestionGenerator 可能将多个字段合并为一张卡片，所以问题数量可能 < 字段数量
    // 关键是生成的卡片覆盖 basic 阶段全部字段
    const coveredFields = new Set<string>();
    for (const q of result.currentQuestions ?? []) {
      for (const fp of q.fieldPaths) {
        coveredFields.add(fp);
      }
    }
    check('2.2 currentQuestions 覆盖 basic 阶段全部字段',
      basicFields.every((f) => coveredFields.has(f)) === true);
    check('2.3 所有卡片的 fieldPaths 都属于 basic 阶段',
      result.currentQuestions?.every((q) => {
        return q.fieldPaths.every((f) => basicFields.includes(f as never));
      }) === true);

    // 验证 targetStage 被清除
    check('2.4 targetStage 被清除（null）', result.targetStage === null);
  } finally {
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 3：targetStage 消费后清除 =====
async function testTargetStageConsumed(): Promise<void> {
  console.log('\n--- 测试 3：targetStage 消费后清除 ---');
  const dbPath = tempDbPath();
  try {
    initDatabase({ path: dbPath });
    settingsRepository.set('user_id', 'test-user');
    settingsRepository.set('active_character_id', 'test-char');

    const draft = buildFilledDraft();
    const gateway = createMockGateway();
    const generateQuestions = createGenerateQuestionsNode(gateway);

    const state = buildState(draft, {
      userAction: 'feedback',
      targetStage: ONBOARDING_STAGE.SPEAKING
    });

    const result = await generateQuestions(state);
    check('3.1 返回值中 targetStage = null', result.targetStage === null);
    check('3.2 currentStage = speaking（目标阶段）', result.currentStage === ONBOARDING_STAGE.SPEAKING);
  } finally {
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 4：局部修改隔离（其他阶段数据不被清空） =====
async function testLocalModificationIsolation(): Promise<void> {
  console.log('\n--- 测试 4：局部修改隔离（其他阶段数据不被清空） ---');
  const dbPath = tempDbPath();
  try {
    initDatabase({ path: dbPath });
    settingsRepository.set('user_id', 'test-user');
    settingsRepository.set('active_character_id', 'test-char');

    const draft = buildFilledDraft();
    const originalBasicName = draft.fields.characterName;
    const originalSpeakingTone = draft.fields.tone;
    const originalRelationshipType = draft.fields.relationshipType;

    const gateway = createMockGateway();
    const generateQuestions = createGenerateQuestionsNode(gateway);

    // targetStage='basic' → 只修改 basic 阶段
    const state = buildState(draft, {
      userAction: 'feedback',
      targetStage: ONBOARDING_STAGE.BASIC
    });

    const result = await generateQuestions(state);
    // 验证 draft 仍存在（未被清空）
    check('4.1 draft 仍存在', result.draft !== null);
    // 验证其他阶段数据未被清空
    check('4.2 speaking 阶段 tone 仍保留', result.draft?.fields.tone === originalSpeakingTone);
    check('4.3 relationship 阶段 relationshipType 仍保留', result.draft?.fields.relationshipType === originalRelationshipType);
    check('4.4 basic 阶段 characterName 仍保留（用户未提交新回答，只是生成卡片）',
      result.draft?.fields.characterName === originalBasicName);
    // 验证 stage 被更新为目标阶段
    check('4.5 draft.stage 被更新为 basic', result.draft?.stage === ONBOARDING_STAGE.BASIC);
  } finally {
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 5：targetStage='review' 防御性重定向 =====
async function testReviewRedirect(): Promise<void> {
  console.log('\n--- 测试 5：targetStage=review 防御性重定向 ---');
  const dbPath = tempDbPath();
  try {
    initDatabase({ path: dbPath });
    settingsRepository.set('user_id', 'test-user');
    settingsRepository.set('active_character_id', 'test-char');

    const draft = buildFilledDraft();
    const gateway = createMockGateway();
    const generateQuestions = createGenerateQuestionsNode(gateway);

    const state = buildState(draft, {
      userAction: 'feedback',
      targetStage: ONBOARDING_STAGE.REVIEW
    });

    const result = await generateQuestions(state);
    // targetStage='review' 时不应生成问题，应重定向到 build_summary
    check('5.1 currentStep = build_summary', result.currentStep === 'build_summary');
    check('5.2 currentStage = review', result.currentStage === ONBOARDING_STAGE.REVIEW);
    check('5.3 targetStage 被清除', result.targetStage === null);
    check('5.4 currentQuestions 为空或未生成',
      !result.currentQuestions || result.currentQuestions.length === 0);
  } finally {
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 6：targetStage='relationship' 生成正确阶段卡片 =====
async function testRelationshipStageCards(): Promise<void> {
  console.log('\n--- 测试 6：targetStage=relationship 生成正确阶段卡片 ---');
  const dbPath = tempDbPath();
  try {
    initDatabase({ path: dbPath });
    settingsRepository.set('user_id', 'test-user');
    settingsRepository.set('active_character_id', 'test-char');

    const draft = buildFilledDraft();
    const gateway = createMockGateway();
    const generateQuestions = createGenerateQuestionsNode(gateway);

    const state = buildState(draft, {
      userAction: 'feedback',
      targetStage: ONBOARDING_STAGE.RELATIONSHIP
    });

    const result = await generateQuestions(state);
    const relationshipFields = getFieldsForStage(ONBOARDING_STAGE.RELATIONSHIP);
    // 检查覆盖全部字段（QuestionGenerator 可能合并字段为一张卡片）
    const coveredFields = new Set<string>();
    for (const q of result.currentQuestions ?? []) {
      for (const fp of q.fieldPaths) {
        coveredFields.add(fp);
      }
    }
    check('6.1 currentQuestions 覆盖 relationship 阶段全部字段',
      relationshipFields.every((f) => coveredFields.has(f)) === true);
    check('6.2 生成的卡片覆盖 relationship 阶段全部字段',
      result.currentQuestions?.every((q) => {
        return q.fieldPaths.every((f) => relationshipFields.includes(f as never));
      }) === true);
    check('6.3 currentStage = relationship', result.currentStage === ONBOARDING_STAGE.RELATIONSHIP);
  } finally {
    cleanupDbFile(dbPath);
  }
}

// ===== 运行所有测试 =====
async function main(): Promise<void> {
  console.log('=== targetStage 局部修改单元测试（M2） ===');
  await testDetermineStageRouting();
  await testGenerateQuestionsForTargetStage();
  await testTargetStageConsumed();
  await testLocalModificationIsolation();
  await testReviewRedirect();
  await testRelationshipStageCards();

  console.log(`\n=== 结果：${pass} 通过，${fail} 失败 ===`);
  if (fail > 0) {
    console.error('失败项：', failures);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('测试执行异常：', e);
  process.exit(1);
});
