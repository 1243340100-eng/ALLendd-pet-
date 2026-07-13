/**
 * AnswerProcessor 单元测试（M2）。
 *
 * 覆盖场景：
 *   1. 选项值篡改：renderer 传入的 selectedValues 被忽略，只使用 selectedOptionIds
 *   2. 非法 option ID：不存在的选项 ID 整批拒绝
 *   3. 数量限制：单选只能一个、多选不超过 maxSelect
 *   4. 题型不匹配：answerType 与 question.type 不一致整批拒绝
 *   5. 混合回答合并：选项 + 自由文本组合，mergeDirectAndModelExtraction 正确合并
 *   6. 数组字段重新选择：correction + update 双发
 *   7. 字符串字段重新选择：correction
 *
 * 运行：npx tsx tests/unit/answer-processor.test.ts
 */
import {
  processAnswers,
  mergeDirectAndModelExtraction,
  type AnswerProcessorInput
} from '../../src/services/character-onboarding/AnswerProcessor';
import {
  createInitialDraft,
  DRAFT_FIELD_NAMES,
  type OnboardingQuestion,
  type OnboardingQuestionAnswer,
  type CharacterRequirementDraft,
  type AnswerExtraction
} from '../../src/services/character-onboarding/schemas';

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

function buildQuestion(overrides: Partial<OnboardingQuestion> = {}): OnboardingQuestion {
  return {
    id: 'q-test',
    fieldPaths: ['tone'],
    type: 'single_choice',
    question: '请选择语气风格',
    options: [
      { id: 'A', label: '温柔', value: 'gentle' },
      { id: 'B', label: '活泼', value: 'lively' },
      { id: 'C', label: '冷静', value: 'calm' }
    ],
    allowOther: false,
    required: true,
    ...overrides
  };
}

function buildAnswer(overrides: Partial<OnboardingQuestionAnswer> = {}): OnboardingQuestionAnswer {
  return {
    questionId: 'q-test',
    fieldPaths: ['tone'],
    answerType: 'single_choice',
    selectedOptionIds: ['A'],
    ...overrides
  };
}

function buildInput(overrides: Partial<AnswerProcessorInput> = {}): AnswerProcessorInput {
  const draft = createInitialDraft();
  return {
    currentQuestions: [buildQuestion()],
    answers: [buildAnswer()],
    currentDraft: draft,
    currentStage: 'speaking',
    traceId: 'test-trace',
    ...overrides
  };
}

// ===== 测试 1：选项值篡改（selectedValues 被忽略） =====
function testSelectedValuesIgnored(): void {
  console.log('\n--- 测试 1：选项值篡改（renderer 传入的 selectedValues 必须被忽略） ---');
  // AnswerProcessor 的输入 OnboardingQuestionAnswer 不包含 selectedValues（schema 严格），
  // 即使 renderer 试图传入 selectedValues，Zod .strict() 会拒绝。
  // 这里验证 processAnswers 只从 selectedOptionIds + checkpoint options 映射 value。
  const input = buildInput({
    answers: [buildAnswer({ selectedOptionIds: ['B'] })]
  });
  const result = processAnswers(input);
  check('1.1 无错误', result.errors.length === 0);
  check('1.2 生成 1 个 update', result.directExtraction.updates.length === 1);
  check('1.3 value 是 "lively"（从 checkpoint options 映射，非 renderer 篡改值）',
    result.directExtraction.updates[0]?.value === 'lively');
  check('1.4 evidenceQuote 包含选项 label "活泼"',
    result.directExtraction.updates[0]?.evidenceQuote.includes('活泼') === true);
}

// ===== 测试 2：非法 option ID =====
function testInvalidOptionId(): void {
  console.log('\n--- 测试 2：非法 option ID 整批拒绝 ---');
  const input = buildInput({
    answers: [buildAnswer({ selectedOptionIds: ['X', 'Y'] })]
  });
  const result = processAnswers(input);
  check('2.1 有错误', result.errors.length > 0);
  check('2.2 错误信息包含"不存在的选项 ID"',
    result.errors.some((e) => e.includes('不存在的选项 ID')) === true);
  check('2.3 directExtraction.updates 为空（整批拒绝）',
    result.directExtraction.updates.length === 0);
  check('2.4 freeText 为空', result.freeText === '');
}

