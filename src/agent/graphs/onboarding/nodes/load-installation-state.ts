/**
 * 节点：load_installation_state
 * 检查是否首次启动、是否已有 onboarding 记录。
 */
import type { OnboardingStateType, OnboardingStateUpdate } from '../state';
import { settingsRepository } from '../../../../infrastructure/database/repositories/settings-repository';
import { createLogger } from '../../../../infrastructure/logging/logger';

const log = createLogger('OnboardingGraph:load_installation_state');

export async function loadInstallationState(
  state: OnboardingStateType
): Promise<OnboardingStateUpdate> {
  log.info('checking installation state');

  // 检查是否已完成 onboarding
  const completedFlag = settingsRepository.get('onboarding_completed');
  const userId = settingsRepository.get('user_id');
  const characterId = settingsRepository.get('active_character_id');

  const isCompleted = completedFlag === 'true' && !!userId && !!characterId;

  if (isCompleted) {
    log.info('onboarding already completed', {
      fields: { userId, characterId }
    });
    return {
      currentStep: 'finish',
      isFirstLaunch: false,
      isCompleted: true,
      userId,
      characterId
    };
  }

  log.info('first launch or incomplete onboarding');
  return {
    currentStep: 'validate_character_pack',
    isFirstLaunch: true,
    isCompleted: false
  };
}
