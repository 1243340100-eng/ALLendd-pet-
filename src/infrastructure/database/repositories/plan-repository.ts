/**
 * 计划任务 repository。
 * 管理每日计划和计划下的任务条目。
 * 约束：同一时间只能有一个 active 计划。
 */
import { getDatabase, transaction } from '../connection';

export interface PlanRow {
  id: string;
  date: string;
  status: 'draft' | 'active' | 'completed';
  created_at: string;
  updated_at: string;
}

export interface PlanTaskRow {
  id: string;
  plan_id: string;
  content: string;
  start_time: string | null;
  end_time: string | null;
  completed: number;
  order_index: number;
  created_at: string;
}

export interface PlanWithTasks extends PlanRow {
  tasks: PlanTaskRow[];
}

export const planRepository = {
  /** 创建计划 */
  insert(plan: { id: string; date: string; status: 'draft' | 'active' | 'completed' }): void {
    getDatabase().prepare(`
      INSERT INTO plans (id, date, status)
      VALUES (@id, @date, @status)
    `).run(plan);
  },

  /** 根据 ID 获取计划 */
  getById(id: string): PlanRow | null {
    return (getDatabase().prepare('SELECT * FROM plans WHERE id = ?').get(id) as PlanRow | undefined) ?? null;
  },

  /** 获取当前 active 计划（含任务） */
  getActivePlan(): PlanWithTasks | null {
    const plan = getDatabase().prepare(
      "SELECT * FROM plans WHERE status = 'active' ORDER BY created_at DESC LIMIT 1"
    ).get() as PlanRow | undefined;
    if (!plan) return null;
    const tasks = getDatabase().prepare(
      'SELECT * FROM plan_tasks WHERE plan_id = ? ORDER BY order_index'
    ).all(plan.id) as PlanTaskRow[];
    return { ...plan, tasks };
  },

  /** 获取当前 draft 计划（含任务） */
  getDraftPlan(): PlanWithTasks | null {
    const plan = getDatabase().prepare(
      "SELECT * FROM plans WHERE status = 'draft' ORDER BY created_at DESC LIMIT 1"
    ).get() as PlanRow | undefined;
    if (!plan) return null;
    const tasks = getDatabase().prepare(
      'SELECT * FROM plan_tasks WHERE plan_id = ? ORDER BY order_index'
    ).all(plan.id) as PlanTaskRow[];
    return { ...plan, tasks };
  },

  /** 更新计划状态 */
  updateStatus(id: string, status: 'draft' | 'active' | 'completed'): void {
    getDatabase().prepare(
      "UPDATE plans SET status = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(status, id);
  },

  /** 删除计划（级联删除任务） */
  deletePlan(id: string): void {
    transaction(() => {
      getDatabase().prepare('DELETE FROM plan_tasks WHERE plan_id = ?').run(id);
      getDatabase().prepare('DELETE FROM plans WHERE id = ?').run(id);
    });
  },

  /** 批量插入任务 */
  insertTasks(tasks: Array<Omit<PlanTaskRow, 'created_at'>>): void {
    const stmt = getDatabase().prepare(`
      INSERT INTO plan_tasks (id, plan_id, content, start_time, end_time, completed, order_index)
      VALUES (@id, @plan_id, @content, @start_time, @end_time, @completed, @order_index)
    `);
    transaction(() => {
      for (const t of tasks) {
        stmt.run(t);
      }
    });
  },

  /** 删除计划下的所有任务（用于重新生成草案） */
  deleteTasksByPlanId(planId: string): void {
    getDatabase().prepare('DELETE FROM plan_tasks WHERE plan_id = ?').run(planId);
  },

  /** 切换任务完成状态 */
  toggleTaskCompletion(taskId: string, completed: boolean): void {
    getDatabase().prepare(
      'UPDATE plan_tasks SET completed = ? WHERE id = ?'
    ).run(completed ? 1 : 0, taskId);
  },

  /** 获取计划下的所有任务 */
  getTasksByPlanId(planId: string): PlanTaskRow[] {
    return getDatabase().prepare(
      'SELECT * FROM plan_tasks WHERE plan_id = ? ORDER BY order_index'
    ).all(planId) as PlanTaskRow[];
  },

  /** 检查是否所有任务都已完成 */
  areAllTasksCompleted(planId: string): boolean {
    const total = getDatabase().prepare(
      'SELECT COUNT(*) as count FROM plan_tasks WHERE plan_id = ?'
    ).get(planId) as { count: number };
    const done = getDatabase().prepare(
      'SELECT COUNT(*) as count FROM plan_tasks WHERE plan_id = ? AND completed = 1'
    ).get(planId) as { count: number };
    return total.count > 0 && total.count === done.count;
  }
};
