/**
 * Graph State 设计。对应架构计划第 6 节。
 * 使用基础状态 + Graph 专属状态，不把所有 Graph 塞进一个膨胀的 State。
 */
import type { AppEvent } from './app-event';
import type { ModelMode, ErrorCode } from '../constants';

/** 角色人格配置 */
export interface PersonaConfig {
  characterId: string;
  characterName: string;
  corePrompt: string;
  speakingStyle: string[];
  relationshipBoundary: string[];
  forbiddenDrift: string[];
  commonTone: string[];
  sampleDialogues: Array<{ user: string; expected: string }>;
  /** 对用户的称呼 */
  userPetName?: string;
  /** 默认语言 */
  defaultLanguage?: string;
  /** 记忆指引 */
  memoryGuidance?: string[];
  /** 提醒指引 */
  reminderGuidance?: string[];
}

/** 所有 Graph 共享的基础状态 */
export interface BaseGraphState {
  event: AppEvent;
  userId: string;
  characterId: string;
  sessionId?: string;

  persona?: PersonaConfig;
  modelMode: ModelMode;

  /** 追踪 ID，用于日志关联 */
  traceId: string;
  /** Graph 开始时间 ISO */
  startedAt: string;
  /** 收集的错误，不中断流程 */
  errors: GraphStateError[];
  /** 本轮已发生的模型调用次数 */
  modelCallCount: number;

  /** 待处理的权限请求 */
  pendingPermission?: PendingPermission;
  /** checkpoint 原因 */
  checkpointReason?: string;
}

export interface GraphStateError {
  code: ErrorCode;
  message: string;
  /** 出错节点 */
  node?: string;
  /** 是否已降级处理 */
  recovered: boolean;
  /** 发生时间 ISO */
  occurredAt: string;
}

export interface PendingPermission {
  requestId: string;
  skillId?: string;
  operation: string;
  /** 需要的权限等级 */
  requiredLevel: 'explicit_confirm' | 'double_confirm';
  /** checkpoint ID，用于权限解决后恢复 */
  checkpointId: string;
}

/** 提醒草稿 */
export interface ReminderDraft {
  content?: string;
  triggerAt?: string;
  timezone?: string;
  isRepeating?: boolean;
  recurrenceRule?: string;
  priority?: 'low' | 'normal' | 'high';
}

/** 检索到的记忆记录 */
export interface MemoryRecord {
  id: string;
  scope: 'global' | 'character';
  type: 'profile' | 'preference' | 'event' | 'relationship' | 'project';
  content: string;
  confidence: number;
  sourceMessageId?: string;
  createdAt: string;
  updatedAt: string;
}

/** 反思负载 */
export interface ReflectionPayload {
  turnId: string;
  userMessage: string;
  assistantReply: string;
  emotion?: string;
}

/** ConversationGraph 专属状态 */
export interface ConversationState extends BaseGraphState {
  userInput: string;
  messages: ChatMessage[];

  intent?: 'chat' | 'create_reminder' | 'list_schedule' | 'expression';
  retrievedMemories: MemoryRecord[];

  reminderDraft?: ReminderDraft;
  missingFields: string[];

  selectedSkillId?: string;
  skillResult?: unknown;

  responseText?: string;
  expression?: string;
  motion?: string;

  reflectionPayload?: ReflectionPayload;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: string;
  /** 关联的记忆 ID */
  memoryIds?: string[];
}

/** 主动策略 */
export interface ProactivePolicy {
  dndStart: string;
  dndEnd: string;
  dndEnabled: boolean;
  maxDailyProactive: number;
  ignoreThreshold: number;
  systemNotificationEnabled: boolean;
  soundEnabled: boolean;
}

/** ProactiveEventGraph 专属状态 */
export interface ProactiveState extends BaseGraphState {
  proactiveType: 'reminder' | 'startup_digest' | 'daily_greeting';
  policy: ProactivePolicy;
  fullscreen: boolean;
  inDnd: boolean;
  ignoredCount: number;
  dailyCount: number;

  scheduleItems: ScheduleItem[];
  weather?: WeatherSnapshot;

  delivery: 'pet_bubble' | 'system_notification' | 'deferred' | 'suppressed';
}

export interface ScheduleItem {
  id: string;
  type: 'reminder' | 'task';
  title: string;
  scheduledAt: string;
  completed: boolean;
  overdue: boolean;
}

export interface WeatherSnapshot {
  city: string;
  temperatureC: number;
  description: string;
  updatedAt: string;
  /** 是否来自缓存 */
  fromCache: boolean;
}

/**
 * State 中禁止保存的内容（编译期文档约束）：
 * - DeepSeek API Key
 * - 完整数据库连接
 * - Renderer 实例
 * - Electron BrowserWindow 实例
 * - 任意可执行函数
 * - 无限制增长的完整历史消息
 */
