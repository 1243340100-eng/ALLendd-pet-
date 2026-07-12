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
  | 'publish_plan'
  // 日历扩展：取消未来计划
  | 'cancel_plan'
  // 日历扩展：只读查询工具（执行后返回结果给 agent_decide 继续判断）
  | 'get_plan_by_date'
  | 'list_plans_by_range'
  | 'search_plans'
  | 'get_calendar_month';

/** 只读工具动作类型集合 */
export const READONLY_ACTION_TYPES: ReadonlySet<AgentActionType> = new Set([
  'get_plan_by_date',
  'list_plans_by_range',
  'search_plans',
  'get_calendar_month'
]);

/** 判断动作是否为只读工具 */
export function isReadonlyAction(type: AgentActionType): boolean {
  return READONLY_ACTION_TYPES.has(type);
}

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
  /** 对用户说的话（可选，缺失时由 agent-decide 节点生成默认消息） */
  message?: string;
  /**
   * 目标日期 YYYY-MM-DD（日历扩展）。
   * 模型基于 TimeService 当前时间和时区输出，由确定性代码校验。
   * 缺省时视为"今天"。
   */
  target_date?: string;
  /** 用户原始日期表达（如"明天"、"下周三"、"7 月 20 日"），用于 trace 和追问 */
  source_date_text?: string;
  /**
   * 明确指定要修改/取消的 planId（日历扩展）。
   * 当用户通过日历入口或自然语言指定已有计划时使用。
   * 缺省时使用当前 currentDraft 的 planId。
   */
  planId?: string;
  /** search_plans 的搜索关键词 */
  query?: string;
  /** list_plans_by_range 的起始日期 YYYY-MM-DD */
  startDate?: string;
  /** list_plans_by_range 的结束日期 YYYY-MM-DD */
  endDate?: string;
  /** get_calendar_month 的年份 */
  year?: number;
  /** get_calendar_month 的月份（1-12） */
  month?: number;
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

/** Planning Trace 单个阶段记录 */
export interface PlanningTracePhase {
  /** 阶段名称：load_context / agent_decide / execute_tool / build_response */
  name: string;
  /** 是否成功 */
  success: boolean;
  /** 错误信息（失败时） */
  error?: string;
  /** 耗时（毫秒） */
  durationMs?: number;
  /** 动作类型（agent_decide / execute_tool 时） */
  actionType?: string;
  /** 工具名称（execute_tool 时） */
  toolName?: string;
}

/** Planning Trace 结构化记录（供状态面板诊断显示） */
export interface PlanningTrace {
  /** 追踪 ID */
  traceId: string;
  /** 开始时间 ISO */
  startedAt: string;
  /** 完成时间 ISO */
  completedAt: string;
  /** 总耗时（毫秒） */
  totalDurationMs: number;
  /** 用户配置的模型 ID */
  configuredModel: string;
  /** 实际解析发送到 HTTP body 的模型 ID */
  resolvedModel: string;
  /** API 返回的 response.model */
  responseModel: string;
  /** 三者是否一致 */
  modelConsistent: boolean;
  /** 各阶段记录 */
  phases: PlanningTracePhase[];
  /** 模型调用次数 */
  modelCallCount: number;
  /** 最近一次输入 token */
  inputTokens: number;
  /** 最近一次输出 token */
  outputTokens: number;
  /** 累计输入 token（所有模型调用之和） */
  totalInputTokens: number;
  /** 累计输出 token（所有模型调用之和） */
  totalOutputTokens: number;
  /** 自动修正次数（工具失败后回到 agent_decide） */
  autoCorrectionCount: number;
  /** 草案版本 */
  draftVersion: number;
  /** 最终结果 */
  finalResult: 'ok' | 'fail' | 'published';
  /** 是否由用户明确确认 */
  userConfirmed: boolean;
  /** 用户输入摘要（前 80 字，脱敏） */
  userInputSummary: string;
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

