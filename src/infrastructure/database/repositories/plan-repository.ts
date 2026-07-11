/**
 * 计划任务 repository。
 * 管理每日计划和计划下的任务条目。
 *
 * V5 增强特性：
 * - patch 优先：支持局部修改单个任务，不删除全部重建
 * - 草案版本号：draft_version 每次 patch 递增
 * - 乐观锁：lock_version 防止并发覆盖
 * - 模型透明：resolved_model（别名解析值）+ response_model（API 返回的真实模型）
 * - 用户确认：user_confirmed 标记是否明确确认发布
 * - active 唯一约束：同一日期只允许一个 active 计划（数据库级）
 */
import { getDatabase, transaction } from '../connection';

export type PlanStatus = 'draft' | 'active' | 'completed';

export interface PlanRow {
  id: string;
  date: string;
  status: PlanStatus;
  created_at: string;
  updated_at: string;
  /** 草案版本号，每次 patch 递增 */
  draft_version?: number;
  /** 乐观锁版本号 */
  lock_version?: number;
  /** planningModel 别名解析到的实际模型 ID */
  resolved_model?: string | null;
  /** 模型 API 返回的 response.model（真实调用模型） */
  response_model?: string | null;
  /** 用户是否明确确认发布（0/1） */
  user_confirmed?: number;
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
  /** 任务级草案版本 */
  draft_version?: number;
}

export interface PlanWithTasks extends PlanRow {
  tasks: PlanTaskRow[];
}

/** 创建计划时的输入 */
export interface PlanInput {
  id: string;
  date: string;
  status: PlanStatus;
  resolved_model?: string | null;
  response_model?: string | null;
}

/** 任务 patch 输入（所有字段可选，只更新提供的字段） */
export interface TaskPatch {
  id: string;
  content?: string;
  start_time?: string | null;
  end_time?: string | null;
  order_index?: number;
}

