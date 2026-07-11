/**
 * 节点：build_persona_config
 * 构建最终 Persona 配置。
 *
 * 安全规则：
 * - 用户自定义 Prompt 不能覆盖系统安全层
 * - 安全规则、权限规则、工具定义、数据隔离规则不可被用户覆盖
 * - 用户只能修改：角色身份补充、性格、说话风格、对用户称呼、回复长度、主动程度、禁止话题、示例对话
 */
import type { OnboardingStateType, OnboardingStateUpdate } from '../state';
import type { PersonaConfig } from '../../../../shared/contracts/graph-state';
import { createLogger } from '../../../../infrastructure/logging/logger';

const log = createLogger('OnboardingGraph:build_persona_config');

/** 用户可修改的字段 */
export interface UserPersonaCustomizations {
  speakingStyle?: string[];
  commonTone?: string[];
  userPetName?: string;
  forbiddenDrift?: string[];
  sampleDialogues?: Array<{ user: string; expected: string }>;
}

/** 不可被用户覆盖的安全字段 */
const LOCKED_FIELDS = new Set([
  'characterId',
  'corePrompt' // 核心安全设定来自角色包，用户不可修改
]);

/**
 * 将用户自定义合并到 Persona 中，但安全字段不可被覆盖。
 */
export function mergePersonaWithUserCustomizations(
  base: PersonaConfig,
  customizations: UserPersonaCustomizations
): PersonaConfig {
  const merged: PersonaConfig = { ...base };

  // 只允许用户修改白名单字段
  if (customizations.speakingStyle) {
    merged.speakingStyle = customizations.speakingStyle;
  }
  if (customizations.commonTone) {
    merged.commonTone = customizations.commonTone;
  }
  if (customizations.userPetName) {
    merged.userPetName = customizations.userPetName;
  }
  if (customizations.forbiddenDrift) {
    // 追加用户禁止话题，不覆盖角色包的 forbiddenDrift
    merged.forbiddenDrift = [...base.forbiddenDrift, ...customizations.forbiddenDrift];
  }
  if (customizations.sampleDialogues) {
    merged.sampleDialogues = customizations.sampleDialogues;
  }

  return merged;
}

export async function buildPersonaConfig(
  state: OnboardingStateType
): Promise<OnboardingStateUpdate> {
  log.info('building persona config');

  if (!state.persona) {
    log.error('persona not loaded');
    return {
      currentStep: 'finish',
      isCompleted: false,
      errors: [...state.errors, 'Persona not loaded before build_persona_config']
    };
  }

  // 从用户偏好中提取自定义项
  const customizations: UserPersonaCustomizations = {};
  if (state.preferences) {
    if (state.preferences.preferredName) {
      customizations.userPetName = state.preferences.preferredName;
    }
    // 根据回复长度调整说话风格
    if (state.preferences.replyLength === 'long') {
      customizations.speakingStyle = [
        ...(state.persona.speakingStyle ?? []),
        '可以适当详细回复，但仍保持结构清晰。'
      ];
    } else if (state.preferences.replyLength === 'short') {
      customizations.speakingStyle = [
        ...(state.persona.speakingStyle ?? []),
        '回复尽量简短，通常不超过 50 个字。'
      ];
    }
  }

  // 安全字段不可被用户覆盖
  const finalPersona = mergePersonaWithUserCustomizations(state.persona, customizations);

  log.info('persona config built', {
    fields: {
      characterId: finalPersona.characterId,
      hasUserPetName: !!finalPersona.userPetName,
      securityRulesLocked: state.securityRulesLocked
    }
  });

  return {
    currentStep: 'configure_proactive_policy',
    persona: finalPersona
  };
}

/** 检查是否有字段被非法覆盖（用于测试） */
export function detectLockedFieldOverride(
  base: PersonaConfig,
  merged: PersonaConfig
): string[] {
  const violations: string[] = [];
  for (const field of LOCKED_FIELDS) {
    if (base[field as keyof PersonaConfig] !== merged[field as keyof PersonaConfig]) {
      violations.push(field);
    }
  }
  return violations;
}
