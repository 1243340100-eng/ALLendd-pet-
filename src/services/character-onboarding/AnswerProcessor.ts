/**
 * AnswerProcessor - 处理 V9 结构化问题卡片回答。
 *
 * 职责：
 * - 纯选项回答 → 从 checkpoint 中的可信 question.options 重新映射 value，直接构造 extraction（不调用模型）
 * - 自由文本（customText）→ 汇总后交给 AnswerExtractor（调用模型）
 * - 混合回答 → 两者皆有，合并结果（同字段组合而非丢弃）
 *
 * 安全约束：
 * - 不信任 renderer 提交的 selectedValues，只使用 selectedOptionIds
 * - 从 checkpoint 中的 question.options 重新提取 value
 * - 校验 answerType === question.type
 * - 校验单选只能一个、多选不超过 maxSelect
 * - 拒绝不存在的 option ID
 * - 不合法回答整批拒绝
 * - 不修改阶段、版本、锁定状态、安全规则
 */
import type {
  AnswerExtraction,
  CharacterRequirementDraft,
  DraftFieldName,
  DraftFieldValue,
  OnboardingQuestion,
  OnboardingQuestionAnswer
} from './schemas';
import { DRAFT_FIELD_NAMES } from './schemas';
import { createLogger } from '../../infrastructure/logging/logger';

const log = createLogger('AnswerProcessor');

const FIELD_SET = new Set<DraftFieldName>(DRAFT_FIELD_NAMES);

/** AnswerProcessor 输入 */
export interface AnswerProcessorInput {
  currentQuestions: OnboardingQuestion[];
  answers: OnboardingQuestionAnswer[];
  currentDraft: CharacterRequirementDraft;
  currentStage: import('./schemas').OnboardingStage;
  /** 跨阶段模式（feedback/revise） */
  crossStage?: boolean;
  traceId?: string;
}

/** AnswerProcessor 输出 */
export interface AnswerProcessorOutput {
  /** 直接构造的提取结果（来自选项） */
  directExtraction: AnswerExtraction;
  /** 需要交给 AnswerExtractor 的自由文本（来自 customText）；空字符串表示无需模型 */
  freeText: string;
  /** 自由文本涉及的字段（供 AnswerExtractor 上下文） */
  freeTextFields: DraftFieldName[];
  /** 整批错误（非空时调用方应拒绝整批回答，不推进 revision） */
  errors: string[];
}

/**
 * 将结构化回答拆解为：
 * 1. 直接 updates/corrections（纯选项，从 checkpoint 可信 options 重新映射）
 * 2. 自由文本（需模型提取）
 *
 * 安全约束：
 * - 只使用 selectedOptionIds，不信任 selectedValues
 * - 从 question.options 重新提取 value
 * - 校验题型、数量、option ID 存在性
 * - 不合法回答整批拒绝
 */
