/**
 * QuestionGenerator - 将 nextQuestionGroup 转成结构化问题卡片。
 *
 * V9 重构：输出 OnboardingQuestion[]（结构化卡片），不再输出纯文本问题。
 *
 * 严格约束：
 * - 只将 CoverageValidator 输出的 nextQuestionGroup 转成问题卡片
 * - 字段类型与默认选项由 FIELD_QUESTION_META 确定（保证选项值合法）
 * - 模型只能润色问题文本，不能增加字段、改变类型或宣布完成
 * - 不得生成摘要或配置
 * - 生成失败时使用程序内置问题模板
 *
 * 每次建议显示 2～4 张问题卡片。
 */
import {
  ONBOARDING_STAGE,
  LENGTH_LIMITS,
  FIELD_QUESTION_META,
  type DraftFieldName,
  type OnboardingStage,
  type OnboardingQuestion
} from './schemas';
import type { CoverageValidationResult } from './CoverageValidator';
import type { ModelGateway } from '../ModelGateway';
import { MODEL_ALIAS, MODEL_MODE } from '../../shared/constants';
import { createLogger } from '../../infrastructure/logging/logger';

const log = createLogger('QuestionGenerator');

/** 每批问题卡片数量上限 */
const MAX_QUESTIONS_PER_BATCH = 4;

/**
 * @deprecated V9 改用 OnboardingQuestion。仅为向后兼容保留。
 */
export interface GeneratedQuestion {
  field: DraftFieldName;
  text: string;
}

/** QuestionGenerator 输出 */
export interface QuestionGeneratorOutput {
  ok: boolean;
  /** V9：结构化问题卡片 */
  questions: OnboardingQuestion[];
  /** 当前阶段 */
  stage: OnboardingStage;
  /** 失败原因（ok=false 时） */
  reason?: string;
  /** 是否使用了模型生成（false 表示回退到固定模板） */
  usedModel?: boolean;
}

/** 阶段 → 引导语（开头） */
const STAGE_INTRO: Record<OnboardingStage, string> = {
  [ONBOARDING_STAGE.BASIC]: '【基础信息】',
  [ONBOARDING_STAGE.SPEAKING]: '【说话风格】',
  [ONBOARDING_STAGE.RELATIONSHIP]: '【关系边界】',
  [ONBOARDING_STAGE.TABOOS]: '【角色禁区】',
  [ONBOARDING_STAGE.REVIEW]: '【确认阶段】'
};

/**
 * 为单个字段构建确定性问题卡片（基于 FIELD_QUESTION_META）。
 */
function buildQuestionForField(
  field: DraftFieldName,
  stage: OnboardingStage
): OnboardingQuestion {
  const meta = FIELD_QUESTION_META[field];
  const intro = STAGE_INTRO[stage];
  const questionText = `${intro} ${meta.question}`.slice(0, LENGTH_LIMITS.questionTextMax);

  const q: OnboardingQuestion = {
    id: field,
    fieldPaths: [field],
    type: meta.type,
    question: questionText,
    allowOther: meta.allowOther ?? false,
    required: meta.required
  };

  if (meta.description) {
    q.description = meta.description;
  }
  if (meta.otherPlaceholder) {
    q.otherPlaceholder = meta.otherPlaceholder;
  } else if (meta.placeholder) {
    q.otherPlaceholder = meta.placeholder;
  }
  if (meta.options && meta.options.length > 0) {
    q.options = meta.options;
  }
  // 多选题默认最多 4 项
  if (meta.type === 'multiple_choice') {
    q.maxSelect = 4;
  }

  return q;
}

/**
 * 使用固定模板生成问题卡片（确定性回退）。
 */
export function generateQuestions(
  coverage: CoverageValidationResult
): QuestionGeneratorOutput {
  if (coverage.currentStage === ONBOARDING_STAGE.REVIEW) {
    return { ok: true, questions: [], stage: ONBOARDING_STAGE.REVIEW, usedModel: false };
  }

  if (coverage.nextQuestionGroup.length === 0) {
    return { ok: false, questions: [], stage: coverage.currentStage, reason: 'no-fields-to-ask', usedModel: false };
  }

  const stage = coverage.currentStage;
  const fields = coverage.nextQuestionGroup.slice(0, MAX_QUESTIONS_PER_BATCH);
  const questions: OnboardingQuestion[] = fields.map((f) => buildQuestionForField(f, stage));

  if (questions.length === 0) {
    return { ok: false, questions: [], stage, reason: 'no-template-matched', usedModel: false };
  }

  return { ok: true, questions, stage, usedModel: false };
}

/**
 * V9：使用 ModelGateway 润色问题文本。
 *
 * 流程：
 * 1. 先用 FIELD_QUESTION_META 构建确定性卡片（保证类型与选项值合法）
 * 2. 调用模型为每个字段生成更自然的问题文本
 * 3. 程序化校验：模型返回的 field 必须在 nextQuestionGroup 中，文本长度合法
 * 4. 用模型文本替换确定性文本（仅文本，类型与选项保持确定性）
 * 5. 模型失败时全部回退到确定性模板
 *
 * 模型约束：
 * - 不得增加 nextQuestionGroup 之外的字段
 * - 不得宣布完成或跳过字段
 * - 不得改变阶段
 *
 * @param options.maxQuestions 覆盖默认的 MAX_QUESTIONS_PER_BATCH 上限。
 *   targetStage 局部修改路径需要为该阶段全部字段生成卡片，不受 4 张上限约束。
 */
