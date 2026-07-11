/**
 * PlanningGraph 状态定义。
 *
 * 独立于 ConversationGraph，使用持久化 checkpoint 保存完整规划对话。
 * 状态在节点间传递，支持中断恢复（用户追问、确认、反馈）。
 *
 * 核心字段：
 * - messages: 独立消息历史（plan mode 专用，与聊天历史分离）
 * - currentDraft: 当前草案（含任务列表）
 * - draftVersion: 草案版本号（每次 patch 递增）
 * - timeContext: TimeService 当前时间、时区
 * - userContext: 用户资料
 * - existingPlan: 现有计划上下文
 * - agentAction: 模型选择的动作（经 Zod 校验）
 * - userConfirmed: 用户是否明确确认发布
 * - resolvedModel / responseModel: 模型透明度
 */
import { Annotation } from '@langchain/langgraph';
import type { TimeContext } from '../../../services/TimeService';
import type { UserContext } from '../../../services/UserContextService';
import type { ErrorCode } from '../../../shared/constants';
import type { PlanWithTasks } from '../../../infrastructure/database/repositories/plan-repository';

/** Agent 可选择的动作类型 */
export type AgentActionType =
  | 'ask_clarification'
  | 'create_draft'
  | 'patch_tasks'
  | 'delete_task'
  | 'add_task'
  | 'request_confirmation'
  | 'publish_plan';

/** 模型输出的动作（经 Zod 校验后填充） */
export interface AgentAction {
  type: AgentActionType;
  /** 追问问题（ask_clarification 时） */
  clarificationQuestion?: string;
  /** 新任务列表（create_draft 时） */
  tasks?: Array<{
    content: string;
    start_time: string;
    end_time: string;
  }>;
  /** 任务修改补丁（patch_tasks 时） */
  patches?: Array<{
    id?: string;
    content?: string;
    start_time?: string;
    end_time?: string;
    order_index?: number;
  }>;
  /** 删除的任务 ID（delete_task 时）或任务索引 */
  taskId?: string;
  taskIndex?: number;
  /** 新任务（add_task 时） */
  newTask?: {
    content: string;
    start_time: string;
    end_time: string;
  };
  /** 对用户说的话 */
  message: string;
}

/** Graph 状态错误条目 */
export interface PlanningGraphError {
  code: ErrorCode;
  message: string;
  node?: string;
  recovered: boolean;
  occurredAt: string;
}

/** 草案任务（renderer 展示用） */
export interface DraftTask {
  id: string;
  content: string;
  start_time: string;
  end_time: string;
  completed: number;
  order_index: number;
}

/** 当前草案 */
export interface PlanDraft {
  planId: string;
  date: string;
  tasks: DraftTask[];
  draftVersion: number;
}

/** PlanningGraph 响应 DTO（返回给 main.js IPC） */
export interface PlanningResponseDTO {
  /** 是否成功 */
  ok: boolean;
  /** 错误原因 */
  reason?: string;
  /** 当前草案（含任务） */
  plan?: PlanDraft;
  /** 对用户说的话 */
  message?: string;
  /** 模型选择的动作类型 */
  actionType?: AgentActionType;
  /** 是否需要用户确认 */
  awaitingConfirmation?: boolean;
  /** 是否已发布 */
  published?: boolean;
  /** planningModel 别名解析到的实际模型 ID */
  resolvedModel?: string;
  /** 模型 API 返回的 response.model（真实调用模型） */
  responseModel?: string;
}

/** PlanningGraph 状态 */
export const PlanningState = Annotation.Root({
  /** 用户 ID */
  userId: Annotation<string>,
  /** 角色 ID */
  characterId: Annotation<string>,
  /** 追踪 ID */
  traceId: Annotation<string>,
  /** Graph 开始时间 ISO */
  startedAt: Annotation<string>,

  /** 用户输入文本（目标 / 反馈 / 确认） */
  userInput: Annotation<string>,
  /** 独立消息历史（plan mode 专用，与聊天历史分离） */
  messages: Annotation<Array<{ role: 'system' | 'user' | 'assistant'; content: string }>>,
  /** 是否为用户确认信号（"就这样"、点击确认按钮） */
  isConfirmation: Annotation<boolean>,
  /** 是否为手动时间修改信号 */
  isManualEdit: Annotation<boolean>,

  /** 当前时间上下文（TimeService 提供） */
  timeContext: Annotation<TimeContext | null>,
  /** 用户资料 */
  userContext: Annotation<UserContext | null>,
  /** 现有计划上下文（active 或 draft） */
  existingPlan: Annotation<PlanWithTasks | null>,
  /** 当前草案 */
  currentDraft: Annotation<PlanDraft | null>,
  /** 草案版本号 */
  draftVersion: Annotation<number>,

  /** 模型选择的动作（经 Zod 校验后填充） */
  agentAction: Annotation<AgentAction | null>,
  /** 模型回复文本 */
  responseText: Annotation<string>,
  /** 是否需要追问用户 */
  shouldAskUser: Annotation<boolean>,
  /** 是否需要用户确认 */
  awaitingConfirmation: Annotation<boolean>,
  /** 用户是否明确确认发布 */
  userConfirmed: Annotation<boolean>,
  /** 是否已发布 */
  published: Annotation<boolean>,

  /** planningModel 别名解析到的实际模型 ID */
  resolvedModel: Annotation<string>,
  /** 模型 API 返回的 response.model（真实调用模型） */
  responseModel: Annotation<string>,
  /** 模型调用次数 */
  modelCallCount: Annotation<number>,

  /** 收集的错误 */
  errors: Annotation<PlanningGraphError[]>,
  /** checkpoint ID */
  checkpointId: Annotation<string>,
  /** checkpoint 原因 */
  checkpointReason: Annotation<string>,

  /** 最终响应 DTO */
  responseDTO: Annotation<PlanningResponseDTO | null>
});

export type PlanningStateType = typeof PlanningState.State;
export type PlanningStateUpdate = Partial<PlanningStateType>;

/** 创建初始 PlanningGraph 状态 */
export function createInitialPlanningState(params: {
  userId: string;
  characterId: string;
  userInput: string;
  isConfirmation?: boolean;
  isManualEdit?: boolean;
  existingMessages?: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  existingDraft?: PlanDraft | null;
  traceId?: string;
}): PlanningStateType {
  return {
    userId: params.userId,
    characterId: params.characterId,
    traceId: params.traceId ?? `planning-${Date.now()}`,
    startedAt: new Date().toISOString(),

    userInput: params.userInput,
    messages: params.existingMessages ?? [],
    isConfirmation: params.isConfirmation ?? false,
    isManualEdit: params.isManualEdit ?? false,

    timeContext: null,
    userContext: null,
    existingPlan: null,
    currentDraft: params.existingDraft ?? null,
    draftVersion: params.existingDraft?.draftVersion ?? 0,

    agentAction: null,
    responseText: '',
    shouldAskUser: false,
    awaitingConfirmation: false,
    userConfirmed: false,
    published: false,

    resolvedModel: '',
    responseModel: '',
    modelCallCount: 0,

    errors: [],
    checkpointId: '',
    checkpointReason: '',

    responseDTO: null
  };
}
