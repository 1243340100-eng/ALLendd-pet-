/**
 * 节点：review
 * 用户确认或返回修改的路由节点。
 *
 * 本节点本身不做实际工作，只是 phase='review' 状态的占位节点，
 * 由 graph 条件边根据 userAction 路由到下一步：
 * - userAction='confirm' → compile_profile
 * - userAction='feedback' → generate_questions（重新提问）
 *
 * 当本节点被执行时，意味着 build_summary 已完成，等待用户操作。
 */
import type { OnboardingStateType, OnboardingStateUpdate } from '../state';
import { createLogger } from '../../../../infrastructure/logging/logger';

const log = createLogger('OnboardingGraph:review');

export async function review(
  state: OnboardingStateType
): Promise<OnboardingStateUpdate> {
  log.info('review node reached', {
    fields: {
      userAction: state.userAction,
      hasSummary: !!state.summary,
      traceId: state.traceId
    }
  });

  // 此节点主要作为占位，实际路由由 graph 条件边处理
  // 但我们可以做一些防御性检查
  if (!state.summary) {
    log.error('review node but no summary present', { fields: { traceId: state.traceId } });
    return {
      currentStep: 'finish',
      phase: 'error',
      errorReason: 'no-summary-in-review',
      errors: [...state.errors, 'No summary present in review']
    };
  }

  // 保持当前状态，由条件边决定下一步
  return {
    currentStep: 'review',
    phase: 'review'
  };
}
