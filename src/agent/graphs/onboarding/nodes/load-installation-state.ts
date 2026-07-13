/**
 * 节点：load_installation_state
 * 检查是否首次启动、是否已有 onboarding 记录、是否已有合法锁定角色。
 *
 * V8 重构后启动完成条件（必须全部满足）：
 * - onboarding_completed === 'true'
 * - userId 非空
 * - characterId 非空
 * - 对应角色记录已锁定（is_locked=1）
 * - persona 和 personality profile 校验通过
 *
 * 任一条件不满足 → 进入向导流程（validate_character_pack → load_checkpoint → ...）
 */
import type { OnboardingStateType, OnboardingStateUpdate } from '../state';
import { settingsRepository } from '../../../../infrastructure/database/repositories/settings-repository';
import { characterProfileRepository } from '../../../../infrastructure/database/repositories/character-profile-repository';
import { createLogger } from '../../../../infrastructure/logging/logger';

const log = createLogger('OnboardingGraph:load_installation_state');

export async function loadInstallationState(
  state: OnboardingStateType
): Promise<OnboardingStateUpdate> {
  log.info('checking installation state', { fields: { traceId: state.traceId } });

  // 检查是否已完成 onboarding
  const completedFlag = settingsRepository.get('onboarding_completed');
  const userId = settingsRepository.get('user_id');
  const characterId = settingsRepository.get('active_character_id');

  const isCompletedFlag = completedFlag === 'true';
  const hasIds = !!userId && !!characterId;

  // V8 启动完成条件：必须验证有合法锁定角色
  if (isCompletedFlag && hasIds) {
    const lockedProfile = characterProfileRepository.getActiveLockedProfile();
    if (lockedProfile) {
      log.info('onboarding already completed with valid locked profile', {
        fields: {
          userId,
          characterId: lockedProfile.persona.characterId,
          configVersion: lockedProfile.configVersion,
          traceId: state.traceId
        }
      });
      return {
        currentStep: 'finish',
        isFirstLaunch: false,
        isCompleted: true,
        userId,
        characterId: lockedProfile.persona.characterId,
        persona: lockedProfile.persona,
        compiledProfile: lockedProfile,
        phase: 'locked'
      };
    }

    // 旧用户：已完成旧 onboarding 但没有锁定配置
    // → 需要进入兼容流程（由 graph-dispatcher 或 integration 处理）
    // 这里先标记为 not completed，让向导流程启动
    log.warn('onboarding marked completed but no valid locked profile, falling back to wizard', {
      fields: { userId, characterId, traceId: state.traceId }
    });
  }

  // 首次启动或未完成
  log.info('first launch or incomplete onboarding', {
    fields: {
      completedFlag,
      hasUserId: !!userId,
      hasCharacterId: !!characterId,
      traceId: state.traceId
    }
  });

  return {
    currentStep: 'validate_character_pack',
    isFirstLaunch: true,
    isCompleted: false,
    userId: userId || '',
    characterId: characterId || ''
  };
}
