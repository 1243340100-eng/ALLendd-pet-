/**
 * PlanMemoryRetriever — 计划记忆检索服务。
 *
 * 设计原则（规格第五节）：
 * - plans/plan_tasks 是唯一事实来源，本服务只读不写
 * - 可按日期/任务内容/日期范围检索
 * - 返回给模型的是有限、结构化摘要，不把全部历史计划塞进 Prompt
 * - 结果包含 planId、date、status、任务摘要
 * - 修改计划后立即能够通过检索读取新内容（直接查数据库，无缓存）
 * - 删除或取消计划后不能继续返回过期副本（repository 已过滤 cancelled）
 *
 * 与 MemoryStore 的区别：
 * - MemoryStore 存储稳定用户画像（"我下午容易疲劳"）
 * - PlanMemoryRetriever 存储计划事实（"7月20日有代码审查"）
 * - 不得把计划事实和稳定用户画像混为一类
 */
import { planRepository } from '../infrastructure/database/repositories/plan-repository';
import type { PlanScope, PlanStatus, PlanWithTasks } from '../infrastructure/database/repositories/plan-repository';
import { createLogger } from '../infrastructure/logging/logger';

const log = createLogger('PlanMemoryRetriever');

/** 单个任务摘要（限制长度，避免塞满 Prompt） */
export interface PlanTaskSummary {
  content: string;
  startTime: string;
  endTime: string;
  completed: boolean;
}

/** 计划记忆摘要 */
export interface PlanMemorySummary {
  planId: string;
  date: string;
  status: PlanStatus;
  taskCount: number;
  completedCount: number;
  /** 任务摘要列表（最多 maxTasksPerPlan 个） */
  taskSummary: PlanTaskSummary[];
}

/** 月视图单日摘要（不含任务详情） */
export interface PlanMonthDaySummary {
  date: string;
  status: PlanStatus;
  taskCount: number;
  completedCount: number;
}

/** 默认限制（防止把全部历史塞进 Prompt） */
const DEFAULT_SEARCH_LIMIT = 10;
const DEFAULT_RANGE_LIMIT = 31;
const MAX_TASKS_PER_PLAN = 8;
const MAX_TASK_CONTENT_LENGTH = 60;

/**
 * 将 PlanWithTasks 转为 PlanMemorySummary（限制任务数量和内容长度）。
 */
function toSummary(plan: PlanWithTasks): PlanMemorySummary {
  const taskSummary: PlanTaskSummary[] = plan.tasks.slice(0, MAX_TASKS_PER_PLAN).map(t => ({
    content: (t.content || '').slice(0, MAX_TASK_CONTENT_LENGTH),
    startTime: t.start_time ?? '',
    endTime: t.end_time ?? '',
    completed: t.completed === 1
  }));

  const completedCount = plan.tasks.reduce((sum, t) => sum + (t.completed === 1 ? 1 : 0), 0);

  return {
    planId: plan.id,
    date: plan.date,
    status: plan.status,
    taskCount: plan.tasks.length,
    completedCount,
    taskSummary
  };
}

export const planMemoryRetriever = {
  /**
   * 按日期检索计划。
   * 返回该日期最新的非取消计划摘要。
   */
  getByDate(scope: PlanScope, date: string): PlanMemorySummary | null {
    const plan = planRepository.getPlanByDate(scope, date);
    if (!plan) return null;
    log.info('getByDate', { fields: { date, planId: plan.id, status: plan.status } });
    return toSummary(plan);
  },

  /**
   * 按日期范围检索计划。
   * 用于"下周有什么计划"等范围查询。
   * 默认限制 31 天，防止返回过多数据。
   */
  listByRange(scope: PlanScope, from: string, to: string, limit: number = DEFAULT_RANGE_LIMIT): PlanMemorySummary[] {
    const plans = planRepository.listPlansByRange(scope, from, to);
    const limited = plans.slice(0, limit);
    log.info('listByRange', { fields: { from, to, total: plans.length, returned: limited.length } });
    return limited.map(toSummary);
  },

  /**
   * 按任务内容搜索计划。
   * 用于"我之前哪天安排了健身"等查询。
   * 只搜索非取消的计划（repository 已过滤）。
   * 默认限制 10 条，防止返回过多数据。
   */
  search(scope: PlanScope, query: string, range?: { from: string; to: string }, limit: number = DEFAULT_SEARCH_LIMIT): PlanMemorySummary[] {
    const plans = planRepository.searchPlans(scope, query, range);
    const limited = plans.slice(0, limit);
    log.info('search', { fields: { query, total: plans.length, returned: limited.length } });
    return limited.map(toSummary);
  },

  /**
   * 月视图摘要（不含任务详情）。
   * 用于日历月视图标记，只返回每天的计划状态和任务数量。
   */
  getMonthSummary(scope: PlanScope, year: number, month: number): PlanMonthDaySummary[] {
    const rows = planRepository.getPlansForMonth(scope, year, month);
    log.info('getMonthSummary', { fields: { year, month, dayCount: rows.length } });
    return rows.map(r => ({
      date: r.date,
      status: r.status,
      taskCount: r.taskCount,
      completedCount: r.completedCount
    }));
  },

  /**
   * 获取今天的 active 计划摘要。
   * 用于 PlanningGraph 上下文加载 todayPlan。
   */
  getTodayActive(scope: PlanScope, localDate: string): PlanMemorySummary | null {
    const plan = planRepository.getTodayActivePlan(scope, localDate);
    if (!plan) return null;
    return toSummary(plan);
  },

  /**
   * 获取指定日期的草案计划摘要。
   * 用于 PlanningGraph 上下文加载 selectedPlan。
   */
  getDraftByDate(scope: PlanScope, date: string): PlanMemorySummary | null {
    const plan = planRepository.getDraftPlanByDate(scope, date);
    if (!plan) return null;
    return toSummary(plan);
  }
};
