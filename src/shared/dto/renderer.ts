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
