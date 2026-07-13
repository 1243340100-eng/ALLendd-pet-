/**
 * 节点：compile_profile
 * 调用 ProfileCompiler 确定性编译角色配置。
 *
 * 输入：
 * - state.summary：结构化摘要
 * - state.baseManifest：基础角色包 manifest
 * - state.basePersona：基础角色包 persona（仅用于复用视觉资源）
 *
 * 输出：
 * - state.compiledProfile：编译后的角色配置
 *
 * 不调用模型（纯程序逻辑）。
 */
import type { OnboardingStateType, OnboardingStateUpdate } from '../state';
import { compileProfile, CURRENT_CONFIG_VERSION } from '../../../../services/character-onboarding/ProfileCompiler';
import { createLogger } from '../../../../infrastructure/logging/logger';

const log = createLogger('OnboardingGraph:compile_profile');

export async function compileProfileNode(
  state: OnboardingStateType
): Promise<OnboardingStateUpdate> {
  log.info('compiling profile', { fields: { traceId: state.traceId } });

  if (!state.summary) {
    log.error('no summary present', { fields: { traceId: state.traceId } });
    return {
      currentStep: 'finish',
      phase: 'error',
      errorReason: 'no-summary',
      errors: [...state.errors, 'No summary present in compile_profile']
    };
  }

  if (!state.baseManifest) {
    log.error('no baseManifest present', { fields: { traceId: state.traceId } });
    return {
      currentStep: 'finish',
      phase: 'error',
      errorReason: 'no-base-manifest',
      errors: [...state.errors, 'No baseManifest present in compile_profile']
    };
  }

  if (!state.basePersona) {
    log.error('no basePersona present', { fields: { traceId: state.traceId } });
    return {
      currentStep: 'finish',
      phase: 'error',
      errorReason: 'no-base-persona',
      errors: [...state.errors, 'No basePersona present in compile_profile']
    };
  }

  const result = compileProfile({
    summary: state.summary,
    baseManifest: state.baseManifest,
    basePersona: state.basePersona,
    configVersion: CURRENT_CONFIG_VERSION
  });

  if (!result.ok || !result.profile) {
    log.error('profile compile failed', {
      fields: { reason: result.reason, traceId: state.traceId }
    });
    return {
      currentStep: 'review',
      phase: 'error',
      errorReason: result.reason ?? 'compile-failed',
      errors: [...state.errors, `Profile compile failed: ${result.reason ?? 'unknown'}`]
    };
  }

  log.info('profile compiled', {
    fields: {
      characterId: result.profile.persona.characterId,
      characterName: result.profile.persona.characterName,
      configVersion: result.profile.configVersion,
      traceId: state.traceId
    }
  });

  return {
    currentStep: 'configure_proactive_policy',
    compiledProfile: result.profile,
    phase: 'busy'
  };
}