export function processAnswers(input: AnswerProcessorInput): AnswerProcessorOutput {
  const { currentQuestions, answers, currentDraft, traceId } = input;
  const errors: string[] = [];

  // 建立 questionId → question 索引
  const questionById = new Map<string, OnboardingQuestion>();
  for (const q of currentQuestions) {
    questionById.set(q.id, q);
  }

  const updates: AnswerExtraction['updates'] = [];
  const explicitCorrections: AnswerExtraction['explicitCorrections'] = [];
  const ambiguities: AnswerExtraction['ambiguities'] = [];
  const freeTextParts: string[] = [];
  const freeTextFields: DraftFieldName[] = [];

  for (const answer of answers) {
    const question = questionById.get(answer.questionId);
    if (!question) {
      errors.push(`回答引用了不存在的问题: ${answer.questionId}`);
      continue;
    }

    // 校验 answerType 与 question.type 兼容
    // hybrid 类型支持纯选项/纯文本/混合三种回答形式，允许 text/single_choice/multiple_choice/hybrid
    if (answer.answerType !== question.type) {
      const isHybridCompatible = question.type === 'hybrid' &&
        ['text', 'single_choice', 'multiple_choice', 'hybrid'].includes(answer.answerType);
      if (!isHybridCompatible) {
        errors.push(`问题 "${question.question}" 的回答类型(${answer.answerType})与问题类型(${question.type})不匹配`);
        continue;
      }
    }

    const fields = question.fieldPaths.filter((f) => FIELD_SET.has(f));
    if (fields.length === 0) {
      continue;
    }

    // ===== 处理选项选择（从 checkpoint 中的可信 options 重新映射） =====
    const selectedOptionIds = answer.selectedOptionIds ?? [];
    const hasSelection = selectedOptionIds.length > 0;

    if (hasSelection) {
      const questionOptions = question.options ?? [];

      // 校验选项 ID 存在性
      const optionById = new Map(questionOptions.map(o => [o.id, o]));
      const invalidIds = selectedOptionIds.filter(id => !optionById.has(id));
      if (invalidIds.length > 0) {
        errors.push(`问题 "${question.question}" 包含不存在的选项 ID: ${invalidIds.join(', ')}`);
        continue;
      }

      // 校验单选数量
      if (question.type === 'single_choice' && selectedOptionIds.length > 1) {
        errors.push(`问题 "${question.question}" 是单选题但选择了 ${selectedOptionIds.length} 个选项`);
        continue;
      }
      // 校验多选数量
      if (question.type === 'multiple_choice' && question.maxSelect && selectedOptionIds.length > question.maxSelect) {
        errors.push(`问题 "${question.question}" 超过最大选择数 ${question.maxSelect}`);
        continue;
      }
      // hybrid 题型：如果有选项，也应校验单选数量（hybrid 的选项部分是单选）
      if (question.type === 'hybrid' && selectedOptionIds.length > 1) {
        errors.push(`问题 "${question.question}" 最多选择 1 个选项`);
        continue;
      }

      // 从可信 options 重新提取 value 和 label
      const selectedOptions = selectedOptionIds.map(id => optionById.get(id)!);
      const selectedValues: DraftFieldValue[] = selectedOptions.map(o => o.value);
      const selectedLabels = selectedOptions.map(o => o.label);

      const isMultiple = question.type === 'multiple_choice';

      if (fields.length === 1) {
        const field = fields[0];
        const value = isMultiple ? selectedValues.slice() : selectedValues[0];
        if (value === undefined) continue;

        const existing = currentDraft.fields[field];
        const evidenceQuote = selectedLabels.length > 0
          ? `用户选择：${selectedLabels.join('、')}`
          : '用户选择';

        if (existing === null || existing === undefined) {
          updates.push({ field, value: value as never, evidenceQuote });
        } else if (JSON.stringify(existing) === JSON.stringify(value)) {
          // 相同值，跳过
        } else if (Array.isArray(existing) && Array.isArray(value)) {
          // 数组字段重新选择：生成 correction（审计记录）+ update（数据替换）
          // merge_draft 会检测到 correction 并替换整个数组，而非合并
          explicitCorrections.push({
            field,
            oldValue: JSON.stringify(existing),
            newValue: JSON.stringify(value),
            reason: '用户重新选择',
            evidence: evidenceQuote
          });
          updates.push({ field, value: value as never, evidenceQuote });
        } else {
          // 字符串/枚举字段重新选择 → explicitCorrection
          explicitCorrections.push({
            field,
            oldValue: typeof existing === 'string' ? existing : JSON.stringify(existing),
            newValue: typeof value === 'string' ? value : JSON.stringify(value),
            reason: '用户重新选择',
            evidence: evidenceQuote
          });
        }
      } else {
        // 多字段问题：每个值对应一个字段（按顺序）
        for (let i = 0; i < fields.length && i < selectedValues.length; i++) {
          const field = fields[i];
          const value = selectedValues[i];
          updates.push({ field, value: value as never, evidenceQuote: `用户选择：${selectedLabels[i] ?? ''}` });
        }
      }
    }

    // ===== 处理自由文本（交给 AnswerExtractor） =====
    const customText = (answer.customText ?? '').trim();
    if (customText) {
      // 标注涉及的字段，便于 AnswerExtractor 聚焦
      const fieldHint = fields.length === 1 ? fields[0] : fields.join('/');
      freeTextParts.push(`【${fieldHint}】${customText}`);
      for (const f of fields) {
        if (!freeTextFields.includes(f)) freeTextFields.push(f);
      }
    }
  }

  // 如果有错误，整批拒绝
  if (errors.length > 0) {
    log.warn('answers rejected due to validation errors', {
      fields: { errors, traceId }
    });
    return {
      directExtraction: { updates: [], explicitCorrections: [], ambiguities: [] },
      freeText: '',
      freeTextFields: [],
      errors
    };
  }

  const directExtraction: AnswerExtraction = {
    updates,
    explicitCorrections,
    ambiguities
  };

  const freeText = freeTextParts.join('\n');

  log.info('answers processed', {
    fields: {
      directUpdates: updates.length,
      directCorrections: explicitCorrections.length,
      hasFreeText: freeText.length > 0,
      freeTextFields: freeTextFields.length,
      traceId
    }
  });

  return { directExtraction, freeText, freeTextFields, errors: [] };
}

