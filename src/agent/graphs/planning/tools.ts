/**
 * Planning Tools - Zod 校验的规划工具集。
 *
 * 核心原则：
 * - 不允许模型直接操作 repository 或执行 SQL
 * - 所有写操作通过经过 Zod 校验的 Planning Tools
 * - 模型输出非法参数时不能写入数据库
 * - publish_plan 必须要求明确用户确认；不能由模型擅自发布
 *
 * 模型输出的 JSON 经 Zod schema 校验后，由工具函数执行写操作。
 */
import { z } from 'zod';
import { planRepository } from '../../../infrastructure/database/repositories/plan-repository';
import type { PlanScope } from '../../../infrastructure/database/repositories/plan-repository';
import { transaction } from '../../../infrastructure/database/connection';
import type { PlanDraft, AgentAction, AgentActionType } from './state';
import { isReadonlyAction } from './state';
import { createLogger } from '../../../infrastructure/logging/logger';

const log = createLogger('PlanningTools');

/** HH:MM 时间格式校验 */
const timeFormatSchema = z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, '时间格式必须为 HH:MM');

/** YYYY-MM-DD 本地日期格式校验（仅格式，真实性由 TimeService.isValidLocalDate 校验） */
const localDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式必须为 YYYY-MM-DD');

/** 任务内容校验：非空，长度 1-200 */
const taskContentSchema = z.string().min(1, '任务内容不能为空').max(200, '任务内容不能超过 200 字');

/** 创建草案的任务项 schema */
const draftTaskSchema = z.object({
  content: taskContentSchema,
  start_time: timeFormatSchema,
  end_time: timeFormatSchema
}).refine(
  (data) => data.start_time < data.end_time,
  { message: '开始时间必须早于结束时间' }
);

/** 任务 patch schema（所有字段可选） */
const taskPatchSchema = z.object({
  id: z.string().optional(),
  content: taskContentSchema.optional(),
  start_time: timeFormatSchema.optional(),
  end_time: timeFormatSchema.optional(),
  order_index: z.number().int().min(0).optional()
});

/** 新任务 schema（add_task 用） */
const newTaskSchema = z.object({
  content: taskContentSchema,
  start_time: timeFormatSchema,
  end_time: timeFormatSchema
}).refine(
  (data) => data.start_time < data.end_time,
  { message: '开始时间必须早于结束时间' }
);

/** Agent 动作 schema - 核心校验 */
export const agentActionSchema = z.object({
  type: z.enum([
    'ask_clarification',
    'create_draft',
    'patch_tasks',
    'delete_task',
    'add_task',
    'request_confirmation',
    'publish_plan',
    // 日历扩展
    'cancel_plan',
    'get_plan_by_date',
    'list_plans_by_range',
    'search_plans',
    'get_calendar_month'
  ] as const satisfies readonly AgentActionType[]),
  clarificationQuestion: z.string().min(1).max(500).optional(),
  tasks: z.array(draftTaskSchema).min(1).max(10).optional(),
  patches: z.array(taskPatchSchema).min(1).max(20).optional(),
  taskId: z.string().optional(),
  taskIndex: z.number().int().min(0).optional(),
  newTask: newTaskSchema.optional(),
  // 修复 v4-pro 兼容性：部分模型在复杂场景（如 patch_tasks）下可能不输出 message 字段。
  // 将 message 设为可选，缺失时由 agent-decide 节点根据动作类型生成默认消息。
  message: z.string().min(1).max(1000).optional(),
  // 日历扩展字段
  target_date: localDateSchema.optional(),
  source_date_text: z.string().max(100).optional(),
  planId: z.string().optional(),
  query: z.string().min(1).max(200).optional(),
  startDate: localDateSchema.optional(),
  endDate: localDateSchema.optional(),
  year: z.number().int().min(2000).max(2100).optional(),
  month: z.number().int().min(1).max(12).optional()
}).refine(
  (data) => {
    // 根据类型校验必填字段
    switch (data.type) {
      case 'ask_clarification':
        return !!data.clarificationQuestion;
      case 'create_draft':
        return !!data.tasks && data.tasks.length > 0;
      case 'patch_tasks':
        return !!data.patches && data.patches.length > 0;
      case 'delete_task':
        return !!data.taskId || typeof data.taskIndex === 'number';
      case 'add_task':
        return !!data.newTask;
      case 'request_confirmation':
      case 'publish_plan':
      case 'cancel_plan':
        return true;
      case 'get_plan_by_date':
        return !!data.target_date;
      case 'list_plans_by_range':
        return !!data.startDate && !!data.endDate;
      case 'search_plans':
        return !!data.query;
      case 'get_calendar_month':
        return typeof data.year === 'number' && typeof data.month === 'number';
      default:
        return false;
    }
  },
  { message: '动作缺少必填字段' }
);

