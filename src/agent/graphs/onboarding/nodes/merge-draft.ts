/**
 * 节点：merge_draft
 * 将 extractionResult 合并到草稿，应用合并规则。
 *
 * 合并规则（计划第 5 节）：
 * - 模型只能更新白名单字段（已在 AnswerExtractor 中校验）
 * - 数组去重并保持顺序
 * - 已有值只有在明确 correction 时才能覆盖
 * - 非明确冲突转 ambiguity
 * - revision + 1（乐观锁由 IPC 层校验，本节点只递增）
 * - 重复提交由 IPC 层的幂等检查处理（基于 revision）
 *
 * 输入：
 * - state.draft：当前草稿
 * - state.extractionResult：提取结果
 *
 * 输出：
 * - 更新后的 draft（revision+1）
 * - 清除 extractionResult（避免重复消费）
 */
import type { OnboardingStateType, OnboardingStateUpdate } from '../state';
import type { AnswerExtraction, CharacterRequirementDraft, DraftFieldName } from '../../../../services/character-onboarding/schemas';
import { createLogger } from '../../../../infrastructure/logging/logger';

const log = createLogger('OnboardingGraph:merge_draft');

/** 数组去重并保持顺序 */
function mergeStringArrays(existing: string[], incoming: string[]): string[] {
  const merged = [...existing];
  for (const item of incoming) {
    if (!merged.includes(item)) {
      merged.push(item);
    }
  }
  return merged;
}

/** 合并 extraction 到 draft */
function applyExtractionToDraft(
  draft: CharacterRequirementDraft,
  extraction: AnswerExtraction
): CharacterRequirementDraft {
  const newFields: typeof draft.fields = { ...draft.fields };
  let newAmbiguities = [...draft.ambiguities];
  let newCorrections = [...draft.corrections];

  // 1. 应用 explicitCorrections（明确覆盖旧值）
  for (const correction of extraction.explicitCorrections) {
    // 记录 correction 历史
    newCorrections.push({
      field: correction.field,
      oldValue: correction.oldValue,
      newValue: correction.newValue,
      reason: correction.reason
    });
    // 类型守卫：correction.newValue 是 string，但字段可能是 string[] 数组类型
    // 对数组字段，correction 仅记录审计历史，实际值由后续 update 替换
    const currentValue = newFields[correction.field];
    if (Array.isArray(currentValue)) {
      log.info('array field correction recorded for audit, replacement via update', {
        fields: { field: correction.field, traceId: undefined }
      });
      continue;
    }
    // 覆盖字段值（correction.newValue 是 string，字段也是 string 类型）
    newFields[correction.field] = correction.newValue as typeof newFields[DraftFieldName];
    // 清除该字段的歧义（已被明确 correction 解决）
    newAmbiguities = newAmbiguities.filter((a) => a.field !== correction.field);
  }

  // 2. 应用 updates（新值或补充值）
  for (const update of extraction.updates) {
    const existing = newFields[update.field];

    if (existing === null || existing === undefined) {
      // 字段未填，直接设置
      newFields[update.field] = update.value as typeof newFields[DraftFieldName];
    } else if (Array.isArray(existing) && Array.isArray(update.value)) {
      // 检查是否有该字段的 correction（表示用户重新选择，应替换而非合并）
      const hasCorrection = extraction.explicitCorrections.some(
        (c) => c.field === update.field
      );
      if (hasCorrection) {
        // 用户重新选择：替换整个数组
        newFields[update.field] = update.value as typeof newFields[DraftFieldName];
      } else {
        // 补充：数组去重并保持顺序
        newFields[update.field] = mergeStringArrays(existing, update.value) as typeof newFields[DraftFieldName];
      }
    } else if (existing === update.value) {
      // 完全相同，跳过
      continue;
    } else {
      // 非明确冲突：已有值与新值不同但未通过 correction 提出
      // 转为 ambiguity（除非已被 correction 处理）
      const alreadyCorrected = extraction.explicitCorrections.some(
        (c) => c.field === update.field
      );
      if (!alreadyCorrected) {
        // 检查是否已有该字段的歧义
        const existingAmbiguity = newAmbiguities.find((a) => a.field === update.field);
        if (!existingAmbiguity) {
          newAmbiguities.push({
            field: update.field,
            reason: `已有值与用户回答不一致：已有="${String(existing)}"，新="${String(update.value)}"`,
            candidates: [String(existing), String(update.value)]
          });
        }
      }
    }
  }

  // 3. 应用新增 ambiguities（来自模型识别的歧义）
  for (const ambiguity of extraction.ambiguities) {
    // 避免重复添加
    const exists = newAmbiguities.some((a) => a.field === ambiguity.field);
    if (!exists) {
      newAmbiguities.push(ambiguity);
    }
  }

  // 4. 数组长度限制（防御性）
  if (newAmbiguities.length > 24) {
    newAmbiguities = newAmbiguities.slice(-24);
  }
  if (newCorrections.length > 24) {
    newCorrections = newCorrections.slice(-24);
  }

  // 5. revision + 1
  const newRevision = draft.revision + 1;

  return {
    ...draft,
    fields: newFields,
    ambiguities: newAmbiguities,
    corrections: newCorrections,
    revision: newRevision,
    updatedAt: new Date().toISOString()
  };
}

export async function mergeDraft(
  state: OnboardingStateType
): Promise<OnboardingStateUpdate> {
  log.info('merging draft', { fields: { traceId: state.traceId } });

  if (!state.draft) {
    log.error('no draft present', { fields: { traceId: state.traceId } });
    return {
      currentStep: 'finish',
      phase: 'error',
      errorReason: 'no-draft',
      errors: [...state.errors, 'No draft present in merge_draft']
    };
  }

  if (!state.extractionResult) {
    log.error('no extractionResult present', { fields: { traceId: state.traceId } });
    return {
      currentStep: 'finish',
      phase: 'error',
      errorReason: 'no-extraction-result',
      errors: [...state.errors, 'No extractionResult present in merge_draft']
    };
  }

  const mergedDraft = applyExtractionToDraft(state.draft, state.extractionResult);

  log.info('draft merged', {
    fields: {
      revision: mergedDraft.revision,
      corrections: mergedDraft.corrections.length,
      ambiguities: mergedDraft.ambiguities.length,
      traceId: state.traceId
    }
  });

  return {
    currentStep: 'validate_coverage',
    draft: mergedDraft,
    extractionResult: null, // 清除，避免重复消费
    phase: 'collecting'
  };
}
