/**
 * 节点：validate_coverage
 * 合并后重新校验草稿完整性，决定下一步路径。
 *
 * 路由策略：
 * - 所有阶段完整 → build_summary
 * - 还有缺项或歧义 → generate_questions（继续采集）
 */
import type { OnboardingStateType, OnboardingStateUpdate } from '../state';
import { validateCoverage } from '../../../../services/character-onboarding/CoverageValidator';
import { ONBOARDING_STAGE } from '../../../../services/character-onboarding/schemas';
import { createLogger } from '../../../../infrastructure/logging/logger';

const log = createLogger('OnboardingGraph:validate_coverage');

export async function validateCoverageNode(
  state: OnboardingStateType
): Promise<OnboardingStateUpdate> {
  log.info('validating coverage', { fields: { traceId: state.traceId } });

  if (!state.draft) {
    log.error('no draft present', { fields: { traceId: state.traceId } });
    return {
      currentStep: 'finish',
      phase: 'error',
      errorReason: 'no-draft',
      errors: [...state.errors, 'No draft present in validate_coverage']
    };
  }

  const coverage = validateCoverage(state.draft);
  log.info('coverage result', {
    fields: {
      stage: coverage.currentStage,
      progress: coverage.completionProgress,
      missing: coverage.missingFields.length,
      ambiguous: coverage.ambiguousFields.length,
      traceId: state.traceId
    }
  });

  if (coverage.currentStage === ONBOARDING_STAGE.REVIEW) {
    // 所有阶段完整 → 构建摘要进入 review
    return {
      currentStep: 'build_summary',
      currentStage: ONBOARDING_STAGE.REVIEW,
      completionProgress: coverage.completionProgress
    };
  }

  // 还有缺项或歧义 → 继续提问
  return {
    currentStep: 'generate_questions',
    currentStage: coverage.currentStage,
    completionProgress: coverage.completionProgress
  };
}
