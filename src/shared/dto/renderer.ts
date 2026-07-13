/**
 * Graph → Renderer 输出 DTO。
 * Graph 与 UI 之间只能传递结构化 DTO，不传递内部状态。
 * 对应架构计划第 1 节"Graph 和 UI 之间只能传递结构化 DTO"。
 */

/** 聊天回复 DTO，发给渲染进程展示 */
export interface ChatReplyDto {
  /** 最终回复文本 */
  reply: string;
  /** 表情标签，无则 null */
  emotion: string | null;
  /** 表情来源：ai | fallback */
  emotionSource: string | null;
  /** 动作标签 */
  motion: string | null;
  /** post-check 是否改写了回复 */
  postCheckRewritten: boolean;
  /** post-check 摘要 */
  postCheck: {
    passed: boolean;
    actions: string[];
  };
  /** 模型用量摘要（不含敏感信息） */
  usage: {
    model: string;
    modelCallCount: number;
  };
}

/** 提醒创建结果 DTO */
export interface ReminderResultDto {
  success: boolean;
  reminderId?: string;
  /** 下一次触发时间 ISO */
  nextTriggerAt?: string;
  message: string;
  /** 字段缺失时需要追问的字段 */
  missingFields?: string[];
}

/** 今日计划 DTO */
export interface TodayScheduleDto {
  reminders: Array<{
    id: string;
    content: string;
    scheduledAt: string;
  }>;
  tasks: Array<{
    id: string;
    title: string;
    dueAt?: string;
    completed: boolean;
    overdue: boolean;
  }>;
}

/** 主动事件投递 DTO */
export interface ProactiveDeliveryDto {
  type: 'reminder' | 'startup_digest' | 'daily_greeting';
  /** 投递通道 */
  channel: 'pet_bubble' | 'system_notification' | 'deferred' | 'suppressed';
  /** 角色化消息文本 */
  message: string;
  /** 关联的提醒 ID */
  reminderId?: string;
  /** 表情 */
  expression?: string;
  /** 通知是否播放声音 */
  sound?: boolean;
}

/** 错误响应 DTO */
export interface ErrorDto {
  code: string;
  message: string;
  /** 是否可重试 */
  retryable: boolean;
}

// ===== V8 角色初始化向导 DTO =====

/** Onboarding 阶段（与 schemas.ts 同步，但避免 renderer 直接依赖 src/services） */
export type OnboardingPhaseDto = 'collecting' | 'review' | 'busy' | 'locked' | 'error';

/** Onboarding 采集阶段 */
export type OnboardingStageDto = 'basic' | 'speaking' | 'relationship' | 'taboos' | 'review';

/** 问题类型 */
export type QuestionTypeDto = 'text' | 'single_choice' | 'multiple_choice' | 'hybrid';

/** 问题选项 */
export interface QuestionOptionDto {
  id: string;
  label: string;
  value: string | string[];
}

/** V9：结构化问题卡片 */
export interface OnboardingQuestionDto {
  id: string;
  fieldPaths: string[];
  type: QuestionTypeDto;
  question: string;
  description?: string;
  options?: QuestionOptionDto[];
  allowOther: boolean;
  otherPlaceholder?: string;
  suggestedAnswer?: string;
  maxSelect?: number;
  required: boolean;
}

/**
 * Onboarding IPC 响应 DTO。
 *
 * 安全约束（计划第八节）：
 * - Renderer 不能提交完整 Draft / Persona / isLocked / onboardingCompleted / 配置版本
 * - Renderer 只能通过此 DTO 读取展示所需的最小信息
 * - 草稿权威来源是 SQLite checkpoint，每次 IPC 调用从 checkpoint 恢复
 */
export interface OnboardingIpcResponse {
  /** 当前高层 phase（UI 据此切换状态） */
  phase: OnboardingPhaseDto;
  /** 当前采集阶段 */
  currentStage: OnboardingStageDto;
  /** 待问问题文本（collecting/review 阶段非空；兼容字段，V9 主要用 currentQuestions） */
  pendingQuestion: string;
  /** V9：当前轮结构化问题卡片 */
  currentQuestions: OnboardingQuestionDto[];
  /** 完成进度 0-1 */
  completionProgress: number;
  /** Review 阶段的摘要展示文本（仅 review 阶段非空） */
  summaryDisplayText: string | null;
  /** 当前草稿 revision（用于乐观锁，renderer 下次提交需带此值） */
  revision: number;
  /** Onboarding 是否已完成（locked 状态） */
  isCompleted: boolean;
  /** 错误原因（phase=error 时） */
  errorReason: string;
  /** 追踪 ID */
  traceId: string;
  /** P2: 未提交的卡片选择（从 checkpoint 恢复，null 表示无或已过期） */
  pendingAnswers: PendingAnswersDto | null;
}

/** V9：AI 建议响应 DTO */
export interface OnboardingSuggestionDto {
  ok: boolean;
  suggestion: string | null;
  reason?: string;
  traceId: string;
}

/** P2: 未提交的卡片选择条目 DTO */
export interface PendingAnswerEntryDto {
  questionId: string;
  selectedOptionIds?: string[];
  customText?: string;
  usedSuggestedAnswer?: boolean;
}

/** P2: pendingAnswers 数据包 DTO（从 checkpoint 恢复，已通过 revision + fingerprint 校验） */
export interface PendingAnswersDto {
  revision: number;
  questionSetFingerprint: string;
  answers: PendingAnswerEntryDto[];
}
