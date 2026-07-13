/**
 * 节点：determine_stage
 * 根据 userAction 和 CoverageValidator 结果决定下一步路径。
 *
 * 路由策略：
 * - userAction='start'：首次进入，按草稿状态决定 generate_questions 或 build_summary
 * - userAction='answer'：刚提交答案，已被 extract/merge/validate 处理；按结果决定下一步
 * - userAction='feedback'：由 load_checkpoint 直接路由到 extract_answer，不进入本节点
 *   （P1: 但 feedback + targetStage 会进入本节点，直接路由到 generate_questions）
 * - userAction='confirm'：用户确认摘要，进入 compile_profile
 *
 * 本节点不执行实际工作，只更新 currentStep 和 phase。
 */
import type { OnboardingStateType, OnboardingStateUpdate } from '../state';
import { validateCoverage } from '../../../../services/character-onboarding/CoverageValidator';
import { ONBOARDING_STAGE } from '../../../../services/character-onboarding/schemas';
import { createLogger } from '../../../../infrastructure/logging/logger';

const log = createLogger('OnboardingGraph:determine_stage');

export async function determineStage(
  state: OnboardingStateType
): Promise<OnboardingStateUpdate> {
  log.info('determining stage', {
    fields: {
      userAction: state.userAction,
      currentStage: state.currentStage,
      phase: state.phase,
      targetStage: state.targetStage,
      traceId: state.traceId
    }
  });

  // ===== 路径 1: 用户确认摘要 → 进入 compile_profile =====
  if (state.userAction === 'confirm') {
    if (!state.summary) {
      log.error('confirm action but no summary present', { fields: { traceId: state.traceId } });
      return {
        currentStep: 'finish',
        phase: 'error',
        errorReason: 'no-summary-to-confirm',
        errors: [...state.errors, 'Cannot confirm: no summary present']
      };
    }
    return {
      currentStep: 'compile_profile',
      phase: 'busy'
    };
  }

  // ===== 路径 2: feedback + targetStage → 直接路由到 generate_questions =====
  // P1: 局部修改结构化接入。不调用模型，确定性地为目标阶段生成问题卡片。
  if (state.userAction === 'feedback' && state.targetStage !== null) {
    log.info('targetStage set, routing directly to generate_questions', {
      fields: { targetStage: state.targetStage, traceId: state.traceId }
    });
    return {
      currentStep: 'generate_questions',
      currentStage: state.targetStage,
      phase: 'collecting'
    };
  }

  // ===== 路径 3: start 或 answer → 根据 CoverageValidator 决定下一步 =====
  if (!state.draft) {
    log.error('no draft present for determine_stage', { fields: { traceId: state.traceId } });
    return {
      currentStep: 'finish',
      phase: 'error',
      errorReason: 'no-draft',
      errors: [...state.errors, 'No draft present in determine_stage']
    };
  }

  const coverage = validateCoverage(state.draft);
  log.info('coverage validated', {
    fields: {
      stage: coverage.currentStage,
      progress: coverage.completionProgress,
      missing: coverage.missingFields.length,
      ambiguous: coverage.ambiguousFields.length,
      nextGroup: coverage.nextQuestionGroup.length,
      traceId: state.traceId
    }
  });

  // 所有阶段完整 → 进入 review
  if (coverage.currentStage === ONBOARDING_STAGE.REVIEW) {
    return {
      currentStep: 'build_summary',
      currentStage: ONBOARDING_STAGE.REVIEW,
      completionProgress: coverage.completionProgress
    };
  }

  // 还有缺项或歧义 → 进入 generate_questions
  return {
    currentStep: 'generate_questions',
    currentStage: coverage.currentStage,
    completionProgress: coverage.completionProgress
  };
}
