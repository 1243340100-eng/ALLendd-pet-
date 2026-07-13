/**
 * 节点：validate_character_pack
 * 加载并校验角色包。失败时回退到上一个可用版本。
 *
 * V8 重构：成功后进入 load_checkpoint（而非旧的 collect_user_preferences）。
 * 同时保存 baseManifest 和 basePersona 到 state，供后续节点使用。
 */
import type { OnboardingStateType, OnboardingStateUpdate } from '../state';
import type { CharacterPackManager } from '../../../../services/CharacterPackManager';
import { createLogger } from '../../../../infrastructure/logging/logger';

const log = createLogger('OnboardingGraph:validate_character_pack');

export function createValidateCharacterPackNode(packManager: CharacterPackManager) {
  return async function validateCharacterPack(
    state: OnboardingStateType
  ): Promise<OnboardingStateUpdate> {
    log.info('validating character pack', {
      fields: { path: state.packPath, traceId: state.traceId }
    });

    try {
      const pack = packManager.load(state.packPath);
      log.info('character pack valid', {
        fields: { id: pack.manifest.id, version: pack.manifest.version, traceId: state.traceId }
      });

      return {
        currentStep: 'load_checkpoint',
        characterId: pack.manifest.id,
        persona: pack.persona,
        baseManifest: pack.manifest,
        basePersona: pack.persona,
        errors: [...state.errors]
      };
    } catch (error) {
      const msg = (error as Error)?.message ?? String(error);
      log.error('character pack validation failed', {
        fields: { error: msg, traceId: state.traceId }
      });
      return {
        currentStep: 'finish',
        isCompleted: false,
        phase: 'error',
        errorReason: 'character-pack-validation-failed',
        errors: [...state.errors, `Character pack validation failed: ${msg}`]
      };
    }
  };
}
