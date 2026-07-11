/**
 * 节点：collect_user_preferences
 * 收集用户偏好。首次启动时需要用户输入，后续使用默认值或已保存值。
 *
 * 此节点会设置 awaitingUserInput=true 中断 Graph，等待用户输入后恢复。
 */
import type { OnboardingStateType, OnboardingStateUpdate, UserPreferences } from '../state';
import { getDefaultPreferences } from '../state';
import { settingsRepository } from '../../../../infrastructure/database/repositories/settings-repository';
import { createLogger } from '../../../../infrastructure/logging/logger';

const log = createLogger('OnboardingGraph:collect_user_preferences');

/**
 * 从已保存的设置中恢复偏好（用于中断恢复）。
 */
function loadSavedPreferences(): UserPreferences | null {
  const nickname = settingsRepository.get('user_nickname');
  if (!nickname) return null;
  return {
    nickname,
    preferredName: settingsRepository.get('user_preferred_name') || nickname,
    replyLength: (settingsRepository.get('reply_length') as UserPreferences['replyLength']) || 'short',
    proactiveLevel: (settingsRepository.get('proactive_level') as UserPreferences['proactiveLevel']) || 'medium',
    dndStart: settingsRepository.get('dnd_start') || '22:00',
    dndEnd: settingsRepository.get('dnd_end') || '08:00',
    dndEnabled: settingsRepository.get('dnd_enabled') !== 'false',
    systemNotificationEnabled: settingsRepository.get('system_notification_enabled') === 'true',
    soundEnabled: settingsRepository.get('sound_enabled') === 'true',
    weatherCity: settingsRepository.get('weather_city') || '',
    weatherEnabled: settingsRepository.get('weather_enabled') === 'true',
    memoryEnabled: settingsRepository.get('memory_enabled') !== 'false'
  };
}

export async function collectUserPreferences(
  state: OnboardingStateType
): Promise<OnboardingStateUpdate> {
  log.info('collecting user preferences');

  // 如果已有偏好（恢复或注入），直接进入下一步
  if (state.preferences) {
    log.info('preferences already present, skipping collection');
    return { currentStep: 'build_persona_config' };
  }

  // 尝试从已保存设置恢复
  const saved = loadSavedPreferences();
  if (saved && saved.nickname) {
    log.info('restored saved preferences', { fields: { nickname: saved.nickname } });
    return {
      currentStep: 'build_persona_config',
      preferences: saved
    };
  }

  // 首次启动，需要用户输入
  log.info('first launch, awaiting user input for preferences');
  return {
    currentStep: 'collect_user_preferences',
    awaitingUserInput: true,
    pendingQuestion: '请输入你的昵称和称呼偏好，以便角色更好地称呼你。',
    preferences: getDefaultPreferences(),
    checkpointReason: 'awaiting_user_preferences'
  };
}

/**
 * 注入用户提供的偏好后恢复 Graph。
 */
export function applyUserPreferences(
  state: OnboardingStateType,
  preferences: Partial<UserPreferences>
): OnboardingStateUpdate {
  const merged: UserPreferences = {
    ...(state.preferences ?? getDefaultPreferences()),
    ...preferences
  };
  return {
    preferences: merged,
    awaitingUserInput: false,
    pendingQuestion: '',
    checkpointReason: '',
    currentStep: 'build_persona_config'
  };
}
