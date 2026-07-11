/**
 * Reflection 证据校验测试。
 * 验证：
 *   1. evidenceQuote 是 userMessage 子串时，候选通过验证
 *   2. evidenceQuote 不是 userMessage 子串时，候选被拒绝
 *   3. evidenceQuote 为空时，候选被拒绝
 *   4. "我叫什么名字"这类查询不生成记忆候选（extract prompt 包含相关指令）
 *   5. create_reminder 意图不进入 Reflection（enqueueReflection 跳过逻辑）
 *
 * 运行：npx tsx tests/unit/reflection-evidence.test.ts
 */
import type { ReflectionStateType } from '../../src/agent/graphs/reflection/state';
import type { MemoryCandidate } from '../../src/agent/graphs/reflection/state';
import { validateCandidates } from '../../src/agent/graphs/reflection/nodes/validate-candidates';
import { createExtractMemoryCandidatesNode } from '../../src/agent/graphs/reflection/nodes/extract-memory-candidates';
import type { ModelGateway } from '../../src/services/ModelGateway';
import type { ModelRequest, ModelResult } from '../../src/services/ModelGateway';
import { enqueueReflection } from '../../src/agent/graphs/conversation/nodes/enqueue-reflection';
import type { ConversationStateType } from '../../src/agent/graphs/conversation/state';
import type { PersonaConfig, AppEvent } from '../../src/shared/contracts/graph-state';

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

// ===== 辅助函数 =====

function createTestPersona(): PersonaConfig {
  return {
    characterId: 'test-roxy',
    characterName: 'Roxy',
    corePrompt: '你是洛琪希。',
    speakingStyle: ['温柔礼貌'],
    relationshipBoundary: [],
    forbiddenDrift: [],
    commonTone: ['关心用户'],
    sampleDialogues: [],
    userPetName: '用户',
    defaultLanguage: 'zh'
  };
}

function createChatEvent(): AppEvent {
  return {
    schemaVersion: 1,
    eventId: `evt-${Date.now()}`,
    type: 'chat',
    occurredAt: new Date().toISOString(),
    timezone: 'Asia/Shanghai',
    source: 'renderer',
    userId: 'test-user',
    characterId: 'test-roxy',
    correlationId: `corr-${Date.now()}`,
    priority: 'normal',
    payload: { message: 'test' }
  };
}

/** 构建最小可用的 ReflectionStateType */
function createReflectionState(
  userMessage: string,
  candidates: MemoryCandidate[]
): ReflectionStateType {
  return {
    event: createChatEvent(),
    userId: 'test-user',
    characterId: 'test-roxy',
    sessionId: 'test-session',
    persona: createTestPersona(),
    modelMode: 'balanced',
    traceId: 'test-trace',
    startedAt: new Date().toISOString(),
    errors: [],
    modelCallCount: 0,
    reflectionPayload: {
      turnId: 'test-turn',
      userMessage,
      assistantReply: '好的',
      emotion: 'idle'
    },
    candidates,
    validCandidates: [],
    newCandidates: [],
    savedCandidates: [],
    reflectionResult: null
  } as ReflectionStateType;
}

/** 构建候选记忆 */
function createCandidate(
  content: string,
  evidenceQuote: string | undefined,
  type: MemoryCandidate['type'] = 'profile'
): MemoryCandidate {
  return {
    type,
    content,
    scope: 'global',
    confidence: 0.8,
    evidenceQuote,
    sourceRole: 'user',
    valid: false,
    updated: false
  };
}

/** 创建 mock ModelGateway，捕获 prompt 并返回指定 JSON */
function createMockModelGateway(candidatesJson: string): {
  gateway: ModelGateway;
  capturedMessages: Array<{ role: string; content: string }>;
} {
  const capturedMessages: Array<{ role: string; content: string }> = [];
  const gateway = {
    invoke(req: ModelRequest): Promise<ModelResult> {
      for (const msg of req.messages) {
        capturedMessages.push({ role: msg.role, content: msg.content });
      }
      const result: ModelResult = {
        content: candidatesJson,
        model: 'mock',
        alias: 'low_cost' as any,
        mode: req.mode,
        inputTokens: 10,
        outputTokens: 10,
        durationMs: 1,
        success: true,
        parsed: JSON.parse(candidatesJson)
      };
      return Promise.resolve(result);
    },
    beginTurn: () => {},
    endTurn: () => {}
  } as unknown as ModelGateway;
  return { gateway, capturedMessages };
}