  /** 上一次工具执行错误（注入下次模型上下文，禁止盲目重试） */
  lastToolError: Annotation<string>,
  /** 上一次尝试的动作类型（避免重复相同动作） */
  lastAttemptedAction: Annotation<string>,
  /** 当前工具执行状态：idle/failed/succeeded。每次 execute_tool 明确覆盖。 */
  toolExecutionStatus: Annotation<'idle' | 'failed' | 'succeeded'>,

  /** 收集的错误 */
  errors: Annotation<PlanningGraphError[]>,
  /** checkpoint ID */
  checkpointId: Annotation<string>,
  /** checkpoint 原因 */
  checkpointReason: Annotation<string>,

  /** Trace 累积的各阶段记录 */
  tracePhases: Annotation<PlanningTracePhase[]>,
  /** 最近一次模型调用的输入 token */
  lastInputTokens: Annotation<number>,
  /** 最近一次模型调用的输出 token */
  lastOutputTokens: Annotation<number>,
  /** 累计输入 token（所有模型调用之和） */
  totalInputTokens: Annotation<number>,
  /** 累计输出 token（所有模型调用之和） */
  totalOutputTokens: Annotation<number>,
  /** 最近一次模型调用的耗时（毫秒） */
  lastModelDurationMs: Annotation<number>,
  /** 用户配置的模型 ID（从 app_settings 读取） */
  configuredModel: Annotation<string>,
  /** 自动修正次数（工具失败后回到 agent_decide 的次数） */
  autoCorrectionCount: Annotation<number>,
  /** Graph 迭代次数（独立于 modelCallCount，所有路径的通用循环上限） */
  graphIterationCount: Annotation<number>,

  /** 日历扩展：规划线程 ID（与 target_date 或 planId 关联，用于 checkpoint 隔离） */
  planningThreadId: Annotation<string>,
  /** 日历扩展：当前规划的目标日期 YYYY-MM-DD */
  targetDate: Annotation<string>,
  /** 日历扩展：目标日期模式 */
  targetDateMode: Annotation<'future_date' | 'today' | 'past_date' | ''>,
  /** 日历扩展：从日历选中的日期 YYYY-MM-DD（UI 入口传入） */
  selectedDate: Annotation<string>,
  /** 日历扩展：选中日期对应的计划 */
  selectedPlan: Annotation<PlanWithTasks | null>,
  /** 日历扩展：今天的 active 计划 */
  todayPlan: Annotation<PlanWithTasks | null>,
  /** 日历扩展：只读工具返回的结果摘要（注入下次 agent_decide 上下文） */
  toolResult: Annotation<string>,
  /** 日历扩展：工具尝试次数（只读 + 写） */
  toolAttemptCount: Annotation<number>,
  /** 日历扩展：上次执行的是只读工具（用于路由回 agent_decide） */
  lastToolWasReadonly: Annotation<boolean>,

  /** 最终响应 DTO */
  responseDTO: Annotation<PlanningResponseDTO | null>,
  /** 最终汇总的 Planning Trace（build_response 中设置） */
  planningTrace: Annotation<PlanningTrace | null>
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
  planningThreadId?: string;
  targetDate?: string;
  selectedDate?: string;
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

    lastToolError: '',
    lastAttemptedAction: '',
    toolExecutionStatus: 'idle',

    errors: [],
    checkpointId: '',
    checkpointReason: '',

    tracePhases: [],
    lastInputTokens: 0,
    lastOutputTokens: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    lastModelDurationMs: 0,
    configuredModel: '',
    autoCorrectionCount: 0,
    graphIterationCount: 0,

    // 日历扩展字段
    planningThreadId: params.planningThreadId ?? '',
    targetDate: params.targetDate ?? '',
    targetDateMode: '',
    selectedDate: params.selectedDate ?? '',
    selectedPlan: null,
    todayPlan: null,
    toolResult: '',
    toolAttemptCount: 0,
    lastToolWasReadonly: false,

    responseDTO: null,
    planningTrace: null
  };
}
