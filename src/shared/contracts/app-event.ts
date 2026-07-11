/**
 * AppEvent：统一事件协议。
 * 所有入口先转换成此结构，再由 GraphDispatcher 决定进入哪个 Graph。
 * 对应架构计划第 4 节。
 */
import type {
  AppEventType,
  EventSource,
  EventPriority
} from '../constants';

export interface AppEvent<TPayload = unknown> {
  /** 协议版本，当前固定为 1 */
  schemaVersion: 1;
  /** 事件唯一 ID，UUID v4 */
  eventId: string;
  /** 事件类型 */
  type: AppEventType;
  /** 发生时间，ISO 8601 UTC */
  occurredAt: string;
  /** 用户时区，IANA 名称，如 Asia/Shanghai */
  timezone: string;
  /** 事件来源 */
  source: EventSource;
  /** 用户 ID */
  userId: string;
  /** 角色 ID */
  characterId: string;
  /** 会话 ID，可选 */
  sessionId?: string;
  /** 关联 ID，用于追踪同一逻辑流 */
  correlationId: string;
  /** 因果 ID，指向触发本事件的上游事件，可选 */
  causationId?: string;
  /** 去重键，可重放事件必须携带 */
  dedupeKey?: string;
  /** 优先级 */
  priority: EventPriority;
  /** 事件负载 */
  payload: TPayload;
}

/** chat 事件负载 */
export interface ChatPayload {
  message: string;
  history?: ReadonlyArray<ChatHistoryItem>;
}

export interface ChatHistoryItem {
  role: 'user' | 'assistant';
  content: string;
  /** 是否排除在 AI 上下文之外 */
  excludeFromAi?: boolean;
}

/** reminder_due 事件负载 */
export interface ReminderDuePayload {
  reminderId: string;
  reminderOccurrenceId: string;
  content: string;
  priority: EventPriority;
}

/** daily_greeting_due 事件负载 */
export interface DailyGreetingPayload {
  greetingType: 'morning' | 'startup_digest';
}

/** skill_completed 事件负载 */
export interface SkillCompletedPayload {
  skillId: string;
  success: boolean;
  result?: unknown;
  error?: string;
}

/** permission_resolved 事件负载 */
export interface PermissionResolvedPayload {
  requestId: string;
  granted: boolean;
  /** 恢复的 checkpoint ID */
  checkpointId?: string;
}

/** weather_updated 事件负载 */
export interface WeatherUpdatedPayload {
  city: string;
  temperatureC: number;
  description: string;
  updatedAt: string;
}

/** startup 事件负载 */
export interface StartupPayload {
  isFirstLaunch: boolean;
}

/** 便捷类型：chat 事件 */
export type ChatEvent = AppEvent<ChatPayload>;
/** 便捷类型：提醒到期事件 */
export type ReminderDueEvent = AppEvent<ReminderDuePayload>;