/**
 * 根据动作类型生成默认消息（共享函数）。
 * 当模型输出缺少 message 字段时使用。
 * v4-pro 等模型在复杂场景下可能不输出 message 字段。
 */
export function getDefaultMessageForAction(action: { type?: string; clarificationQuestion?: string }): string {
  switch (action.type) {
    case 'ask_clarification':
      return action.clarificationQuestion ?? '能再补充一下细节吗？';
    case 'create_draft':
      return '好的，我为你生成了计划草案，请查看。';
    case 'patch_tasks':
      return '好的，我已经调整了任务安排。';
    case 'delete_task':
      return '好的，已经删除了指定任务。';
    case 'add_task':
      return '好的，已经添加了新任务。';
    case 'request_confirmation':
      return '草案已就绪，确认发布吗？';
    case 'publish_plan':
      return '好的，正在为你发布计划。';
    case 'cancel_plan':
      return '好的，已经取消该计划。';
    case 'get_plan_by_date':
    case 'list_plans_by_range':
    case 'search_plans':
    case 'get_calendar_month':
      return '好的，正在查询计划信息。';
    default:
      return '好的。';
  }
}

/** 校验模型输出的动作 JSON */
export function validateAgentAction(parsed: unknown): { valid: boolean; action?: AgentAction; error?: string } {
  // V7 修复：双重保险 — 在 Zod 校验前确保 message 字段存在且为非空字符串。
  // agent-decide.ts 已有预处理，此处兜底防止边缘情况（如 parsed 来自不同路径）。
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const parsedObj = parsed as Record<string, unknown>;
    if (typeof parsedObj.message !== 'string' || (parsedObj.message as string).trim().length === 0) {
      const defaultMsg = getDefaultMessageForAction(parsedObj as { type?: string; clarificationQuestion?: string });
      parsedObj.message = defaultMsg;
    }
  }
  const result = agentActionSchema.safeParse(parsed);
  if (!result.success) {
    const errorMsg = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
    log.warn('agent action validation failed', { fields: { error: errorMsg } });
    return { valid: false, error: errorMsg };
  }
  return { valid: true, action: result.data as AgentAction };
}

/**
 * 校验任务时间不早于当前时间。
 * 要求 8：当前时间之后才允许安排未开始任务。
 *
 * 日历扩展：仅用于 today 模式。future_date 模式不调用此函数。
 */
export function validateTaskTimesNotPast(
  tasks: Array<{ start_time: string; end_time: string }>,
  currentTimeHour: number,
  currentTimeMinute: number
): { valid: boolean; error?: string } {
  const currentMinutes = currentTimeHour * 60 + currentTimeMinute;
  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    const [h, m] = task.start_time.split(':').map(Number);
    const taskMinutes = h * 60 + m;
    if (taskMinutes < currentMinutes) {
      return {
        valid: false,
        error: `任务 ${i + 1} 的开始时间 ${task.start_time} 早于当前时间，不允许安排过去时间`
      };
    }
  }
  return { valid: true };
}

/**
 * 校验 YYYY-MM-DD 是否为真实存在的日期（覆盖闰年、跨月、跨年）。
 * 不依赖 TimeService 实例，便于纯函数测试。
 */