/**
 * 合并直接提取结果与模型提取结果。
 *
 * 合并规则：
 * - 不同字段：直接合并
 * - 同一字段（选项+自由文本补充）：组合为最终值，而非丢弃模型结果
 *   - 字符串 + 字符串 → "选项值（补充说明）"
 *   - 数组 + 数组 → 合并去重
 *   - 枚举值（low/medium/high）→ 选项值优先，不组合
 */
export function mergeDirectAndModelExtraction(
  direct: AnswerExtraction,
  model: AnswerExtraction | null
): AnswerExtraction {
  if (!model) return direct;

  // 收集直接结果中的字段值和索引
  const directUpdateFields = new Map<DraftFieldName, number>();
  direct.updates.forEach((u, i) => directUpdateFields.set(u.field, i));
  const directCorrectionFields = new Map<DraftFieldName, number>();
  direct.explicitCorrections.forEach((c, i) => directCorrectionFields.set(c.field, i));

  const mergedUpdates = [...direct.updates];
  const mergedCorrections = [...direct.explicitCorrections];

  for (const u of model.updates) {
    const updateIdx = directUpdateFields.get(u.field);
    const correctionIdx = directCorrectionFields.get(u.field);

    if (updateIdx === undefined && correctionIdx === undefined) {
      // 模型提取的字段没有直接选项，直接添加
      mergedUpdates.push(u);
    } else if (updateIdx !== undefined) {
      // 同字段：选项值 + 模型补充 → 组合
      const directValue = mergedUpdates[updateIdx].value;
      const combinedValue = combineValues(directValue, u.value);
      if (combinedValue !== directValue) {
        mergedUpdates[updateIdx] = {
          ...mergedUpdates[updateIdx],
          value: combinedValue as never,
          evidenceQuote: `${mergedUpdates[updateIdx].evidenceQuote}; 补充：${u.evidenceQuote}`
        };
      }
    }
    // correction 情况：选项已产生 correction，模型补充不覆盖
  }

  // 模型的 corrections：如果字段没有直接选项，添加
  const directFields = new Set<DraftFieldName>([
    ...directUpdateFields.keys(),
    ...directCorrectionFields.keys()
  ]);
  for (const c of model.explicitCorrections) {
    if (!directFields.has(c.field)) {
      mergedCorrections.push(c);
    }
  }

  // ambiguities 合并去重
  const ambiguityFields = new Set(direct.ambiguities.map((a) => a.field));
  const mergedAmbiguities = [...direct.ambiguities];
  for (const a of model.ambiguities) {
    if (!ambiguityFields.has(a.field)) {
      mergedAmbiguities.push(a);
    }
  }

  return {
    updates: mergedUpdates,
    explicitCorrections: mergedCorrections,
    ambiguities: mergedAmbiguities
  };
}

/**
 * 组合选项值和模型提取的补充值。
 * - 枚举值（low/medium/high）→ 选项值优先，不组合
 * - 字符串 + 字符串 → "选项值（补充说明）"
 * - 数组 + 数组 → 合并去重
 * - 数组 + 字符串 → [...数组, 字符串]
 * - 其他 → 选项值优先
 */
function combineValues(directValue: DraftFieldValue, modelValue: DraftFieldValue): DraftFieldValue {
  // 枚举值不组合
  if (directValue === 'low' || directValue === 'medium' || directValue === 'high') {
    return directValue;
  }
  // 字符串 + 字符串 → "选项值（补充说明）"
  if (typeof directValue === 'string' && typeof modelValue === 'string') {
    // 如果模型值是选项值的子串或相同，不组合
    if (directValue.includes(modelValue) || modelValue.includes(directValue)) {
      return directValue;
    }
    return `${directValue}（${modelValue}）`;
  }
  // 数组合并
  if (Array.isArray(directValue) && Array.isArray(modelValue)) {
    return [...new Set([...directValue, ...modelValue])];
  }
  if (Array.isArray(directValue) && typeof modelValue === 'string') {
    if (!directValue.includes(modelValue)) {
      return [...directValue, modelValue];
    }
    return directValue;
  }
  // 其他情况，选项值优先
  return directValue;
}