export async function generateQuestionsWithModel(
  coverage: CoverageValidationResult,
  gateway: ModelGateway,
  traceId?: string,
  options?: { maxQuestions?: number }
): Promise<QuestionGeneratorOutput> {
  if (coverage.currentStage === ONBOARDING_STAGE.REVIEW) {
    return { ok: true, questions: [], stage: ONBOARDING_STAGE.REVIEW, usedModel: false };
  }

  if (coverage.nextQuestionGroup.length === 0) {
    return { ok: false, questions: [], stage: coverage.currentStage, reason: 'no-fields-to-ask', usedModel: false };
  }

  const stage = coverage.currentStage;
  const maxQuestions = options?.maxQuestions ?? MAX_QUESTIONS_PER_BATCH;
  const fieldsToAsk = coverage.nextQuestionGroup.slice(0, maxQuestions);
  const intro = STAGE_INTRO[stage];

  // 1. 构建确定性卡片（基础）
  const baseQuestions = fieldsToAsk.map((f) => buildQuestionForField(f, stage));

  // 2. 构建系统提示词，让模型仅润色问题文本
  const systemPrompt = [
    '你是角色配置采集助手。任务：为指定字段生成自然、口语化的提问文本，用于引导用户配置 AI 桌宠角色。',
    '',
    `当前采集阶段：${stage}`,
    `需要提问的字段（只能为这些字段生成问题，不得增加或减少）：${fieldsToAsk.join(', ')}`,
    '',
    '严格规则：',
    '1. 只能为上述给定字段生成问题文本，不得增加任何其他字段。',
    '2. 不得宣布完成、不得跳过字段、不得改变阶段。',
    '3. 每个问题应该自然、口语化、易于理解，避免机械的表单式提问。',
    '4. 每个问题文本长度 5-120 字符。',
    '5. 不要生成选项，只生成问题文本。',
    '',
    '输出严格的 JSON 格式：',
    '{',
    '  "questions": [{ "field": "<字段名>", "text": "<问题文本>" }]',
    '}',
    '',
    '不要输出任何额外字段或说明文字。'
  ].join('\n');

  const userMessage = [
    `请为以下字段各生成一个自然问题：${fieldsToAsk.join(', ')}`,
    `阶段引导语前缀：${intro}`
  ].join('\n');

  try {
    const result = await gateway.invoke({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ],
      mode: MODEL_MODE.BALANCED,
      alias: MODEL_ALIAS.BALANCED,
      responseFormat: 'json',
      temperature: 0.6,
      maxOutputTokens: 1000,
      traceId
    });

    if (!result.success || !result.content) {
      log.warn('question generation model call failed, using deterministic cards', {
        fields: { errorCode: result.errorCode, traceId }
      });
      return { ok: true, questions: baseQuestions, stage, usedModel: false };
    }

    let parsed: { questions?: Array<{ field?: unknown; text?: unknown }> };
    try {
      parsed = JSON.parse(result.content);
    } catch {
      log.warn('question generation model returned invalid JSON, using deterministic cards', {
        fields: { traceId }
      });
      return { ok: true, questions: baseQuestions, stage, usedModel: false };
    }

    if (!parsed.questions || !Array.isArray(parsed.questions)) {
      log.warn('question generation model returned no questions array, using deterministic cards', {
        fields: { traceId }
      });
      return { ok: true, questions: baseQuestions, stage, usedModel: false };
    }

    // 程序化校验：field 必须在 fieldsToAsk 中，text 必须是非空字符串
    const allowedFields = new Set<string>(fieldsToAsk);
    const modelTextByField = new Map<DraftFieldName, string>();
    const seenFields = new Set<string>();

    for (const item of parsed.questions) {
      const field = item.field;
      const text = item.text;
      if (typeof field !== 'string' || typeof text !== 'string') continue;
      if (!allowedFields.has(field)) {
        log.warn('model returned disallowed field, skipping', { fields: { field, traceId } });
        continue;
      }
      if (seenFields.has(field)) continue;
      const trimmedText = text.trim();
      if (trimmedText.length < 5 || trimmedText.length > 120) continue;
      seenFields.add(field);
      modelTextByField.set(field as DraftFieldName, trimmedText);
    }

    // 3. 用模型文本替换确定性文本（仅 question 字段），类型与选项保持确定性
    const questions: OnboardingQuestion[] = baseQuestions.map((q) => {
      const field = q.fieldPaths[0];
      const modelText = modelTextByField.get(field);
      if (modelText) {
        const text = `${intro} ${modelText}`.slice(0, LENGTH_LIMITS.questionTextMax);
        return { ...q, question: text };
      }
      return q;
    });

    const usedModel = modelTextByField.size > 0;
    log.info('question cards generated', {
      fields: {
        count: questions.length,
        modelCount: modelTextByField.size,
        stage,
        traceId
      }
    });

    return { ok: true, questions, stage, usedModel };
  } catch (error) {
    log.warn('question generation threw, using deterministic cards', {
      fields: { error: (error as Error)?.message, traceId }
    });
    return { ok: true, questions: baseQuestions, stage, usedModel: false };
  }
}

/**
 * 将问题卡片合并为一条展示文本（用于 pendingQuestion 兼容字段与日志）。
 */
export function formatQuestionsAsText(questions: OnboardingQuestion[]): string {
  if (questions.length === 0) return '';
  if (questions.length === 1) return questions[0].question;
  return questions.map((q, i) => `${i + 1}. ${q.question}`).join('\n');
}
