/**
 * SuggestionGenerator - 为文本题生成可编辑的 AI 建议答案。
 *
 * 触发场景：用户在文本题输入框为空时点击"AI帮我建议"。
 *
 * 严格约束：
 * - 只能根据当前问题、已确认草稿、用户已有偏好生成一条简短建议
 * - 不能直接保存答案、修改 Draft、宣布问题完成
 * - 不能补充未知的关系和禁区
 * - 不能生成整份角色设定
 * - 建议必须可编辑，标记为"AI建议"，用户提交后才正式确认
 *
 * 通过 ModelGateway 调用 balancedModel，不得直接 fetch。
 */
import type { ModelGateway } from '../ModelGateway';
import { MODEL_ALIAS, MODEL_MODE } from '../../shared/constants';
import {
  DRAFT_FIELD_NAMES,
  FIELD_TO_STAGE,
  type CharacterRequirementDraft,
  type OnboardingQuestion,
  type OnboardingStage
} from './schemas';
import { createLogger } from '../../infrastructure/logging/logger';

const log = createLogger('SuggestionGenerator');

/** SuggestionGenerator 输入 */
export interface SuggestionInput {
  question: OnboardingQuestion;
  currentDraft: CharacterRequirementDraft;
  currentStage: OnboardingStage;
  traceId?: string;
}

/** SuggestionGenerator 输出 */
export interface SuggestionOutput {
  ok: boolean;
  /** 建议答案文本（ok=true 时非空） */
  suggestion: string | null;
  /** 失败原因（ok=false 时） */
  reason?: string;
}

/** 构建系统提示词 */
function buildSystemPrompt(): string {
  return [
    '你是角色配置采集助手。任务：为当前问题生成一条简短、可编辑的建议答案。',
    '',
    '严格规则：',
    '1. 只能根据已确认的角色信息生成建议，不要凭空编造未知的关系、边界或禁区。',
    '2. 建议必须简短（不超过 80 字符），易于用户快速确认或修改。',
    '3. 只生成建议文本本身，不要生成解释、选项或额外说明。',
    '4. 不要重复用户已经确认的内容。',
    '5. 不能直接保存答案，建议需用户提交后才生效。',
    '',
    '输出严格的 JSON 格式：',
    '{ "suggestion": "<建议答案文本>" }',
    '',
    '不要输出任何额外字段或说明文字。'
  ].join('\n');
}

/** 构建用户消息（含上下文） */
function buildUserMessage(input: SuggestionInput): string {
  const { question, currentDraft, currentStage } = input;
  const field = question.fieldPaths[0];

  // 收集已确认的相关字段值
  const stageFields = DRAFT_FIELD_NAMES.filter((f) => FIELD_TO_STAGE[f] === currentStage);
  const confirmedValues: Record<string, unknown> = {};
  for (const f of stageFields) {
    const v = currentDraft.fields[f];
    if (v !== null && v !== undefined) confirmedValues[f] = v;
  }

  return [
    '【当前问题】',
    question.question,
    '',
    `【关联字段】${field}`,
    `【当前阶段】${currentStage}`,
    `【已确认信息】${JSON.stringify(confirmedValues)}`,
    '',
    '请生成一条简短建议答案。'
  ].join('\n');
}

/**
 * 生成 AI 建议答案。
 * 模型失败时返回 ok=false，调用方应保留输入框为空并允许重试。
 */
export async function generateSuggestion(
  gateway: ModelGateway,
  input: SuggestionInput
): Promise<SuggestionOutput> {
  const { question, traceId } = input;

  // 仅文本题支持建议
  if (question.type !== 'text' && question.type !== 'hybrid') {
    return { ok: false, suggestion: null, reason: 'suggestion-only-for-text' };
  }

  try {
    const result = await gateway.invoke({
      messages: [
        { role: 'system', content: buildSystemPrompt() },
        { role: 'user', content: buildUserMessage(input) }
      ],
      mode: MODEL_MODE.BALANCED,
      alias: MODEL_ALIAS.BALANCED,
      responseFormat: 'json',
      temperature: 0.7,
      maxOutputTokens: 300,
      traceId
    });

    if (!result.success || !result.content) {
      log.warn('suggestion model call failed', {
        fields: { errorCode: result.errorCode, traceId }
      });
      return { ok: false, suggestion: null, reason: result.errorCode ?? 'model-call-failed' };
    }

    let parsed: { suggestion?: unknown };
    try {
      parsed = JSON.parse(result.content);
    } catch {
      log.warn('suggestion json parse failed', {
        fields: { traceId, content: result.content.slice(0, 200) }
      });
      return { ok: false, suggestion: null, reason: 'json-parse-failed' };
    }

    const suggestion = typeof parsed.suggestion === 'string' ? parsed.suggestion.trim() : '';
    if (!suggestion) {
      return { ok: false, suggestion: null, reason: 'empty-suggestion' };
    }

    // 程序化 80 字校验：提示词要求不超过 80 字符，模型偶尔会超长
    // 超长时截断到 80 字符并记录警告（不直接拒绝，避免用户重试成本）
    const SUGGESTION_MAX_LENGTH = 80;
    let trimmed = suggestion;
    if (trimmed.length > SUGGESTION_MAX_LENGTH) {
      log.warn('suggestion exceeds 80 chars, truncating', {
        fields: { originalLength: trimmed.length, traceId }
      });
      trimmed = trimmed.slice(0, SUGGESTION_MAX_LENGTH);
    }

    log.info('suggestion generated', {
      fields: { field: question.fieldPaths[0], length: trimmed.length, traceId }
    });

    return { ok: true, suggestion: trimmed };
  } catch (e) {
    log.error('suggestion generation threw', {
      fields: { traceId, error: (e as Error)?.message }
    });
    return { ok: false, suggestion: null, reason: 'suggestion-threw' };
  }
}
