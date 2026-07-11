/**
 * 节点：configure_proactive_policy
 * 根据用户偏好构建主动策略。
 */
import type { OnboardingStateType, OnboardingStateUpdate, ProactivePolicyConfig } from '../state';
import { getDefaultProactivePolicy } from '../state';
import { createLogger } from '../../../../infrastructure/logging/logger';

const log = createLogger('OnboardingGraph:configure_proactive_policy');

/** 根据主动程度计算每日上限 */
function maxDailyFromLevel(level: 'low' | 'medium' | 'high'): number {
  switch (level) {
    case 'low': return 2;
    case 'high': return 8;
    default: return 5;
  }
}

export async function configureProactivePolicy(
  state: OnboardingStateType
): Promise<OnboardingStateUpdate> {
  log.info('configuring proactive policy');

  const policy: ProactivePolicyConfig = { ...getDefaultProactivePolicy() };

  if (state.preferences) {
    policy.dndEnabled = state.preferences.dndEnabled;
    policy.dndStart = state.preferences.dndStart;
    policy.dndEnd = state.preferences.dndEnd;
    policy.systemNotificationEnabled = state.preferences.systemNotificationEnabled;
    policy.soundEnabled = state.preferences.soundEnabled;
    policy.maxDailyProactive = maxDailyFromLevel(state.preferences.proactiveLevel);
  }

  log.info('proactive policy configured', {
    fields: {
      dndEnabled: policy.dndEnabled,
      maxDaily: policy.maxDailyProactive
    }
  });

  return {
    currentStep: 'configure_model_mode',
    proactivePolicy: policy
  };
}