export const planRepository = {
  /** 创建计划 */
  insert(plan: PlanInput): void {
    getDatabase().prepare(`
      INSERT INTO plans (id, date, status, resolved_model, response_model)
      VALUES (@id, @date, @status, @resolved_model, @response_model)
    `).run({
      id: plan.id,
      date: plan.date,
      status: plan.status,
      resolved_model: plan.resolved_model ?? null,
      response_model: plan.response_model ?? null
    });
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

  /**
   * 更新计划状态（使用乐观锁）。
   * 返回 true 表示更新成功，false 表示版本冲突或计划不存在。
   */
  updateStatus(id: string, status: PlanStatus, expectedLockVersion?: number): boolean {
    const plan = this.getById(id);
    if (!plan) return false;
    const expected = expectedLockVersion ?? plan.lock_version ?? 0;
    const result = getDatabase().prepare(
      `UPDATE plans
       SET status = ?, lock_version = lock_version + 1, updated_at = datetime('now')
       WHERE id = ? AND lock_version = ?`
    ).run(status, id, expected);
    return result.changes > 0;
  },

  /**
   * 标记用户已确认发布。
   * publish_plan 必须要求明确用户确认，不能由模型擅自发布。
   */
  markUserConfirmed(id: string): boolean {
    const result = getDatabase().prepare(
      `UPDATE plans SET user_confirmed = 1, updated_at = datetime('now') WHERE id = ?`
    ).run(id);
    return result.changes > 0;
  },

  /** 检查用户是否已确认 */
  isUserConfirmed(id: string): boolean {
    const row = getDatabase().prepare(
      'SELECT user_confirmed FROM plans WHERE id = ?'
    ).get(id) as { user_confirmed: number } | undefined;
    return row?.user_confirmed === 1;
  },

  /**
   * 更新计划关联的模型信息。
   * 用于状态面板显示 planningModel 实际解析值和 response.model。
   */
  updateModelInfo(id: string, resolvedModel: string | null, responseModel: string | null): void {
    getDatabase().prepare(
      `UPDATE plans SET resolved_model = ?, response_model = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(resolvedModel, responseModel, id);
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

  /** 删除计划下的所有任务（用于完全重建草案） */
  deleteTasksByPlanId(planId: string): void {
    getDatabase().prepare('DELETE FROM plan_tasks WHERE plan_id = ?').run(planId);
  },

  /**
   * Patch 单个任务（局部修改，不删除全部重建）。
   * 只更新提供的字段，draft_version 递增。
   * 返回 true 表示更新成功。
   */
  patchTask(planId: string, patch: TaskPatch): boolean {
    const sets: string[] = [];
    const params: any[] = [];
    if (patch.content !== undefined) {
      sets.push('content = ?');
      params.push(patch.content);
    }
    if (patch.start_time !== undefined) {
      sets.push('start_time = ?');
      params.push(patch.start_time);
    }
    if (patch.end_time !== undefined) {
      sets.push('end_time = ?');
      params.push(patch.end_time);
    }
    if (patch.order_index !== undefined) {
      sets.push('order_index = ?');
      params.push(patch.order_index);
    }
    if (sets.length === 0) return false;
    sets.push('draft_version = draft_version + 1');
    params.push(patch.id, planId);
    const result = getDatabase().prepare(
      `UPDATE plan_tasks SET ${sets.join(', ')} WHERE id = ? AND plan_id = ?`
    ).run(...params);
    return result.changes > 0;
  },

  /**
   * 批量 patch 任务（用于局部修改多个任务）。
   * 在事务内执行，任一失败回滚。
   */
  patchTasks(planId: string, patches: TaskPatch[]): boolean {
    if (patches.length === 0) return true;
    return transaction(() => {
      let allOk = true;
      for (const patch of patches) {
        if (!this.patchTask(planId, patch)) {
          allOk = false;
        }
      }
      // 递增计划的 draft_version
      if (allOk) {
        getDatabase().prepare(
          `UPDATE plans SET draft_version = draft_version + 1, updated_at = datetime('now') WHERE id = ?`
        ).run(planId);
      }
      return allOk;
    });
  },

  /**
   * 删除单个任务（不影响其他任务）。
   * 用于"删除代码审查"等场景。
   */
  deleteTask(planId: string, taskId: string): boolean {
    const result = getDatabase().prepare(
      'DELETE FROM plan_tasks WHERE id = ? AND plan_id = ?'
    ).run(taskId, planId);
    if (result.changes > 0) {
      getDatabase().prepare(
        `UPDATE plans SET draft_version = draft_version + 1, updated_at = datetime('now') WHERE id = ?`
      ).run(planId);
    }
    return result.changes > 0;
  },

  /**
   * 添加单个任务到已有计划。
   */
  addTask(planId: string, task: { id: string; content: string; start_time?: string | null; end_time?: string | null; order_index: number }): void {
    getDatabase().prepare(`
      INSERT INTO plan_tasks (id, plan_id, content, start_time, end_time, completed, order_index)
      VALUES (?, ?, ?, ?, ?, 0, ?)
    `).run(task.id, planId, task.content, task.start_time ?? null, task.end_time ?? null, task.order_index);
    getDatabase().prepare(
      `UPDATE plans SET draft_version = draft_version + 1, updated_at = datetime('now') WHERE id = ?`
    ).run(planId);
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
  },

  /**
   * 发布计划：将 draft 转为 active。
   * 要求 user_confirmed=1，否则拒绝发布。
   * 使用事务确保原子性：检查确认 → 更新状态。
   * 返回 true 表示发布成功。
   */
  publishPlan(id: string): boolean {
    return transaction(() => {
      const plan = this.getById(id);
      if (!plan) return false;
      if (plan.user_confirmed !== 1) return false;
      if (plan.status !== 'draft') return false;
      const result = getDatabase().prepare(
        `UPDATE plans
         SET status = 'active', lock_version = lock_version + 1, updated_at = datetime('now')
         WHERE id = ? AND status = 'draft' AND user_confirmed = 1`
      ).run(id);
      return result.changes > 0;
    });
  },

  /**
   * 获取计划的模型信息（供状态面板显示）。
   * 返回 resolved_model（别名解析值）和 response_model（API 返回的真实模型）。
   */
  getModelInfo(id: string): { resolved_model: string | null; response_model: string | null } | null {
    const row = getDatabase().prepare(
      'SELECT resolved_model, response_model FROM plans WHERE id = ?'
    ).get(id) as { resolved_model: string | null; response_model: string | null } | undefined;
    return row ?? null;
  }
};
