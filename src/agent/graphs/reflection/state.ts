/**
 * ReflectionGraph 状态定义。
 * 对应架构计划第 5.4 节和第 6 节。
 *
 * Reflection 在 ConversationGraph 完成后异步执行。
 * Reflection 失败不影响聊天。
 * V1 只做最小异步版本。
 */
import { Annotation } from '@langchain/langgraph';
import type {
  PersonaConfig,
  ReflectionPayload
} from '../../../shared/contracts/graph-state';
import type { AppEvent } from '../../../shared/contracts/app-event';
import type { ModelMode, ErrorCode, MemoryScope, MemoryType } from '../../../shared/constants';

/** Graph 状态错误条目 */
export interface ReflectionGraphError {
  code: ErrorCode;
  message: string;
  node?: string;
  recovered: boolean;
  occurredAt: string;
}

/** 记忆候选：从对话中提取的潜在记忆 */
export interface MemoryCandidate {
  /** 候选类型 */
  type: MemoryType;
  /** 候选内容 */
  content: string;
  /** 建议作用域 */
  scope: MemoryScope;
  /** 置信度 0-1 */
  confidence: number;
  /** 来源消息 ID */
  sourceMessageId?: string;

  /** 证据引用：必须来自 userMessage 的原文子串 */
  evidenceQuote?: string;
  /** 来源角色 */
  sourceRole?: 'user' | 'assistant';

  // 管线状态（各节点填充）

  /** 是否通过验证 */
  valid: boolean;
  /** 验证失败原因 */
  invalidReason?: string;

  /** 去重命中的已有记忆 ID */
  duplicateOfId?: string;

  /** 最终保存的记忆 ID */
  savedId?: string;
  /** 是否更新了已有记忆 */
  updated: boolean;
}

/** 反思结果 */
export interface ReflectionResult {
  /** 提取的候选总数 */
  extractedCount: number;
  /** 通过验证的候选数 */
  validCount: number;
  /** 新写入的记忆数 */
  insertedCount: number;
  /** 更新的记忆数 */
  updatedCount: number;
  /** 跳过的重复数 */
  duplicateCount: number;
  /** 被验证过滤的数量 */
  filteredCount: number;
  /** 是否成功 */
  success: boolean;
  /** 错误消息（失败时） */
  errorMessage?: string;
}

/** ReflectionGraph 状态 */
export const ReflectionState = Annotation.Root({
  /** 原始事件 */
  event: Annotation<AppEvent>,
  /** 用户 ID */
  userId: Annotation<string>,
  /** 角色 ID */
  characterId: Annotation<string>,
  /** 会话 ID */
  sessionId: Annotation<string>,
  /** Persona 配置 */
  persona: Annotation<PersonaConfig | null>,
  /** 模型模式 */
  modelMode: Annotation<ModelMode>,
  /** 追踪 ID */
  traceId: Annotation<string>,
  /** Graph 开始时间 ISO */
  startedAt: Annotation<string>,
  /** 收集的错误 */
  errors: Annotation<ReflectionGraphError[]>,
  /** 本轮已发生的模型调用次数 */
  modelCallCount: Annotation<number>,

  /** 反思负载（来自 ConversationGraph） */
  reflectionPayload: Annotation<ReflectionPayload>,
  /** 提取的记忆候选 */
  candidates: Annotation<MemoryCandidate[]>,
  /** 验证后的有效候选 */
  validCandidates: Annotation<MemoryCandidate[]>,
  /** 去重后的候选（需要写入的） */
  newCandidates: Annotation<MemoryCandidate[]>,
  /** 写入结果 */
  savedCandidates: Annotation<MemoryCandidate[]>,
  /** 反思结果 */
  reflectionResult: Annotation<ReflectionResult | null>
});

export type ReflectionStateType = typeof ReflectionState.State;
export type ReflectionStateUpdate = Partial<ReflectionStateType>;

/** 创建初始 ReflectionGraph 状态 */
export function createInitialReflectionState(params: {
  event: AppEvent;
  userId: string;
  characterId: string;
  sessionId: string;
  persona: PersonaConfig | null;
  modelMode: ModelMode;
  reflectionPayload: ReflectionPayload;
}): ReflectionStateType {
  return {
    event: params.event,
    userId: params.userId,
    characterId: params.characterId,
    sessionId: params.sessionId,
    persona: params.persona,
    modelMode: params.modelMode,
    traceId: `refl-${Date.now()}`,
    startedAt: new Date().toISOString(),
    errors: [],
    modelCallCount: 0,
    reflectionPayload: params.reflectionPayload,
    candidates: [],
    validCandidates: [],
    newCandidates: [],
    savedCandidates: [],
    reflectionResult: null
  };
}
