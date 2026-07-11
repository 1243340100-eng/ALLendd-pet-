/**
 * Graph 输出 DTO。Graph 执行完毕后产出的结构化结果。
 */
import type { ErrorCode } from '../constants';

/** Graph 执行结果 */
export interface GraphResult<TOutput = unknown> {
  /** 是否成功完成 */
  success: boolean;
  /** 输出 DTO */
  output?: TOutput;
  /** 收集的错误（已降级） */
  errors: Array<{
    code: ErrorCode;
    message: string;
    recovered: boolean;
  }>;
  /** 本轮模型调用次数 */
  modelCallCount: number;
  /** 耗时毫秒 */
  durationMs: number;
  /** 是否需要进入 Reflection 队列 */
  enqueueReflection?: boolean;
  /** Reflection 负载，若需要 */
  reflectionPayload?: unknown;
}

/** 提醒创建 Graph 输出 */
export interface ReminderGraphOutput {
  success: boolean;
  reminderId?: string;
  nextTriggerAt?: string;
  message: string;
  missingFields?: string[];
}

/** 对话 Graph 输出 */
export interface ConversationGraphOutput {
  reply: string;
  emotion: string | null;
  emotionSource: string | null;
  motion: string | null;
  postCheckRewritten: boolean;
  postCheckActions: string[];
}

/** 主动事件 Graph 输出 */
export interface ProactiveGraphOutput {
  channel: 'pet_bubble' | 'system_notification' | 'deferred' | 'suppressed';
  message: string;
  expression?: string;
  sound?: boolean;
}