// ===== 测试 3：数量限制 =====
function testQuantityLimits(): void {
  console.log('\n--- 测试 3：数量限制 ---');

  // 3a：单选题选择多个 → 拒绝
  const inputSingle = buildInput({
    answers: [buildAnswer({ selectedOptionIds: ['A', 'B'] })]
  });
  const resultSingle = processAnswers(inputSingle);
  check('3.1 单选题选 2 个 → 有错误', resultSingle.errors.length > 0);
  check('3.2 错误信息包含"单选题"',
    resultSingle.errors.some((e) => e.includes('单选题')) === true);

  // 3b：多选题超过 maxSelect → 拒绝
  const multiQuestion = buildQuestion({
    id: 'q-multi',
    fieldPaths: ['keepTraits'],
    type: 'multiple_choice',
    question: '请选择保留特质（最多 2 个）',
    options: [
      { id: 'A', label: '温柔', value: 'gentle' },
      { id: 'B', label: '活泼', value: 'lively' },
      { id: 'C', label: '冷静', value: 'calm' }
    ],
    maxSelect: 2,
    required: true
  });
  const inputMulti = buildInput({
    currentQuestions: [multiQuestion],
    answers: [buildAnswer({
      questionId: 'q-multi',
      fieldPaths: ['keepTraits'],
      answerType: 'multiple_choice',
      selectedOptionIds: ['A', 'B', 'C']
    })],
    currentStage: 'basic'
  });
  const resultMulti = processAnswers(inputMulti);
  check('3.3 多选题选 3 个超过 maxSelect=2 → 有错误', resultMulti.errors.length > 0);
  check('3.4 错误信息包含"最大选择数"',
    resultMulti.errors.some((e) => e.includes('最大选择数')) === true);

  // 3c：多选题未超 maxSelect → 通过
  const inputMultiOk = buildInput({
    currentQuestions: [multiQuestion],
    answers: [buildAnswer({
      questionId: 'q-multi',
      fieldPaths: ['keepTraits'],
      answerType: 'multiple_choice',
      selectedOptionIds: ['A', 'B']
    })],
    currentStage: 'basic'
  });
  const resultMultiOk = processAnswers(inputMultiOk);
  check('3.5 多选题选 2 个 = maxSelect → 无错误', resultMultiOk.errors.length === 0);
  check('3.6 value 是数组 [gentle, lively]',
    Array.isArray(resultMultiOk.directExtraction.updates[0]?.value) &&
    JSON.stringify(resultMultiOk.directExtraction.updates[0]?.value) === JSON.stringify(['gentle', 'lively']));
}

// ===== 测试 4：题型不匹配 =====
function testTypeMismatch(): void {
  console.log('\n--- 测试 4：题型不匹配整批拒绝 ---');
  const input = buildInput({
    answers: [buildAnswer({
      answerType: 'text',  // 题型是 single_choice 但回答类型是 text
      selectedOptionIds: undefined,
      customText: '我想要温柔一点'
    })]
  });
  const result = processAnswers(input);
  check('4.1 有错误', result.errors.length > 0);
  check('4.2 错误信息包含"回答类型"和"不匹配"',
    result.errors.some((e) => e.includes('回答类型') && e.includes('不匹配')) === true);
  check('4.3 directExtraction.updates 为空', result.directExtraction.updates.length === 0);
}

// ===== 测试 5：混合回答合并 =====
function testHybridMerge(): void {
  console.log('\n--- 测试 5：混合回答合并（选项 + 自由文本） ---');
  const hybridQuestion = buildQuestion({
    id: 'q-hybrid',
    fieldPaths: ['tone'],
    type: 'hybrid',
    question: '请选择语气风格，可补充说明',
    options: [
      { id: 'A', label: '温柔', value: 'gentle' },
      { id: 'B', label: '活泼', value: 'lively' }
    ],
    allowOther: true,
    maxSelect: 1,
    required: true
  });
  const input = buildInput({
    currentQuestions: [hybridQuestion],
    answers: [buildAnswer({
      questionId: 'q-hybrid',
      fieldPaths: ['tone'],
      answerType: 'hybrid',
      selectedOptionIds: ['A'],
      customText: '温柔但偶尔会撒娇'
    })],
    currentStage: 'speaking'
  });
  const result = processAnswers(input);
  check('5.1 无错误', result.errors.length === 0);
  check('5.2 directExtraction 有 1 个 update（选项部分）',
    result.directExtraction.updates.length === 1);
  check('5.3 选项 value 是 "gentle"',
    result.directExtraction.updates[0]?.value === 'gentle');
  check('5.4 freeText 非空（自由文本部分交给模型）',
    result.freeText.length > 0);
  check('5.5 freeText 包含"温柔但偶尔会撒娇"',
    result.freeText.includes('温柔但偶尔会撒娇') === true);
  check('5.6 freeTextFields 包含 tone',
    result.freeTextFields.includes('tone') === true);

  // 5b：合并 direct + model extraction
  const modelExtraction: AnswerExtraction = {
    updates: [
      { field: 'tone', value: '温柔且偶尔撒娇', evidenceQuote: '用户补充' }
    ],
    explicitCorrections: [],
    ambiguities: []
  };
  const merged = mergeDirectAndModelExtraction(result.directExtraction, modelExtraction);
  check('5.7 合并后 updates 仍是 1 个（同字段组合）',
    merged.updates.length === 1);
  const mergedValue = merged.updates[0]?.value;
  check('5.8 合并值是 "gentle（温柔且偶尔撒娇）"（选项值 + 补充说明）',
    mergedValue === 'gentle（温柔且偶尔撒娇）');
}

