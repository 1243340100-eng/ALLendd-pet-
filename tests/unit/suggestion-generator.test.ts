/**
 * SuggestionGenerator 单元测试（M2）。
 *
 * 覆盖场景：
 *   1. 80 字截断：模型返回超长建议时程序化截断到 80 字符
 *   2. 非文本题拒绝：single_choice/multiple_choice 题型返回 reason
 *   3. 模型调用失败：返回 ok=false + reason
 *   4. JSON 解析失败：返回 ok=false + reason
 *   5. 空建议：返回 ok=false + reason
 *   6. 正常短建议：原样返回
 *
 * 运行：npx tsx tests/unit/suggestion-generator.test.ts
 */
import { generateSuggestion, type SuggestionInput } from '../../src/services/character-onboarding/SuggestionGenerator';
import type { ModelGateway, ModelRequest, ModelResult } from '../../src/services/ModelGateway';
import type { ModelMode, ModelAlias } from '../../src/shared/constants';
import { createInitialDraft, type OnboardingQuestion } from '../../src/services/character-onboarding/schemas';

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

/** 可控 Mock ModelGateway，可指定返回的 content */
function createMockGateway(responseContent: string, success = true): ModelGateway {
  const gateway = {
    invoke: async (_request: ModelRequest): Promise<ModelResult> => {
      if (!success) {
        return {
          content: '',
          model: 'mock-model',
          alias: 'balanced' as ModelAlias,
          mode: 'balanced' as ModelMode,
          inputTokens: 0,
          outputTokens: 0,
          durationMs: 0,
          success: false,
          errorCode: 'model-unavailable'
        };
      }
      return {
        content: responseContent,
        model: 'mock-model',
        alias: 'balanced' as ModelAlias,
        mode: 'balanced' as ModelMode,
        inputTokens: 100,
        outputTokens: 50,
        durationMs: 10,
        success: true
      };
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

function buildTextInput(): SuggestionInput {
  const question: OnboardingQuestion = {
    id: 'q-suggestion',
    fieldPaths: ['characterIdentity'],
    type: 'text',
    question: '请描述角色的身份设定',
    allowOther: false,
    required: true
  };
  return {
    question,
    currentDraft: createInitialDraft(),
    currentStage: 'basic',
    traceId: 'test-trace'
  };
}

// ===== 测试 1：80 字截断 =====
function testTruncateTo80(): void {
  console.log('\n--- 测试 1：80 字截断 ---');
  // 构造一个 120 字符的建议（确保 > 80）
  const longSuggestion = 'A'.repeat(120);
  check('1.0 模拟建议长度 > 80', longSuggestion.length > 80);
  const mockGateway = createMockGateway(JSON.stringify({ suggestion: longSuggestion }));
  const result = generateSuggestion(mockGateway, buildTextInput());
  return result.then((r) => {
    check('1.1 ok=true', r.ok === true);
    check('1.2 suggestion 非空', r.suggestion !== null && r.suggestion.length > 0);
    check('1.3 suggestion 长度 <= 80', r.suggestion !== null && r.suggestion.length <= 80);
    check('1.4 suggestion 长度恰好是 80（截断）', r.suggestion !== null && r.suggestion.length === 80);
    check('1.5 截断后是原始建议的前 80 字符',
      r.suggestion === longSuggestion.slice(0, 80));
  });
}

// ===== 测试 2：非文本题拒绝 =====
function testNonTextQuestion(): void {
  console.log('\n--- 测试 2：非文本题拒绝建议生成 ---');
  const input = buildTextInput();
  // 改为 single_choice
  input.question = {
    ...input.question,
    type: 'single_choice',
    options: [
      { id: 'A', label: '选项A', value: 'a' },
      { id: 'B', label: '选项B', value: 'b' }
    ]
  };
  const mockGateway = createMockGateway(JSON.stringify({ suggestion: '不应该被调用' }));
  return generateSuggestion(mockGateway, input).then((r) => {
    check('2.1 ok=false', r.ok === false);
    check('2.2 reason 是 "suggestion-only-for-text"', r.reason === 'suggestion-only-for-text');
    check('2.3 suggestion 是 null', r.suggestion === null);
  });
}

// ===== 测试 3：模型调用失败 =====
function testModelCallFailed(): void {
  console.log('\n--- 测试 3：模型调用失败 ---');
  const mockGateway = createMockGateway('', false);
  return generateSuggestion(mockGateway, buildTextInput()).then((r) => {
    check('3.1 ok=false', r.ok === false);
    check('3.2 reason 非空', r.reason !== undefined && r.reason.length > 0);
    check('3.3 suggestion 是 null', r.suggestion === null);
  });
}

// ===== 测试 4：JSON 解析失败 =====
function testJsonParseFailed(): void {
  console.log('\n--- 测试 4：JSON 解析失败 ---');
  const mockGateway = createMockGateway('这不是有效的JSON');
  return generateSuggestion(mockGateway, buildTextInput()).then((r) => {
    check('4.1 ok=false', r.ok === false);
    check('4.2 reason 是 "json-parse-failed"', r.reason === 'json-parse-failed');
    check('4.3 suggestion 是 null', r.suggestion === null);
  });
}

// ===== 测试 5：空建议 =====
function testEmptySuggestion(): void {
  console.log('\n--- 测试 5：空建议 ---');
  const mockGateway = createMockGateway(JSON.stringify({ suggestion: '   ' }));
  return generateSuggestion(mockGateway, buildTextInput()).then((r) => {
    check('5.1 ok=false', r.ok === false);
    check('5.2 reason 是 "empty-suggestion"', r.reason === 'empty-suggestion');
    check('5.3 suggestion 是 null', r.suggestion === null);
  });
}

// ===== 测试 6：正常短建议 =====
function testNormalShortSuggestion(): void {
  console.log('\n--- 测试 6：正常短建议（<=80 字符）原样返回 ---');
  const shortSuggestion = '一位温柔的图书管理员，喜欢安静地阅读';
  check('6.0 模拟建议长度 <= 80', shortSuggestion.length <= 80);
  const mockGateway = createMockGateway(JSON.stringify({ suggestion: shortSuggestion }));
  return generateSuggestion(mockGateway, buildTextInput()).then((r) => {
    check('6.1 ok=true', r.ok === true);
    check('6.2 suggestion 非空', r.suggestion !== null && r.suggestion.length > 0);
    check('6.3 suggestion 等于原始值（未截断）', r.suggestion === shortSuggestion);
    check('6.4 suggestion 长度 <= 80', r.suggestion !== null && r.suggestion.length <= 80);
  });
}

// ===== 测试 7：恰好 80 字符不截断 =====
function testExactly80Chars(): void {
  console.log('\n--- 测试 7：恰好 80 字符不截断 ---');
  // 构造恰好 80 字符的建议
  const exact80 = 'B'.repeat(80);
  check('7.0 模拟建议长度恰好 80', exact80.length === 80);
  const mockGateway = createMockGateway(JSON.stringify({ suggestion: exact80 }));
  return generateSuggestion(mockGateway, buildTextInput()).then((r) => {
    check('7.1 ok=true', r.ok === true);
    check('7.2 suggestion 长度 = 80', r.suggestion !== null && r.suggestion.length === 80);
    check('7.3 suggestion 等于原始值（未截断）', r.suggestion === exact80);
  });
}

// ===== 运行所有测试 =====
async function main(): Promise<void> {
  console.log('=== SuggestionGenerator 单元测试（M2） ===');
  await testTruncateTo80();
  await testNonTextQuestion();
  await testModelCallFailed();
  await testJsonParseFailed();
  await testEmptySuggestion();
  await testNormalShortSuggestion();
  await testExactly80Chars();

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
