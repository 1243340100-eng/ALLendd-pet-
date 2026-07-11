/**
 * 全局常量：事件类型、模型别名、错误码、权限等级。
 * 所有散落的魔法字符串集中到此，避免硬编码。
 */

/** 统一事件类型，对应 AppEvent.type */
export const APP_EVENT_TYPE = {
  CHAT: 'chat',
  STARTUP: 'startup',
  REMINDER_DUE: 'reminder_due',
  DATE_CHANGED: 'date_changed',
  RESUME_FROM_SLEEP: 'resume_from_sleep',
  NETWORK_RESTORED: 'network_restored',
  DAILY_GREETING_DUE: 'daily_greeting_due',
  WEATHER_UPDATED: 'weather_updated',
  SKILL_COMPLETED: 'skill_completed',
  PERMISSION_RESOLVED: 'permission_resolved',
  RENDERER_FAILED: 'renderer_failed',
  MODEL_FAILED: 'model_failed'
} as const;

export type AppEventType = typeof APP_EVENT_TYPE[keyof typeof APP_EVENT_TYPE];

/** 事件来源 */
export const EVENT_SOURCE = {
  RENDERER: 'renderer',
  SCHEDULER: 'scheduler',
  SYSTEM: 'system',
  GRAPH: 'graph',
  SERVICE: 'service'
} as const;

export type EventSource = typeof EVENT_SOURCE[keyof typeof EVENT_SOURCE];

/** 事件优先级 */
export const EVENT_PRIORITY = {
  LOW: 'low',
  NORMAL: 'normal',
  HIGH: 'high'
} as const;

export type EventPriority = typeof EVENT_PRIORITY[keyof typeof EVENT_PRIORITY];

/**
 * 模型别名。不要在代码中直接写死 DeepSeek 模型名称，
 * 由配置文件映射这些别名到具体模型。
 */
export const MODEL_ALIAS = {
  FAST: 'fastModel',
  BALANCED: 'balancedModel',
  REASONING: 'reasoningModel',
  PLANNING: 'planningModel'
} as const;

export type ModelAlias = typeof MODEL_ALIAS[keyof typeof MODEL_ALIAS];

/** 模型质量模式 */
export const MODEL_MODE = {
  LOW_COST: 'low_cost',
  BALANCED: 'balanced',
  HIGH_QUALITY: 'high_quality',
  AUTO: 'auto'
} as const;

export type ModelMode = typeof MODEL_MODE[keyof typeof MODEL_MODE];

/** 单轮对话模型调用上限 */
export const MAX_MODEL_CALLS_PER_TURN = 3;

/** 内置技能 ID */
export const SKILL_ID = {
  CREATE_REMINDER: 'create_reminder',
  LIST_TODAY_SCHEDULE: 'list_today_schedule',
  SET_PET_EXPRESSION: 'set_pet_expression',
  GET_CURRENT_TIME: 'get_current_time'
} as const;

export type SkillId = typeof SKILL_ID[keyof typeof SKILL_ID];

/** 权限等级 */
export const PERMISSION_LEVEL = {
  AUTO_ALLOW: 'auto_allow',
  EXPLICIT_CONFIRM: 'explicit_confirm',
  DOUBLE_CONFIRM: 'double_confirm',
  DENY: 'deny'
} as const;

export type PermissionLevel = typeof PERMISSION_LEVEL[keyof typeof PERMISSION_LEVEL];

/** 错误码 */
export const ERROR_CODE = {
  UNKNOWN: 'unknown',
  NETWORK_TIMEOUT: 'network_timeout',
  NETWORK_FAILURE: 'network_failure',
  MODEL_UNAVAILABLE: 'model_unavailable',
  MODEL_CALL_LIMIT_EXCEEDED: 'model_call_limit_exceeded',
  MODEL_INVALID_OUTPUT: 'model_invalid_output',
  PERMISSION_DENIED: 'permission_denied',
  SKILL_NOT_REGISTERED: 'skill_not_registered',
  SKILL_INPUT_INVALID: 'skill_input_invalid',
  DATABASE_ERROR: 'database_error',
  CHECKPOINT_CORRUPTED: 'checkpoint_corrupted',
  CHARACTER_PACK_INVALID: 'character_pack_invalid',
  TIME_INVALID: 'time_invalid',
  MEMORY_WRITE_FAILED: 'memory_write_failed',
  SCHEDULER_ERROR: 'scheduler_error',
  IPC_VALIDATION_FAILED: 'ipc_validation_failed',
  UNKNOWN_EVENT: 'unknown_event'
} as const;

export type ErrorCode = typeof ERROR_CODE[keyof typeof ERROR_CODE];

/** 主动事件投递通道 */
export const DELIVERY_CHANNEL = {
  PET_BUBBLE: 'pet_bubble',
  SYSTEM_NOTIFICATION: 'system_notification',
  DEFERRED: 'deferred',
  SUPPRESSED: 'suppressed'
} as const;

export type DeliveryChannel = typeof DELIVERY_CHANNEL[keyof typeof DELIVERY_CHANNEL];

/** AppEvent schema 版本 */
export const APP_EVENT_SCHEMA_VERSION = 1;

/** 记忆作用域 */
export const MEMORY_SCOPE = {
  GLOBAL: 'global',
  CHARACTER: 'character'
} as const;

export type MemoryScope = typeof MEMORY_SCOPE[keyof typeof MEMORY_SCOPE];

/** 记忆类型 */
export const MEMORY_TYPE = {
  PROFILE: 'profile',
  PREFERENCE: 'preference',
  EVENT: 'event',
  RELATIONSHIP: 'relationship',
  PROJECT: 'project'
} as const;

export type MemoryType = typeof MEMORY_TYPE[keyof typeof MEMORY_TYPE];
