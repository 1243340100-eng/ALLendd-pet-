/**
 * OnboardingGraph 状态定义（V8 重构版）。
 *
 * 重构要点：
 * - 扩展现有 OnboardingGraph，不新建第二套向导
 * - 实现 checkpoint 恢复：SQLite checkpoint 是权威来源
 * - 每轮 IPC 只执行一轮 Graph，不在内存中长期等待用户输入
 * - 合并规则：白名单字段、数组去重、revision 乐观锁、幂等
 *
 * 流程：
 * load_installation_state → validate_character_pack → load_checkpoint
 * → determine_stage → (generate_questions | extract_answer → merge_draft → validate_coverage → build_summary)
 * → review → compile_profile → persist_and_lock → activate_character
 * → configure_proactive_policy → configure_model_mode → save_onboarding_result → finish
 */
import { Annotation } from '@langchain/langgraph';
import type { PersonaConfig } from '../../../shared/contracts/graph-state';
import type { ModelMode } from '../../../shared/constants';
import type { CharacterManifest } from '../../../services/CharacterPackManager';
import type {
  CharacterRequirementDraft,
  CharacterRequirementSummary,
  CompiledCharacterProfile,
  OnboardingStage,
  OnboardingQuestion,
  OnboardingQuestionAnswer,
  PendingAnswersData
} from '../../../services/character-onboarding/schemas';
import type { AnswerExtraction } from '../../../services/character-onboarding/schemas';

/** Onboarding 阶段（保留原有步骤用于后置流程） */
export type OnboardingStep =
  | 'load_installation_state'
  | 'validate_character_pack'
  | 'load_checkpoint'
  | 'determine_stage'
  | 'generate_questions'
  | 'extract_answer'
  | 'merge_draft'
  | 'validate_coverage'
  | 'build_summary'
  | 'review'
  | 'compile_profile'
  | 'persist_and_lock'
  | 'configure_proactive_policy'
  | 'configure_model_mode'
  | 'save_onboarding_result'
  | 'activate_character'
  | 'finish'
  // 旧流程步骤（保留用于向后兼容，V8 流程不再使用）
  | 'collect_user_preferences'
  | 'build_persona_config';

/** 用户收集的偏好（保留原有，用于后置默认设置） */
export interface UserPreferences {
  nickname: string;
  preferredName: string;
  replyLength: 'short' | 'medium' | 'long';
  proactiveLevel: 'low' | 'medium' | 'high';
  dndStart: string;
  dndEnd: string;
  dndEnabled: boolean;
  systemNotificationEnabled: boolean;
  soundEnabled: boolean;
  weatherCity: string;
  weatherEnabled: boolean;
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

/** Onboarding phase（高层状态，供 UI 判断） */
export type OnboardingPhase = 'collecting' | 'review' | 'busy' | 'locked' | 'error';

/** Onboarding 状态 */
export const OnboardingState = Annotation.Root({
  // ===== 基础字段（原有） =====
  currentStep: Annotation<OnboardingStep>,
  isFirstLaunch: Annotation<boolean>,
  isCompleted: Annotation<boolean>,
  userId: Annotation<string>,
  characterId: Annotation<string>,
  packPath: Annotation<string>,
  persona: Annotation<PersonaConfig | null>,
  preferences: Annotation<UserPreferences | null>,
  proactivePolicy: Annotation<ProactivePolicyConfig | null>,
  modelMode: Annotation<ModelMode>,
  sessionId: Annotation<string>,
  checkpointReason: Annotation<string>,
  errors: Annotation<string[]>,
  awaitingUserInput: Annotation<boolean>,
  pendingQuestion: Annotation<string>,
  securityRulesLocked: Annotation<boolean>,

  // ===== V8 新增：character-onboarding 流程字段 =====
  /** 当前采集阶段 */
  currentStage: Annotation<OnboardingStage>,
  /** 高层 phase（供 UI 判断） */
  phase: Annotation<OnboardingPhase>,
  /** 采集草稿（权威来源：checkpoint） */
  draft: Annotation<CharacterRequirementDraft | null>,
  /** 结构化摘要（review 阶段） */
  summary: Annotation<CharacterRequirementSummary | null>,
  /** 编译后的角色 Profile */
  compiledProfile: Annotation<CompiledCharacterProfile | null>,
  /** 当前轮待问问题（V9：结构化问题卡片） */
  currentQuestions: Annotation<OnboardingQuestion[]>,
  /** 历史问题（供 AnswerExtractor 上下文） */
  previousQuestions: Annotation<string[]>,
  /** 用户最近一次输入（answer 或 feedback；V9 兼容旧文本路径） */
  lastUserInput: Annotation<string>,
  /** V9：用户提交的结构化问题卡片回答（新路径） */
  questionAnswers: Annotation<OnboardingQuestionAnswer[]>,
  /** 用户操作类型：start / answer / feedback / confirm */
  userAction: Annotation<'start' | 'answer' | 'feedback' | 'confirm'>,
  /** 局部修改目标阶段（review 阶段点击"修改"按钮时设置，确定性地路由到该阶段的 generate_questions） */
  targetStage: Annotation<OnboardingStage | null>,
  /** P2: 未提交的卡片选择（仅由 getOnboardingState 从 checkpoint 恢复，Graph 不使用） */
  pendingAnswers: Annotation<PendingAnswersData | null>,
  /** Onboarding checkpoint 线程 ID（scope_key 用） */
  onboardingThreadId: Annotation<string>,
  /** 基础角色包 manifest */
  baseManifest: Annotation<CharacterManifest | null>,
  /** 基础角色包 persona（仅用于复用视觉资源，不继承身份） */
  basePersona: Annotation<PersonaConfig | null>,
  /** 完成进度（0-1，由 CoverageValidator 计算） */
  completionProgress: Annotation<number>,
  /** 错误原因（phase=error 时） */
  errorReason: Annotation<string>,
  /** 追踪 ID */
  traceId: Annotation<string>,
  /** V8 临时字段：AnswerExtractor 输出，由 merge_draft 消费后清除 */
  extractionResult: Annotation<AnswerExtraction | null>,
  /** W2: 客户端期望的草稿 revision（乐观锁校验用，-1 表示不校验） */
  expectedRevision: Annotation<number>
});

export type OnboardingStateType = typeof OnboardingState.State;
export type OnboardingStateUpdate = Partial<OnboardingStateType>;

/** 默认用户偏好（新用户使用默认值，不再需要用户输入） */
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

/**
 * 创建初始 Onboarding 状态。
 * 调用方在 IPC 入口调用，传入 basePackPath 和 onboardingThreadId。
 */
export function createInitialOnboardingState(
  packPath: string,
  onboardingThreadId: string = 'default-onboarding',
  traceId: string = ''
): OnboardingStateType {
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
    securityRulesLocked: true,

    currentStage: 'basic' as OnboardingStage,
    phase: 'collecting',
    draft: null,
    summary: null,
    compiledProfile: null,
    currentQuestions: [],
    previousQuestions: [],
    lastUserInput: '',
    questionAnswers: [],
    userAction: 'start',
    targetStage: null,
    pendingAnswers: null,
    onboardingThreadId,
    baseManifest: null,
    basePersona: null,
    completionProgress: 0,
    errorReason: '',
    traceId,
    extractionResult: null,
    expectedRevision: -1
  };
}
