/**
 * OnboardingGraph 状态定义。
 * 对应架构计划第 5.1 节。
 *
 * 使用 LangGraph.js Annotation 定义状态。
 * 状态在节点间传递，支持 checkpoint 中断恢复。
 */
import { Annotation } from '@langchain/langgraph';
import type { PersonaConfig } from '../../../shared/contracts/graph-state';
import type { ModelMode } from '../../../shared/constants';

/** Onboarding 阶段 */
export type OnboardingStep =
  | 'load_installation_state'
  | 'validate_character_pack'
  | 'collect_user_preferences'
  | 'build_persona_config'
  | 'configure_proactive_policy'
  | 'configure_model_mode'
  | 'save_onboarding_result'
  | 'activate_character'
  | 'finish';

/** 用户收集的偏好 */
export interface UserPreferences {
  /** 用户昵称 */
  nickname: string;
  /** 对用户的称呼 */
  preferredName: string;
  /** 回复长度偏好 */
  replyLength: 'short' | 'medium' | 'long';
  /** 主动程度 */
  proactiveLevel: 'low' | 'medium' | 'high';
  /** 勿扰开始时间 HH:mm */
  dndStart: string;
  /** 勿扰结束时间 HH:mm */
  dndEnd: string;
  /** 是否启用勿扰 */
  dndEnabled: boolean;
  /** 是否允许系统通知 */
  systemNotificationEnabled: boolean;
  /** 是否播放通知声音 */
  soundEnabled: boolean;
  /** 天气城市 */
  weatherCity: string;
  /** 是否允许联网查询天气 */
  weatherEnabled: boolean;
  /** 是否启用记忆 */
  memoryEnabled: boolean;
}

/** 主动策略配置 */
export interface ProactivePolicyConfig {
  dndEnabled: boolean;
  dndStart: string;
  dndEnd: string;
  maxDailyProactive: number;
  ignoreThreshold: number;
  systemNotificationEnabled: boolean;
  soundEnabled: boolean;
}

/** Onboarding 状态 */
export const OnboardingState = Annotation.Root({
  /** 当前步骤 */
  currentStep: Annotation<OnboardingStep>,
  /** 是否首次启动 */
  isFirstLaunch: Annotation<boolean>,
  /** 是否已完成 onboarding */
  isCompleted: Annotation<boolean>,
  /** 用户 ID（完成后生成） */
  userId: Annotation<string>,
  /** 角色 ID */
  characterId: Annotation<string>,
  /** 角色包路径 */
  packPath: Annotation<string>,
  /** Persona 配置（角色包原始 + 用户自定义） */
  persona: Annotation<PersonaConfig | null>,
  /** 用户偏好 */
  preferences: Annotation<UserPreferences | null>,
  /** 主动策略 */
  proactivePolicy: Annotation<ProactivePolicyConfig | null>,
  /** 模型模式 */
  modelMode: Annotation<ModelMode>,
  /** 默认会话 ID */
  sessionId: Annotation<string>,
  /** checkpoint 原因（中断时保存） */
  checkpointReason: Annotation<string>,
  /** 收集的错误 */
  errors: Annotation<string[]>,
  /** 是否需要用户输入（中断点） */
  awaitingUserInput: Annotation<boolean>,
  /** 待问用户的问题 */
  pendingQuestion: Annotation<string>,
  /** 安全层不可被用户覆盖 */
  securityRulesLocked: Annotation<boolean>
});

export type OnboardingStateType = typeof OnboardingState.State;
export type OnboardingStateUpdate = Partial<OnboardingStateType>;

/** 默认用户偏好 */
export function getDefaultPreferences(): UserPreferences {
  return {
    nickname: '',
    preferredName: '',
    replyLength: 'short',
    proactiveLevel: 'medium',
    dndStart: '22:00',
    dndEnd: '08:00',
    dndEnabled: true,
    systemNotificationEnabled: false,
    soundEnabled: false,
    weatherCity: '',
    weatherEnabled: false,
    memoryEnabled: true
  };
}

/** 默认主动策略 */
export function getDefaultProactivePolicy(): ProactivePolicyConfig {
  return {
    dndEnabled: true,
    dndStart: '22:00',
    dndEnd: '08:00',
    maxDailyProactive: 5,
    ignoreThreshold: 2,
    systemNotificationEnabled: false,
    soundEnabled: false
  };
}

/** 初始状态 */
export function createInitialOnboardingState(packPath: string): OnboardingStateType {
  return {
    currentStep: 'load_installation_state',
    isFirstLaunch: true,
    isCompleted: false,
    userId: '',
    characterId: '',
    packPath,
    persona: null,
    preferences: null,
    proactivePolicy: null,
    modelMode: 'balanced',
    sessionId: '',
    checkpointReason: '',
    errors: [],
    awaitingUserInput: false,
    pendingQuestion: '',
    securityRulesLocked: true
  };
}
