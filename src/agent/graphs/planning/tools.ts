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
import type { PlanDraft, AgentAction, AgentActionType } from './state';
import { createLogger } from '../../../infrastructure/logging/logger';

const log = createLogger('PlanningTools');

/** HH:MM 时间格式校验 */
const timeFormatSchema = z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, '时间格式必须为 HH:MM');

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
    'publish_plan'
  ] as const satisfies readonly AgentActionType[]),
  clarificationQuestion: z.string().min(1).max(500).optional(),
  tasks: z.array(draftTaskSchema).min(1).max(10).optional(),
  patches: z.array(taskPatchSchema).min(1).max(20).optional(),
  taskId: z.string().optional(),
  taskIndex: z.number().int().min(0).optional(),
  newTask: newTaskSchema.optional(),
  message: z.string().min(1).max(1000)
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
        return true;
      default:
        return false;
    }
  },
  { message: '动作缺少必填字段' }
);

/** 校验模型输出的动作 JSON */
export function validateAgentAction(parsed: unknown): { valid: boolean; action?: AgentAction; error?: string } {
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
  }
): { success: boolean; draft?: PlanDraft; error?: string; published?: boolean } {
  const { planId, date, currentDraft, userConfirmed, currentTimeHour, currentTimeMinute } = context;

  switch (action.type) {
    case 'ask_clarification': {
      // 只读操作，不写数据库
      log.info('planning tool: ask_clarification', { fields: { planId } });
      return { success: true, draft: currentDraft ?? undefined };
    }

    case 'create_draft': {
      // 校验任务时间不早于当前时间
      const timeCheck = validateTaskTimesNotPast(action.tasks!, currentTimeHour, currentTimeMinute);
      if (!timeCheck.valid) {
        return { success: false, error: timeCheck.error };
      }

      // 创建或替换草案
      try {
        if (currentDraft) {
          // 已有草案：删除旧任务，插入新任务（用户要求"优先 patch"，
          // 但 create_draft 是完全重建场景，如首次创建或用户明确要求重新生成）
          planRepository.deleteTasksByPlanId(planId);
        } else {
          planRepository.insert({ id: planId, date, status: 'draft' });
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

        const updatedPlan = planRepository.getById(planId);
        const updatedTasks = planRepository.getTasksByPlanId(planId);
        const draft = toPlanDraft({ id: planId, date, tasks: updatedTasks }, updatedPlan?.draft_version ?? 1);
        log.info('planning tool: create_draft', { fields: { planId, taskCount: tasks.length } });
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
        // 将模型输出的 patch（可能只有 index 没有 id）映射到实际任务 ID
        const patches = action.patches!.map(p => {
          if (p.id) return p;
          // 如果没有 id，尝试用 index 匹配
          if (p.order_index !== undefined) {
            const task = currentDraft.tasks.find(t => t.order_index === p.order_index);
            if (task) return { ...p, id: task.id };
          }
          return p;
        }).filter((p): p is { id: string; content?: string; start_time?: string; end_time?: string; order_index?: number } => !!p.id);

        if (patches.length === 0) {
          return { success: false, error: '没有有效的任务修改（缺少任务 ID）' };
        }

        const ok = planRepository.patchTasks(planId, patches);
        if (!ok) {
          return { success: false, error: '部分任务修改失败' };
        }
        const updatedTasks = planRepository.getTasksByPlanId(planId);
        const updatedPlan = planRepository.getById(planId);
        const draft = toPlanDraft({ id: planId, date, tasks: updatedTasks }, updatedPlan?.draft_version ?? currentDraft.draftVersion + 1);
        log.info('planning tool: patch_tasks', { fields: { planId, patchCount: patches.length } });
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
        const timeCheck = validateTaskTimesNotPast([action.newTask!], currentTimeHour, currentTimeMinute);
        if (!timeCheck.valid) {
          return { success: false, error: timeCheck.error };
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
        const updatedTasks = planRepository.getTasksByPlanId(planId);
        const updatedPlan = planRepository.getById(planId);
        const draft = toPlanDraft({ id: planId, date, tasks: updatedTasks }, updatedPlan?.draft_version ?? currentDraft.draftVersion + 1);
        log.info('planning tool: add_task', { fields: { planId, taskId: newTaskId } });
        return { success: true, draft };
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

    default:
      return { success: false, error: `未知动作类型: ${(action as AgentAction).type}` };
  }
}
