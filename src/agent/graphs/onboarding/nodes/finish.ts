/**
 * 节点：finish
 * Onboarding 完成。清理中断状态。
 */
import type { OnboardingStateType, OnboardingStateUpdate } from '../state';
import { createLogger } from '../../../../infrastructure/logging/logger';

const log = createLogger('OnboardingGraph:finish');

export async function finish(
  state: OnboardingStateType
): Promise<OnboardingStateUpdate> {
  log.info('onboarding finished', {
    fields: {
      isCompleted: state.isCompleted,
      userId: state.userId,
      characterId: state.characterId,
      errorCount: state.errors.length
    }
  });

  return {
    currentStep: 'finish',
    awaitingUserInput: false,
    pendingQuestion: '',
    checkpointReason: ''
  };
}