export function isValidLocalDate(dateStr: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const [y, m, d] = dateStr.split('-').map(Number);
  if (m < 1 || m > 12) return false;
  if (d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** 比较两个 YYYY-MM-DD 日期字符串：-1 / 0 / 1 */
function compareLocalDate(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** 目标日期分类 */
export type TargetDateMode = 'future_date' | 'today' | 'past_date';

/** 计划草案校验模式 */
export type PlanValidationMode = 'future_date' | 'today' | 'past_date' | 'display_or_activation';

/**
 * 校验目标日期。
 *
 * 规则（对应规格第三节）：
 * 1. target_date 必须是合法 ISO 本地日期 YYYY-MM-DD；
 * 2. 不允许模型伪造当前日期（todayDate 由 TimeService 提供）；
 * 3. 创建过去日期计划必须拒绝（allowPast=false 时）；
 * 4. 查看过去计划允许（allowPast=true 时）；
 * 5. 不得把 UTC 日期截断当作本地日期（校验格式，不使用 toISOString().slice）。
 *
 * 返回 mode 用于后续 validatePlanDraftByMode 选择校验模式。
 */
export function validateTargetDate(
  targetDate: string | undefined,
  todayDate: string,
  options?: { allowPast?: boolean }
): { valid: boolean; mode?: TargetDateMode; error?: string } {
  if (!targetDate || typeof targetDate !== 'string') {
    return { valid: false, error: '缺少目标日期' };
  }
  if (!isValidLocalDate(targetDate)) {
    return { valid: false, error: `目标日期 ${targetDate} 不是合法的 YYYY-MM-DD 日期` };
  }
  const cmp = compareLocalDate(targetDate, todayDate);
  let mode: TargetDateMode;
  if (cmp > 0) mode = 'future_date';
  else if (cmp === 0) mode = 'today';
  else mode = 'past_date';

  if (mode === 'past_date' && !options?.allowPast) {
    return {
      valid: false,
      mode,
      error: `不能为过去日期 ${targetDate} 创建或修改计划（今天是 ${todayDate}）。查看过去计划请使用日历入口。`
    };
  }
  return { valid: true, mode };
}

/**
 * 按模式校验计划草案。
 *
 * future_date：目标日期晚于今天
 *   - 08:00 即使早于当前时刻也合法
 *   - 校验 HH:MM、start < end、重复、重叠
 *   - 不应用"早于当前时间"规则
 *
 * today：目标日期等于今天
 *   - 新增任务和被修改任务不能安排到当前时间之前
 *   - 已经开始或已经完成的旧任务不能导致整个计划无法读取（display 模式负责）
 *   - 发布时需要给出合理的过期任务处理结果
 *
 * past_date：
 *   - 允许查看（本函数不拒绝）
 *   - 创建和修改由 validateTargetDate 在上层拒绝
 *
 * display_or_activation：每日激活和显示计划时
 *   - 不能因为应用启动较晚、部分任务时间已过去就拒绝整个计划
 *   - 过去但未完成的任务保留并明确显示
 *   - 不允许静默删除
 */
export function validatePlanDraftByMode(
  tasks: Array<{ id?: string; content?: string; start_time?: string | null; end_time?: string | null; order_index?: number }>,
  mode: PlanValidationMode,
  options?: { currentTimeHour?: number; currentTimeMinute?: number }
): { valid: boolean; error?: string } {
  // 1. 空任务检查
  if (!tasks || tasks.length === 0) {
    return { valid: false, error: '计划草案不能为空' };
  }

  const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
  const normalized: Array<{ id: string; content: string; start: string; end: string; startMin: number; endMin: number }> = [];

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    const content = String(task.content || '').trim();

    // 2. 空内容检查
    if (!content) {
      return { valid: false, error: `任务 ${i + 1} 内容为空` };
    }
    if (content.length > 200) {
      return { valid: false, error: `任务 ${i + 1} 内容超过 200 字` };
    }

    const startTime = String(task.start_time || '').trim();
    const endTime = String(task.end_time || '').trim();

    // 3. HH:MM 格式校验
    if (!timeRegex.test(startTime)) {
      return { valid: false, error: `任务 ${i + 1} 开始时间格式错误，必须为 HH:MM` };
    }
    if (!timeRegex.test(endTime)) {
      return { valid: false, error: `任务 ${i + 1} 结束时间格式错误，必须为 HH:MM` };
    }

    const [sh, sm] = startTime.split(':').map(Number);
    const [eh, em] = endTime.split(':').map(Number);
    const startMin = sh * 60 + sm;
    const endMin = eh * 60 + em;

    // 4. start < end 校验
    if (startMin >= endMin) {
      return { valid: false, error: `任务 ${i + 1} 开始时间 ${startTime} 必须早于结束时间 ${endTime}` };
    }

    // 5. 过去时间校验：仅 today 模式且提供了当前时间时应用
    //    future_date / past_date / display_or_activation 模式跳过此校验
    if (mode === 'today' &&
        options?.currentTimeHour !== undefined &&
        options?.currentTimeMinute !== undefined) {
      const currentMinutes = options.currentTimeHour * 60 + options.currentTimeMinute;
      if (startMin < currentMinutes) {
        return { valid: false, error: `任务 ${i + 1} 的开始时间 ${startTime} 早于当前时间，不允许安排过去时间` };
      }
    }

    normalized.push({
      id: String(task.id || `task-${i}`),
      content,
      start: startTime,
      end: endTime,
      startMin,
      endMin
    });
  }

  // 6. 重复任务检查（相同内容 + 相同时间）
  for (let i = 0; i < normalized.length; i++) {
    for (let j = i + 1; j < normalized.length; j++) {
      if (normalized[i].content === normalized[j].content &&
          normalized[i].start === normalized[j].start &&
          normalized[i].end === normalized[j].end) {
        return { valid: false, error: `任务 ${i + 1} 和任务 ${j + 1} 完全重复` };
      }
    }
  }

  // 7. 任务重叠检查
  for (let i = 0; i < normalized.length; i++) {
    for (let j = i + 1; j < normalized.length; j++) {
      const a = normalized[i];
      const b = normalized[j];
      if (a.startMin < b.endMin && b.startMin < a.endMin) {
        return {
          valid: false,
          error: `任务 ${i + 1}（${a.start}-${a.end}）与任务 ${j + 1}（${b.start}-${b.end}）时间重叠`
        };
      }
    }
  }

  return { valid: true };
}

/**
 * 统一校验计划草案（向后兼容包装器）。
 *
 * 修复 3：create/patch/add/delete/manual edit/publish 后全部校验。
 * publish 前必须重新校验整个计划。
 *
 * 日历扩展：此函数保持原有签名，内部按 'today' 模式校验。
 * 跨日期计划请使用 validatePlanDraftByMode。
 */
export function validatePlanDraft(
  tasks: Array<{ id?: string; content?: string; start_time?: string | null; end_time?: string | null; order_index?: number }>,
  currentTimeHour?: number,
  currentTimeMinute?: number
): { valid: boolean; error?: string } {
  return validatePlanDraftByMode(tasks, 'today', { currentTimeHour, currentTimeMinute });
}

/**
 * 将 PlanWithTasks 转为 PlanDraft（renderer 展示用）。
 */
export function toPlanDraft(
  plan: { id: string; date: string; tasks: Array<{ id: string; content: string; start_time: string | null; end_time: string | null; completed: number; order_index: number; }> },
  draftVersion?: number
): PlanDraft {
  return {
    planId: plan.id,
    date: plan.date,
    tasks: plan.tasks.map(t => ({
      id: t.id,
      content: t.content,
      start_time: t.start_time ?? '',
      end_time: t.end_time ?? '',
      completed: t.completed,
      order_index: t.order_index
    })),
    draftVersion: draftVersion ?? 0
  };
}

/**
 * 生成任务 ID。
 */
function generateTaskId(planId: string): string {
  return `task_${planId}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * 执行 Planning Tool（写操作）。
 * 所有写操作经 Zod 校验后调用 planRepository。
 * 返回更新后的草案。
 *
 * 修复 3：create/patch/add/delete/publish 后全部校验。
 * 多任务 patch 必须真正原子化，任一失败时全部回滚。
 */
export function executePlanningTool(
  action: AgentAction,
  context: {
    planId: string;
    date: string;
    currentDraft: PlanDraft | null;
    userConfirmed: boolean;
    currentTimeHour: number;
    currentTimeMinute: number;
    /** V7: scope 隔离 — create_draft 写入 plans 时使用 */
    scope?: PlanScope;
    /** V7: 目标日期模式 — future_date 模式跳过"早于当前时间"校验 */
    targetDateMode?: TargetDateMode;
  }
): { success: boolean; draft?: PlanDraft; error?: string; published?: boolean } {
  const { planId, date, currentDraft, userConfirmed, currentTimeHour, currentTimeMinute, scope } = context;
  /** 解析校验模式：缺省时按 today 校验（向后兼容） */
  const validationMode: PlanValidationMode = context.targetDateMode ?? 'today';
  /** today 模式才传当前时间（用于"早于当前时间"校验）；future_date 等模式不传 */
  const validationOptions = validationMode === 'today'
    ? { currentTimeHour, currentTimeMinute }
    : {};

  switch (action.type) {
    case 'ask_clarification': {
      // 只读操作，不写数据库
      log.info('planning tool: ask_clarification', { fields: { planId } });
      return { success: true, draft: currentDraft ?? undefined };
    }

    case 'create_draft': {
      // 修复 1：写入+校验在同一事务中完成，校验失败 throw 回滚
      // V7 修复：按 targetDateMode 校验，future_date 模式不应用"早于当前时间"规则
      try {
        const draft = transaction(() => {
          // 先校验输入（按目标日期模式选择校验规则）
          const inputValidation = validatePlanDraftByMode(action.tasks!, validationMode, validationOptions);
          if (!inputValidation.valid) {
            throw new Error(inputValidation.error);
          }

          if (currentDraft) {
            // 已有草案：删除旧任务，插入新任务
            planRepository.deleteTasksByPlanId(planId);
          } else {
            planRepository.insert({
              id: planId, date, status: 'draft',
              user_id: scope?.userId ?? '',
              character_id: scope?.characterId ?? '',
              timezone: 'Asia/Shanghai'
            });
          }

          const tasks = action.tasks!.map((t, i) => ({
            id: generateTaskId(planId),
            plan_id: planId,
            content: t.content,
            start_time: t.start_time,
            end_time: t.end_time,
            completed: 0,
            order_index: i
          }));
          planRepository.insertTasks(tasks);

          // 写入后重新读取并校验完整草案（按目标日期模式）
          const updatedTasks = planRepository.getTasksByPlanId(planId);
          const postValidation = validatePlanDraftByMode(updatedTasks, validationMode, validationOptions);
          if (!postValidation.valid) {
            throw new Error(`写入后校验失败: ${postValidation.error}`);
          }

          const updatedPlan = planRepository.getById(planId);
          return toPlanDraft({ id: planId, date, tasks: updatedTasks }, updatedPlan?.draft_version ?? 1);
        });
        log.info('planning tool: create_draft', { fields: { planId, taskCount: action.tasks!.length } });
        return { success: true, draft };
      } catch (error) {
        return { success: false, error: (error as Error)?.message ?? 'create_draft failed' };
      }
    }

    case 'patch_tasks': {
      if (!currentDraft) {
        return { success: false, error: '没有当前草案，无法修改任务' };
      }
      try {
        // 修复 1：写入+校验在同一事务中完成，校验失败 throw 回滚
        const draft = transaction(() => {
          // 将模型输出的 patch（可能只有 index 没有 id）映射到实际任务 ID
          const patches = action.patches!.map(p => {
            if (p.id) return p;
            if (p.order_index !== undefined) {
              const task = currentDraft.tasks.find(t => t.order_index === p.order_index);
              if (task) return { ...p, id: task.id };
            }
            return p;
          }).filter((p): p is { id: string; content?: string; start_time?: string; end_time?: string; order_index?: number } => !!p.id);

          if (patches.length === 0) {
            throw new Error('没有有效的任务修改（缺少任务 ID）');
          }

          // patchTasks 已使用事务，任一失败回滚
          const ok = planRepository.patchTasks(planId, patches);
          if (!ok) {
            throw new Error('部分任务修改失败，已回滚');
          }

          // patch 后校验整个草案 — 在同一事务内，校验失败会回滚写入（按目标日期模式）
          const updatedTasks = planRepository.getTasksByPlanId(planId);
          const draftValidation = validatePlanDraftByMode(updatedTasks, validationMode, validationOptions);
          if (!draftValidation.valid) {
            throw new Error(`修改后校验失败: ${draftValidation.error}`);
          }

          const updatedPlan = planRepository.getById(planId);
          return toPlanDraft({ id: planId, date, tasks: updatedTasks }, updatedPlan?.draft_version ?? currentDraft.draftVersion + 1);
        });
        log.info('planning tool: patch_tasks', { fields: { planId, patchCount: action.patches!.length } });
        return { success: true, draft };
      } catch (error) {
        return { success: false, error: (error as Error)?.message ?? 'patch_tasks failed' };
      }
    }

    case 'delete_task': {
      if (!currentDraft) {
        return { success: false, error: '没有当前草案，无法删除任务' };
      }
      try {
        let taskId = action.taskId;
        if (!taskId && typeof action.taskIndex === 'number') {
          const task = currentDraft.tasks[action.taskIndex];
          if (!task) {
            return { success: false, error: `任务索引 ${action.taskIndex} 不存在` };
          }
          taskId = task.id;
        }
        if (!taskId) {
          return { success: false, error: '未指定要删除的任务' };
        }
        // 阻断 3：禁止删除最后一个任务，不能留下空草案
        if (currentDraft.tasks.length <= 1) {
          return {
            success: false,
            error: '不能删除最后一个任务。如果想要放弃整个草案，请直接告诉我"放弃计划"。'
          };
        }
        const ok = planRepository.deleteTask(planId, taskId);
        if (!ok) {
          return { success: false, error: '任务删除失败，可能已不存在' };
        }
        const updatedTasks = planRepository.getTasksByPlanId(planId);
        const updatedPlan = planRepository.getById(planId);
        const draft = toPlanDraft({ id: planId, date, tasks: updatedTasks }, updatedPlan?.draft_version ?? currentDraft.draftVersion + 1);
        log.info('planning tool: delete_task', { fields: { planId, taskId } });
        return { success: true, draft };
      } catch (error) {
        return { success: false, error: (error as Error)?.message ?? 'delete_task failed' };
      }
    }

    case 'add_task': {
      if (!currentDraft) {
        return { success: false, error: '没有当前草案，无法添加任务' };
      }
      try {
        // 修复 1：写入+校验在同一事务中完成，校验失败 throw 回滚
        // V7 修复：future_date 模式跳过"早于当前时间"校验
        const result = transaction(() => {
          if (validationMode === 'today') {
            const timeCheck = validateTaskTimesNotPast([action.newTask!], currentTimeHour, currentTimeMinute);
            if (!timeCheck.valid) {
              throw new Error(timeCheck.error);
            }
          }
          const maxOrder = Math.max(-1, ...currentDraft.tasks.map(t => t.order_index));
          const newTaskId = generateTaskId(planId);
          planRepository.addTask(planId, {
            id: newTaskId,
            content: action.newTask!.content,
            start_time: action.newTask!.start_time,
            end_time: action.newTask!.end_time,
            order_index: maxOrder + 1
          });

          // add 后校验整个草案 — 在同一事务内，校验失败会回滚写入（按目标日期模式）
          const updatedTasks = planRepository.getTasksByPlanId(planId);
          const draftValidation = validatePlanDraftByMode(updatedTasks, validationMode, validationOptions);
          if (!draftValidation.valid) {
            throw new Error(`添加后校验失败: ${draftValidation.error}`);
          }

          const updatedPlan = planRepository.getById(planId);
          return {
            newTaskId,
            draft: toPlanDraft({ id: planId, date, tasks: updatedTasks }, updatedPlan?.draft_version ?? currentDraft.draftVersion + 1)
          };
        });
        log.info('planning tool: add_task', { fields: { planId, taskId: result.newTaskId } });
        return { success: true, draft: result.draft };
      } catch (error) {
        return { success: false, error: (error as Error)?.message ?? 'add_task failed' };
      }
    }

    case 'request_confirmation': {
      // 只读操作，不写数据库
      log.info('planning tool: request_confirmation', { fields: { planId } });
      return { success: true, draft: currentDraft ?? undefined };
    }

    case 'publish_plan': {
      // 要求 8：publish_plan 必须要求明确用户确认；不能由模型擅自发布
      if (!userConfirmed) {
        log.warn('planning tool: publish_plan rejected, user not confirmed', { fields: { planId } });
        return { success: false, error: '发布计划需要用户明确确认，模型不能擅自发布' };
      }
      if (!currentDraft) {
        return { success: false, error: '没有当前草案，无法发布' };
      }
      // 修复 3：publish 前必须重新校验整个计划
      // V7 修复：按目标日期模式校验
      // - today 模式：任务不能是过去时间（保持原有行为，测试 26 期望）
      // - future_date 模式：不检查过去时间（未来日期的计划可以包含任意时间）
      const publishValidation = validatePlanDraftByMode(currentDraft.tasks, validationMode, validationOptions);
      if (!publishValidation.valid) {
        return { success: false, error: `发布前校验失败: ${publishValidation.error}` };
      }
      try {
        const ok = planRepository.publishPlan(planId);
        if (!ok) {
          return { success: false, error: '发布失败，可能未确认或状态不正确' };
        }
        log.info('planning tool: publish_plan', { fields: { planId } });
        return { success: true, draft: currentDraft, published: true };
      } catch (error) {
        return { success: false, error: (error as Error)?.message ?? 'publish_plan failed' };
      }
    }

    case 'cancel_plan': {
      // 日历扩展：取消未来计划（draft/scheduled → cancelled）
      // 可通过 action.planId 指定要取消的计划，或使用当前 currentDraft 的 planId
      const targetPlanId = action.planId || planId;
      if (!targetPlanId) {
        return { success: false, error: '取消计划需要指定 planId' };
      }
      try {
        const ok = planRepository.cancelPlan(targetPlanId);
        if (!ok) {
          return { success: false, error: '取消计划失败，可能状态不允许（仅 draft/scheduled 可取消）或计划不存在' };
        }
        log.info('planning tool: cancel_plan', { fields: { planId: targetPlanId } });
        // 取消后清除当前草案（如果是取消当前草案）
        const clearedDraft = (currentDraft && currentDraft.planId === targetPlanId) ? undefined : currentDraft ?? undefined;
        return { success: true, draft: clearedDraft };
      } catch (error) {
        return { success: false, error: (error as Error)?.message ?? 'cancel_plan failed' };
      }
    }

    case 'get_plan_by_date':
    case 'list_plans_by_range':
    case 'search_plans':
    case 'get_calendar_month': {
      // 只读工具由 executeReadonlyTool 处理，不应到达此处
      log.warn('planning tool: readonly tool must be executed via executeReadonlyTool', { fields: { actionType: action.type } });
      return {
        success: false,
        error: `只读工具 ${action.type} 需要通过 executeReadonlyTool 执行`
      };
    }

    default:
      return { success: false, error: `未知动作类型: ${(action as AgentAction).type}` };
  }
}

/**
 * 执行只读工具（日历扩展）。
 *
 * 只读工具执行后，把 toolResult 返回给 agent_decide，让模型根据查询结果继续判断。
 * 例如：用户"把我之前有健身的计划推迟一小时"
 *   1. 模型第一次调用 search_plans(query="健身")
 *   2. 工具返回候选计划和日期
 *   3. 模型第二次调用 patch_tasks(planId=..., patches=...)
 *
 * 返回 toolResult 为结构化文本摘要，可注入下次模型上下文。
 */
export function executeReadonlyTool(
  action: AgentAction,
  scope: PlanScope
): { success: boolean; toolResult?: string; error?: string } {
  if (!isReadonlyAction(action.type)) {
    return { success: false, error: `${action.type} 不是只读工具` };
  }

  try {
    switch (action.type) {
      case 'get_plan_by_date': {
        const date = action.target_date!;
        const plan = planRepository.getPlanByDate(scope, date);
        if (!plan) {
          return {
            success: true,
            toolResult: `日期 ${date} 没有计划。`
          };
        }
        const taskSummary = plan.tasks.map((t, i) =>
          `${i + 1}. ${t.start_time ?? '??:??'}-${t.end_time ?? '??:??'} ${t.content}${t.completed ? '（已完成）' : ''}`
        ).join('\n');
        return {
          success: true,
          toolResult: `日期 ${date} 的计划（ID: ${plan.id}，状态: ${plan.status}）：\n${taskSummary}`
        };
      }

      case 'list_plans_by_range': {
        const from = action.startDate!;
        const to = action.endDate!;
        const plans = planRepository.listPlansByRange(scope, from, to);
        if (plans.length === 0) {
          return {
            success: true,
            toolResult: `日期范围 ${from} 至 ${to} 没有计划。`
          };
        }
        const summary = plans.map(p => {
          const taskCount = p.tasks.length;
          const completedCount = p.tasks.filter(t => t.completed).length;
          return `${p.date} [${p.status}] ${taskCount} 个任务（${completedCount} 已完成）ID: ${p.id}`;
        }).join('\n');
        return {
          success: true,
          toolResult: `日期范围 ${from} 至 ${to} 的计划列表：\n${summary}`
        };
      }

      case 'search_plans': {
        const query = action.query!;
        const plans = planRepository.searchPlans(scope, query);
        if (plans.length === 0) {
          return {
            success: true,
            toolResult: `搜索"${query}"未找到匹配的计划。`
          };
        }
        const summary = plans.map(p => {
          const matchingTasks = p.tasks.filter(t => t.content.includes(query));
          const taskDetail = matchingTasks.length > 0
            ? matchingTasks.map(t => `  - ${t.start_time ?? '??:??'} ${t.content}`).join('\n')
            : p.tasks.map(t => `  - ${t.start_time ?? '??.??'} ${t.content}`).join('\n');
          return `${p.date} [${p.status}] ID: ${p.id}\n${taskDetail}`;
        }).join('\n');
        return {
          success: true,
          toolResult: `搜索"${query}"找到 ${plans.length} 个计划：\n${summary}`
        };
      }

      case 'get_calendar_month': {
        const year = action.year!;
        const month = action.month!;
        const monthPlans = planRepository.getPlansForMonth(scope, year, month);
        if (monthPlans.length === 0) {
          return {
            success: true,
            toolResult: `${year}年${month}月没有计划。`
          };
        }
        const summary = monthPlans.map(p =>
          `${p.date} [${p.status}] ${p.taskCount} 个任务（${p.completedCount} 已完成）`
        ).join('\n');
        return {
          success: true,
          toolResult: `${year}年${month}月的计划概览：\n${summary}`
        };
      }

      default:
        return { success: false, error: `未知只读工具: ${action.type}` };
    }
  } catch (error) {
    log.warn('readonly tool execution failed', {
      fields: { actionType: action.type, error: (error as Error)?.message }
    });
    return { success: false, error: (error as Error)?.message ?? '只读工具执行失败' };
  }
}
