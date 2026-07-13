/**
 * CoverageValidator - 完整性校验器。
 *
 * 完整性必须由代码判断（不调用模型），输出：
 * - missingFields：当前及之前阶段尚未回答的字段
 * - ambiguousFields：仍有歧义未澄清的字段
 * - currentStage：当前应进入的阶段
 * - completionProgress：0-1 完成进度
 * - nextQuestionGroup：下一轮应询问的字段集合（2-3 个）
 *
 * 阶段顺序：basic → speaking → relationship → taboos → review
 * 每轮只选择 2～3 个字段；先解决当前阶段歧义，再处理缺项。
 */
import {
  DRAFT_FIELD_NAMES,
  FIELD_TO_STAGE,
  ONBOARDING_STAGE,
  STAGE_ORDER,
  getFieldsForStage,
  type CharacterRequirementDraft,
  type DraftFieldName,
  type OnboardingStage
} from './schemas';

/** 字段是否被视为"已回答"（非 null） */
function isFieldAnswered(draft: CharacterRequirementDraft, field: DraftFieldName): boolean {
  const v = draft.fields[field];
  if (v === null || v === undefined) return false;
  if (typeof v === 'string') return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

/**
 * W8: 判断字段是否适用于当前草稿（条件必填逻辑）。
 * - keepTraits / excludeTraits 只有在用户提供了 referenceCharacter 时才适用
 * - 其他字段始终适用
 */
function isFieldApplicable(draft: CharacterRequirementDraft, field: DraftFieldName): boolean {
  if (field === 'keepTraits' || field === 'excludeTraits') {
    const ref = draft.fields.referenceCharacter;
    // referenceCharacter 为空或明确表示"无"时，keepTraits/excludeTraits 不适用
    if (ref === null || ref === undefined) return false;
    if (typeof ref === 'string') {
      const trimmed = ref.trim().toLowerCase();
      if (trimmed === '' || trimmed === '无' || trimmed === '没有' || trimmed === 'none' || trimmed === 'no') {
        return false;
      }
    }
    return true;
  }
  return true;
}

/** 字段是否仍有歧义 */
function isFieldAmbiguous(draft: CharacterRequirementDraft, field: DraftFieldName): boolean {
  return draft.ambiguities.some((a) => a.field === field);
}

/** 该阶段是否已完整（无缺项、无歧义） */
function isStageComplete(draft: CharacterRequirementDraft, stage: OnboardingStage): boolean {
  const fields = getFieldsForStage(stage);
  for (const f of fields) {
    // W8: 不适用的字段视为已完成
    if (!isFieldApplicable(draft, f)) continue;
    if (isFieldAmbiguous(draft, f)) return false;
    if (!isFieldAnswered(draft, f)) return false;
  }
  return true;
}

export interface CoverageValidationResult {
  /** 当前阶段所有未回答字段（含之前阶段遗漏） */
  missingFields: DraftFieldName[];
  /** 当前仍有歧义的字段 */
  ambiguousFields: DraftFieldName[];
  /** 当前应进入的阶段 */
  currentStage: OnboardingStage;
  /** 0-1 完成进度 */
  completionProgress: number;
  /** 下一轮应询问的字段集合（2-3 个；空数组表示已完成可进入 review） */
  nextQuestionGroup: DraftFieldName[];
}

/**
 * 校验草稿完整性，决定下一步行动。
 *
 * 策略：
 * 1. 从最早阶段向后扫描，找到第一个未完整阶段
 * 2. 优先返回该阶段的歧义字段（先解决歧义）
 * 3. 再返回该阶段的缺项字段
 * 4. 每轮最多 3 个字段
 * 5. 全部阶段完整 → 进入 review，nextQuestionGroup 为空
 */
export function validateCoverage(draft: CharacterRequirementDraft): CoverageValidationResult {
  // 计算总体进度
  const allFields = DRAFT_FIELD_NAMES as readonly DraftFieldName[];
  let applicableCount = 0;
  let answeredCount = 0;
  for (const f of allFields) {
    // W8: 不适用字段不计入进度（既不计入分母也不计入分子）
    if (!isFieldApplicable(draft, f)) continue;
    applicableCount++;
    if (isFieldAnswered(draft, f) && !isFieldAmbiguous(draft, f)) answeredCount++;
  }
  const completionProgress = applicableCount === 0 ? 1 : answeredCount / applicableCount;

  // 找到第一个未完整阶段
  let currentStage: OnboardingStage = ONBOARDING_STAGE.REVIEW;
  for (const stage of STAGE_ORDER) {
    if (stage === ONBOARDING_STAGE.REVIEW) continue;
    if (!isStageComplete(draft, stage)) {
      currentStage = stage;
      break;
    }
  }

  if (currentStage === ONBOARDING_STAGE.REVIEW) {
    return {
      missingFields: [],
      ambiguousFields: [],
      currentStage: ONBOARDING_STAGE.REVIEW,
      completionProgress: 1,
      nextQuestionGroup: []
    };
  }

  const stageFields = getFieldsForStage(currentStage);
  const ambiguousFields: DraftFieldName[] = [];
  const missingFields: DraftFieldName[] = [];

  for (const f of stageFields) {
    // W8: 不适用字段不计入缺项或歧义
    if (!isFieldApplicable(draft, f)) continue;
    if (isFieldAmbiguous(draft, f)) {
      ambiguousFields.push(f);
    } else if (!isFieldAnswered(draft, f)) {
      missingFields.push(f);
    }
  }

  // 先解决歧义，再处理缺项；每轮最多 3 个字段
  const nextQuestionGroup: DraftFieldName[] = [];
  for (const f of ambiguousFields) {
    if (nextQuestionGroup.length >= 3) break;
    nextQuestionGroup.push(f);
  }
  for (const f of missingFields) {
    if (nextQuestionGroup.length >= 3) break;
    nextQuestionGroup.push(f);
  }

  // 如果当前阶段已无问题但仍有遗漏（理论不会发生，防御性处理）
  return {
    missingFields,
    ambiguousFields,
    currentStage,
    completionProgress,
    nextQuestionGroup
  };
}

/**
 * 判断草稿是否已达到 review 阶段（所有阶段完整且无歧义）。
 */
export function isReadyForReview(draft: CharacterRequirementDraft): boolean {
  return validateCoverage(draft).currentStage === ONBOARDING_STAGE.REVIEW;
}

/**
 * 推进草稿阶段。若当前阶段未完整，不推进。
 */
export function advanceStage(draft: CharacterRequirementDraft): OnboardingStage {
  const result = validateCoverage(draft);
  return result.currentStage;
}