// ===== 测试 6：数组字段重新选择（correction + update 双发） =====
function testArrayReselect(): void {
  console.log('\n--- 测试 6：数组字段重新选择生成 correction + update ---');
  const multiQuestion = buildQuestion({
    id: 'q-arr',
    fieldPaths: ['keepTraits'],
    type: 'multiple_choice',
    question: '请选择保留特质',
    options: [
      { id: 'A', label: '温柔', value: 'gentle' },
      { id: 'B', label: '活泼', value: 'lively' },
      { id: 'C', label: '冷静', value: 'calm' }
    ],
    maxSelect: 3,
    required: true
  });
  // draft 中已有值 ['gentle']
  const draft = createInitialDraft();
  draft.fields.keepTraits = ['gentle'];
  const input = buildInput({
    currentQuestions: [multiQuestion],
    currentDraft: draft,
    answers: [buildAnswer({
      questionId: 'q-arr',
      fieldPaths: ['keepTraits'],
      answerType: 'multiple_choice',
      selectedOptionIds: ['B', 'C']  // 重新选择，新值是 ['lively', 'calm']
    })],
    currentStage: 'basic'
  });
  const result = processAnswers(input);
  check('6.1 无错误', result.errors.length === 0);
  check('6.2 有 1 个 correction（审计记录）',
    result.directExtraction.explicitCorrections.length === 1);
  check('6.3 correction.field 是 keepTraits',
    result.directExtraction.explicitCorrections[0]?.field === 'keepTraits');
  check('6.4 correction.oldValue 是 ["gentle"] 的 JSON',
    result.directExtraction.explicitCorrections[0]?.oldValue === JSON.stringify(['gentle']));
  check('6.5 correction.newValue 是 ["lively","calm"] 的 JSON',
    result.directExtraction.explicitCorrections[0]?.newValue === JSON.stringify(['lively', 'calm']));
  check('6.6 有 1 个 update（数据替换）',
    result.directExtraction.updates.length === 1);
  check('6.7 update.value 是新数组 [lively, calm]',
    Array.isArray(result.directExtraction.updates[0]?.value) &&
    JSON.stringify(result.directExtraction.updates[0]?.value) === JSON.stringify(['lively', 'calm']));
}

// ===== 测试 7：字符串字段重新选择（correction） =====
function testStringReselect(): void {
  console.log('\n--- 测试 7：字符串字段重新选择生成 correction ---');
  const draft = createInitialDraft();
  draft.fields.tone = 'gentle';  // 已有值
  const input = buildInput({
    currentDraft: draft,
    answers: [buildAnswer({ selectedOptionIds: ['B'] })]  // 重新选择 'lively'
  });
  const result = processAnswers(input);
  check('7.1 无错误', result.errors.length === 0);
  check('7.2 有 1 个 correction',
    result.directExtraction.explicitCorrections.length === 1);
  check('7.3 correction.oldValue 是 "gentle"',
    result.directExtraction.explicitCorrections[0]?.oldValue === 'gentle');
  check('7.4 correction.newValue 是 "lively"',
    result.directExtraction.explicitCorrections[0]?.newValue === 'lively');
  check('7.5 无 update（字符串重新选择只生成 correction）',
    result.directExtraction.updates.length === 0);
}

// ===== 测试 8：不存在的问题 ID =====
function testNonExistentQuestion(): void {
  console.log('\n--- 测试 8：回答引用不存在的问题 ID ---');
  const input = buildInput({
    answers: [buildAnswer({ questionId: 'q-nonexistent' })]
  });
  const result = processAnswers(input);
  check('8.1 有错误', result.errors.length > 0);
  check('8.2 错误信息包含"不存在的问题"',
    result.errors.some((e) => e.includes('不存在的问题')) === true);
}