// ===== 测试 1：evidenceQuote 是 userMessage 子串时通过 =====
async function testEvidenceQuoteMatch(): Promise<void> {
  const userMessage = '我是程序员，喜欢简洁的回答';
  const candidates = [
    createCandidate('用户是程序员', '我是程序员'),
    createCandidate('用户喜欢简洁回答', '喜欢简洁的回答')
  ];
  const state = createReflectionState(userMessage, candidates);

  const result = await validateCandidates(state);

  check('EvidenceMatch: 2 candidates valid', (result.validCandidates ?? []).length === 2);
  check('EvidenceMatch: first candidate has sourceRole user',
    (result.validCandidates ?? [])[0]?.sourceRole === 'user');
}

// ===== 测试 2：evidenceQuote 不是 userMessage 子串时被拒绝 =====
async function testEvidenceQuoteNotMatch(): Promise<void> {
  const userMessage = '我是程序员';
  // evidenceQuote 不在 userMessage 中（来自 AI 回复的虚构内容）
  const candidates = [
    createCandidate('用户是设计师', '我是一名设计师')
  ];
  const state = createReflectionState(userMessage, candidates);

  const result = await validateCandidates(state);

  check('EvidenceNotMatch: 0 valid candidates', (result.validCandidates ?? []).length === 0);
}

// ===== 测试 3：evidenceQuote 为空时被拒绝 =====
async function testEvidenceQuoteEmpty(): Promise<void> {
  const userMessage = '我是程序员';
  const candidates = [
    createCandidate('用户是程序员', undefined),
    createCandidate('用户是程序员', '')
  ];
  const state = createReflectionState(userMessage, candidates);

  const result = await validateCandidates(state);

  check('EvidenceEmpty: 0 valid candidates', (result.validCandidates ?? []).length === 0);
}

// ===== 测试 4：extract prompt 包含"我叫什么名字"查询约束 =====
async function testExtractPromptContainsQueryConstraint(): Promise<void> {
  const { gateway, capturedMessages } = createMockModelGateway(
    JSON.stringify({ candidates: [] })
  );

  const node = createExtractMemoryCandidatesNode(gateway);
  const state = createReflectionState('我叫什么名字', []);

  await node(state);

  const systemPrompt = capturedMessages.find(m => m.role === 'system')?.content ?? '';

  check('PromptConstraint: system prompt mentions evidenceQuote',
    systemPrompt.includes('evidenceQuote') === true);
  check('PromptConstraint: system prompt mentions "我叫什么名字"',
    systemPrompt.includes('我叫什么名字') === true);
  check('PromptConstraint: system prompt mentions assistantReply is context only',
    systemPrompt.includes('assistantReply') === true);
  check('PromptConstraint: user prompt labels userMessage',
    (capturedMessages.find(m => m.role === 'user')?.content ?? '').includes('【用户消息(userMessage)】') === true);
}

// ===== 测试 5：create_reminder 意图不进入 Reflection =====
async function testCreateReminderSkipped(): Promise<void> {
  // 构建一个 create_reminder 意图的 ConversationStateType
  const state = {
    event: createChatEvent(),
    userId: 'test-user',
    characterId: 'test-roxy',
    sessionId: 'test-session',
    persona: createTestPersona(),
    modelMode: 'balanced' as const,
    traceId: 'test-trace',
    startedAt: new Date().toISOString(),
    errors: [],
    modelCallCount: 0,
    userInput: '提醒我明天下午3点开会',
    messages: [],
    intent: 'create_reminder' as const,
    retrievedMemories: [],
    reminderDraft: null,
    missingFields: [],
    selectedSkillId: null,
    skillResult: null,
    responseText: '好的，已创建提醒',
    expression: 'idle',
    motion: 'idle',
    reflectionPayload: null,
    responseDTO: null,
    checkpointReason: '',
    shouldAskUser: false,
    askUserMessage: '',
    checkpointId: ''
  } as unknown as ConversationStateType;

  const result = await enqueueReflection(state);

  // create_reminder 应被跳过，返回空对象（无 reflectionPayload）
  check('CreateReminderSkip: returns empty (no reflectionPayload)',
    result.reflectionPayload === undefined);

  // 同时验证 expression 和 list_schedule 也被跳过
  const exprState = { ...state, intent: 'expression' as const } as ConversationStateType;
  const exprResult = await enqueueReflection(exprState);
  check('CreateReminderSkip: expression also skipped',
    exprResult.reflectionPayload === undefined);

  const listState = { ...state, intent: 'list_schedule' as const } as ConversationStateType;
  const listResult = await enqueueReflection(listState);
  check('CreateReminderSkip: list_schedule also skipped',
    listResult.reflectionPayload === undefined);
}

// ===== 主函数 =====
async function main(): Promise<void> {
  console.log('=== Reflection 证据校验测试 ===\n');

  await testEvidenceQuoteMatch();
  console.log('');
  await testEvidenceQuoteNotMatch();
  console.log('');
  await testEvidenceQuoteEmpty();
  console.log('');
  await testExtractPromptContainsQueryConstraint();
  console.log('');
  await testCreateReminderSkipped();

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
