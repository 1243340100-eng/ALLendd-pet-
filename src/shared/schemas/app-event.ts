/**
 * AppEvent 的 Zod 校验 schema。
 * 主进程接收任何外部事件时，先经此校验，非法事件不会让进程崩溃。
 */
import { z } from 'zod';
import {
  APP_EVENT_TYPE,
  EVENT_SOURCE,
  EVENT_PRIORITY,
  APP_EVENT_SCHEMA_VERSION
} from '../constants';

export const appEventTypeSchema = z.enum([
  APP_EVENT_TYPE.CHAT,
  APP_EVENT_TYPE.STARTUP,
  APP_EVENT_TYPE.REMINDER_DUE,
  APP_EVENT_TYPE.DATE_CHANGED,
  APP_EVENT_TYPE.RESUME_FROM_SLEEP,
  APP_EVENT_TYPE.NETWORK_RESTORED,
  APP_EVENT_TYPE.DAILY_GREETING_DUE,
  APP_EVENT_TYPE.WEATHER_UPDATED,
  APP_EVENT_TYPE.SKILL_COMPLETED,
  APP_EVENT_TYPE.PERMISSION_RESOLVED,
  APP_EVENT_TYPE.RENDERER_FAILED,
  APP_EVENT_TYPE.MODEL_FAILED
]);

export const eventSourceSchema = z.enum([
  EVENT_SOURCE.RENDERER,
  EVENT_SOURCE.SCHEDULER,
  EVENT_SOURCE.SYSTEM,
  EVENT_SOURCE.GRAPH,
  EVENT_SOURCE.SERVICE
]);

export const eventPrioritySchema = z.enum([
  EVENT_PRIORITY.LOW,
  EVENT_PRIORITY.NORMAL,
  EVENT_PRIORITY.HIGH
]);

/** 基础 AppEvent schema，payload 由具体事件类型扩展 */
export const appEventSchema = z.object({
  schemaVersion: z.literal(APP_EVENT_SCHEMA_VERSION),
  eventId: z.string().min(1),
  type: appEventTypeSchema,
  occurredAt: z.string().min(1),
  timezone: z.string().min(1),
  source: eventSourceSchema,
  userId: z.string().min(1),
  characterId: z.string().min(1),
  sessionId: z.string().optional(),
  correlationId: z.string().min(1),
  causationId: z.string().optional(),
  dedupeKey: z.string().optional(),
  priority: eventPrioritySchema,
  payload: z.unknown()
});

/** 校验 AppEvent，返回安全的事件或 null */
export function validateAppEvent(input: unknown) {
  const result = appEventSchema.safeParse(input);
  if (result.success) {
    return { valid: true as const, event: result.data };
  }
  return {
    valid: false as const,
    issues: result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message
    }))
  };
}