// ===== 测试 9：纯自由文本（text 题型） =====
function testPureFreeText(): void {
  console.log('\n--- 测试 9：纯自由文本（text 题型）交给模型 ---');
  const textQuestion = buildQuestion({
    id: 'q-text',
    fieldPaths: ['characterName'],
    type: 'text',
    question: '请输入角色名字',
    options: undefined,
    required: true
  });
  const input = buildInput({
    currentQuestions: [textQuestion],
    answers: [buildAnswer({
      questionId: 'q-text',
      fieldPaths: ['characterName'],
      answerType: 'text',
      selectedOptionIds: undefined,
      customText: '小明'
    })],
    currentStage: 'basic'
  });
  const result = processAnswers(input);
  check('9.1 无错误', result.errors.length === 0);
  check('9.2 directExtraction.updates 为空（纯文本不直接构造）',
    result.directExtraction.updates.length === 0);
  check('9.3 freeText 非空', result.freeText.length > 0);
  check('9.4 freeText 包含"小明"', result.freeText.includes('小明') === true);
  check('9.5 freeTextFields 包含 characterName',
    result.freeTextFields.includes('characterName') === true);
}

// ===== 测试 10：hybrid 无 options + 纯文本回答（taboos 阶段场景） =====
function testHybridNoOptionsTextOnly(): void {
  console.log('\n--- 测试 10：hybrid 无 options + 纯文本回答（taboos 阶段 cannotSay） ---');
  // taboos 阶段的 cannotSay/cannotBecome/cannotDo 都是 hybrid 类型且无 options
  // 用户只能填自由文本，前端 answerType 可能是 'text' 或 'hybrid'
  // 后端必须接受这两种 answerType，不报类型不匹配错误
  const hybridNoOptionsQuestion = buildQuestion({
    id: 'cannotSay',
    fieldPaths: ['cannotSay'],
    type: 'hybrid',
    question: '角色不能说什么？',
    options: undefined,
    allowOther: true,
    required: false
  });

  // 场景 A：前端传 answerType='text'（修复前会报错）
  const inputA = buildInput({
    currentQuestions: [hybridNoOptionsQuestion],
    answers: [buildAnswer({
      questionId: 'cannotSay',
      fieldPaths: ['cannotSay'],
      answerType: 'text',
      selectedOptionIds: undefined,
      customText: '不能说脏话'
    })],
    currentStage: 'taboos'
  });
  const resultA = processAnswers(inputA);
  check('10.1 hybrid 无 options + answerType=text → 无错误', resultA.errors.length === 0);
  check('10.2 freeText 非空', resultA.freeText.length > 0);
  check('10.3 freeText 包含"不能说脏话"', resultA.freeText.includes('不能说脏话') === true);
  check('10.4 freeTextFields 包含 cannotSay',
    resultA.freeTextFields.includes('cannotSay') === true);
  check('10.5 directExtraction.updates 为空（纯文本不产生直接 updates）',
    resultA.directExtraction.updates.length === 0);

  // 场景 B：前端传 answerType='hybrid'（也必须接受）
  const inputB = buildInput({
    currentQuestions: [hybridNoOptionsQuestion],
    answers: [buildAnswer({
      questionId: 'cannotSay',
      fieldPaths: ['cannotSay'],
      answerType: 'hybrid',
      selectedOptionIds: undefined,
      customText: '不能说脏话'
    })],
    currentStage: 'taboos'
  });
  const resultB = processAnswers(inputB);
  check('10.6 hybrid 无 options + answerType=hybrid → 无错误', resultB.errors.length === 0);
  check('10.7 freeText 非空', resultB.freeText.length > 0);
}

// ===== 运行所有测试 =====
function main(): void {
  console.log('=== AnswerProcessor 单元测试（M2） ===');
  testSelectedValuesIgnored();
  testInvalidOptionId();
  testQuantityLimits();
  testTypeMismatch();
  testHybridMerge();
  testArrayReselect();
  testStringReselect();
  testNonExistentQuestion();
  testPureFreeText();
  testHybridNoOptionsTextOnly();

  console.log(`\n=== 结果：${pass} 通过，${fail} 失败 ===`);
  if (fail > 0) {
    console.error('失败项：', failures);
    process.exit(1);
  }
}

main();
