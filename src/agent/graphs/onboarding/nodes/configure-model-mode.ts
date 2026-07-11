/**
 * 节点：configure_model_mode
 * 设置模型质量模式。
 */
import type { OnboardingStateType, OnboardingStateUpdate } from '../state';
import type { ModelMode } from '../../../../shared/constants';
import { settingsRepository } from '../../../../infrastructure/database/repositories/settings-repository';
import { createLogger } from '../../../../infrastructure/logging/logger';

const log = createLogger('OnboardingGraph:configure_model_mode');

export async function configureModelMode(
  state: OnboardingStateType
): Promise<OnboardingStateUpdate> {
  log.info('configuring model mode');

  // 从已保存设置恢复，否则使用默认 balanced
  const savedMode = settingsRepository.get('model_mode') as ModelMode | null;
  const mode: ModelMode = savedMode ?? state.modelMode ?? 'balanced';

  log.info('model mode set', { fields: { mode } });

  return {
    currentStep: 'save_onboarding_result',
    modelMode: mode
  };
}
