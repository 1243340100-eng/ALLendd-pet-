/**
 * ProactiveEventGraph 状态定义。
 * 对应架构计划第 5.3 节和第 6 节。
 */
import { Annotation } from '@langchain/langgraph';
import type { AppEvent } from '../../../shared/contracts/app-event';
import type { ModelMode, ErrorCode } from '../../../shared/constants';
import type { PersonaConfig, ProactivePolicy, ScheduleItem, WeatherSnapshot } from '../../../shared/contracts/graph-state';

/** 主动事件类型 */
export type ProactiveType = 'reminder' | 'startup_digest' | 'daily_greeting' | 'daily_plan';

/** 投递通道 */
export type DeliveryChannel = 'pet_bubble' | 'system_notification' | 'deferred' | 'suppressed';

/** Graph 状态错误 */
export interface ProactiveGraphError {
  code: ErrorCode;
  message: string;
  node?: string;
  recovered: boolean;
  occurredAt: string;
}

/** 最终投递结果 */
export interface DeliveryResult {
  channel: DeliveryChannel;
  message: string;
  expression: string;
  motion: string;
  delivered: boolean;
  deliveryId?: string;
}

/** ProactiveEventGraph 状态 */
export const ProactiveState = Annotation.Root({
  event: Annotation<AppEvent>,
  userId: Annotation<string>,
  characterId: Annotation<string>,
  sessionId: Annotation<string>,
  persona: Annotation<PersonaConfig | null>,
  modelMode: Annotation<ModelMode>,
  traceId: Annotation<string>,
  startedAt: Annotation<string>,
  errors: Annotation<ProactiveGraphError[]>,
  modelCallCount: Annotation<number>,

  /** 主动事件类型 */
  proactiveType: Annotation<ProactiveType>,
  /** 主动策略 */
  policy: Annotation<ProactivePolicy | null>,
  /** 是否全屏 */
  fullscreen: Annotation<boolean>,
  /** 是否处于勿扰 */
  inDnd: Annotation<boolean>,
  /** 今日被忽略次数 */
  ignoredCount: Annotation<number>,
  /** 今日主动次数 */
  dailyCount: Annotation<number>,

  /** 日程项 */
  scheduleItems: Annotation<ScheduleItem[]>,
  /** 天气 */
  weather: Annotation<WeatherSnapshot | null>,

  /** 投递通道 */
  delivery: Annotation<DeliveryChannel>,
  /** 组合消息 */
  composedMessage: Annotation<string>,
  /** 表情 */
  expression: Annotation<string>,
  /** 动作 */
  motion: Annotation<string>,
  /** 投递结果 */
  deliveryResult: Annotation<DeliveryResult | null>,
  /** 今日日期字符串 */
  dailyDate: Annotation<string>,
  /** 是否已被去重 */
  isDuplicate: Annotation<boolean>
});

export type ProactiveStateType = typeof ProactiveState.State;
export type ProactiveStateUpdate = Partial<ProactiveStateType>;

/** 默认表情 */
export const PROACTIVE_DEFAULT_EXPRESSION = 'waving';
/** 默认动作 */
export const PROACTIVE_DEFAULT_MOTION = 'waving';

/** 创建初始 ProactiveEventGraph 状态 */
export function createInitialProactiveState(params: {
  event: AppEvent;
  userId: string;
  characterId: string;
  sessionId: string;
  persona: PersonaConfig | null;
  modelMode: ModelMode;
  proactiveType: ProactiveType;
}): ProactiveStateType {
  return {
    event: params.event,
    userId: params.userId,
    characterId: params.characterId,
    sessionId: params.sessionId,
    persona: params.persona,
    modelMode: params.modelMode,
    traceId: params.event.correlationId || `proactive-${Date.now()}`,
    startedAt: new Date().toISOString(),
    errors: [],
    modelCallCount: 0,
    proactiveType: params.proactiveType,
    policy: null,
    fullscreen: false,
    inDnd: false,
    ignoredCount: 0,
    dailyCount: 0,
    scheduleItems: [],
    weather: null,
    delivery: 'pet_bubble',
    composedMessage: '',
    expression: PROACTIVE_DEFAULT_EXPRESSION,
    motion: PROACTIVE_DEFAULT_MOTION,
    deliveryResult: null,
    dailyDate: new Date().toISOString().slice(0, 10),
    isDuplicate: false
  };
}
