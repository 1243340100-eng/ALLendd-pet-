/**
 * 节点：validate_character_pack
 * 加载并校验角色包。失败时回退到上一个可用版本。
 */
import type { OnboardingStateType, OnboardingStateUpdate } from '../state';
import { CharacterPackManager } from '../../../../services/CharacterPackManager';
import { createLogger } from '../../../../infrastructure/logging/logger';

const log = createLogger('OnboardingGraph:validate_character_pack');

export function createValidateCharacterPackNode(packManager: CharacterPackManager) {
  return async function validateCharacterPack(
    state: OnboardingStateType
  ): Promise<OnboardingStateUpdate> {
    log.info('validating character pack', { fields: { path: state.packPath } });

    try {
      const pack = packManager.load(state.packPath);
      log.info('character pack valid', {
        fields: { id: pack.manifest.id, version: pack.manifest.version }
      });

      return {
        currentStep: 'collect_user_preferences',
        characterId: pack.manifest.id,
        persona: pack.persona,
        errors: [...state.errors]
      };
    } catch (error) {
      const msg = (error as Error)?.message ?? String(error);
      log.error('character pack validation failed', { fields: { error: msg } });
      return {
        currentStep: 'finish',
        isCompleted: false,
        errors: [...state.errors, `Character pack validation failed: ${msg}`]
      };
    }
  };
}
