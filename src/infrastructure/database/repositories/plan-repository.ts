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
 *
 * V7 日历扩展特性：
 * - user_id / character_id 隔离：所有查询按 scope 隔离
 * - 状态机扩展：draft / scheduled / active / completed / cancelled / expired
 * - scheduled → active：每日激活服务原子转换
 * - 按日期/范围/月份查询：支持日历视图
 * - 内容搜索：支持 PlanMemoryRetriever
 */
import { getDatabase, transaction } from '../connection';

export type PlanStatus = 'draft' | 'scheduled' | 'active' | 'completed' | 'cancelled' | 'expired';

/** V2 旧状态类型（向后兼容） */
export type LegacyPlanStatus = 'draft' | 'active' | 'completed';

/** 计划查询 scope（用户 + 角色隔离） */
export interface PlanScope {
  userId: string;
  characterId: string;
}

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
  /** V7: 用户 ID */
  user_id?: string;
  /** V7: 角色 ID */
  character_id?: string;
  /** V7: 创建时使用的时区 */
  timezone?: string;
  /** V7: scheduled → active 的激活时间 */
  activated_at?: string | null;
  /** V7: 全部任务完成时间 */
  completed_at?: string | null;
  /** V7: 取消时间 */
  cancelled_at?: string | null;
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
  /** V7: 用户 ID（scope 隔离） */
  user_id?: string;
  /** V7: 角色 ID（scope 隔离） */
  character_id?: string;
  /** V7: 创建时使用的时区 */
  timezone?: string;
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
      INSERT INTO plans (id, date, status, resolved_model, response_model, user_id, character_id, timezone)
      VALUES (@id, @date, @status, @resolved_model, @response_model, @user_id, @character_id, @timezone)
    `).run({
      id: plan.id,
      date: plan.date,
      status: plan.status,
      resolved_model: plan.resolved_model ?? null,
      response_model: plan.response_model ?? null,
      user_id: plan.user_id ?? '',
      character_id: plan.character_id ?? '',
      timezone: plan.timezone ?? 'Asia/Shanghai'
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
   * 发布计划：将 draft 转为 active（今天）或 scheduled（未来日期）。
   * 要求 user_confirmed=1，否则拒绝发布。
   * 使用事务确保原子性：检查确认 → 更新状态。
   * 返回 true 表示发布成功。
   *
   * V7: 支持 scheduled 状态。未来日期计划确认后进入 scheduled，到达日期后由激活服务转为 active。
   */
  publishPlan(id: string, targetStatus: 'active' | 'scheduled' = 'active'): boolean {
    return transaction(() => {
      const plan = this.getById(id);
      if (!plan) return false;
      if (plan.user_confirmed !== 1) return false;
      if (plan.status !== 'draft') return false;
      const result = getDatabase().prepare(
        `UPDATE plans
         SET status = ?, lock_version = lock_version + 1, updated_at = datetime('now')
         WHERE id = ? AND status = 'draft' AND user_confirmed = 1`
      ).run(targetStatus, id);
      return result.changes > 0;
    });
  },

  /**
   * V7: 激活计划：scheduled → active。
   * 由 CalendarActivationService 在到达日期后调用。
   * 原子操作，设置 activated_at。
   */
  activatePlan(id: string): boolean {
    return transaction(() => {
      const result = getDatabase().prepare(
        `UPDATE plans
         SET status = 'active', activated_at = datetime('now'), lock_version = lock_version + 1, updated_at = datetime('now')
         WHERE id = ? AND status = 'scheduled'`
      ).run(id);
      return result.changes > 0;
    });
  },

  /**
   * V7: 取消计划：draft/scheduled → cancelled。
   * 不允许取消 active 或 completed 计划（需先完成或过期）。
   */
  cancelPlan(id: string): boolean {
    return transaction(() => {
      const result = getDatabase().prepare(
        `UPDATE plans
         SET status = 'cancelled', cancelled_at = datetime('now'), lock_version = lock_version + 1, updated_at = datetime('now')
         WHERE id = ? AND status IN ('draft', 'scheduled')`
      ).run(id);
      return result.changes > 0;
    });
  },

  /**
   * V7: 完成计划：active → completed。
   * 通常在所有任务完成后调用。
   */
  completePlan(id: string): boolean {
    return transaction(() => {
      const result = getDatabase().prepare(
        `UPDATE plans
         SET status = 'completed', completed_at = datetime('now'), lock_version = lock_version + 1, updated_at = datetime('now')
         WHERE id = ? AND status = 'active'`
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
  },

  // ===== V7 日历扩展查询方法（按 scope 隔离）=====

  /**
   * V7: 按日期获取计划（含任务）。返回该日期下最新的非取消计划。
   */
  getPlanByDate(scope: PlanScope, date: string): PlanWithTasks | null {
    const plan = getDatabase().prepare(
      `SELECT * FROM plans
       WHERE user_id = ? AND character_id = ? AND date = ? AND status != 'cancelled'
       ORDER BY updated_at DESC LIMIT 1`
    ).get(scope.userId, scope.characterId, date) as PlanRow | undefined;
    if (!plan) return null;
    const tasks = getDatabase().prepare(
      'SELECT * FROM plan_tasks WHERE plan_id = ? ORDER BY order_index'
    ).all(plan.id) as PlanTaskRow[];
    return { ...plan, tasks };
  },

  /**
   * V7: 按日期获取草案计划。
   */
  getDraftPlanByDate(scope: PlanScope, date: string): PlanWithTasks | null {
    const plan = getDatabase().prepare(
      `SELECT * FROM plans
       WHERE user_id = ? AND character_id = ? AND date = ? AND status = 'draft'
       ORDER BY updated_at DESC LIMIT 1`
    ).get(scope.userId, scope.characterId, date) as PlanRow | undefined;
    if (!plan) return null;
    const tasks = getDatabase().prepare(
      'SELECT * FROM plan_tasks WHERE plan_id = ? ORDER BY order_index'
    ).all(plan.id) as PlanTaskRow[];
    return { ...plan, tasks };
  },

  /**
   * V7: 获取今天的 active 计划。
   */
  getTodayActivePlan(scope: PlanScope, localDate: string): PlanWithTasks | null {
    const plan = getDatabase().prepare(
      `SELECT * FROM plans
       WHERE user_id = ? AND character_id = ? AND date = ? AND status = 'active'
       ORDER BY updated_at DESC LIMIT 1`
    ).get(scope.userId, scope.characterId, localDate) as PlanRow | undefined;
    if (!plan) return null;
    const tasks = getDatabase().prepare(
      'SELECT * FROM plan_tasks WHERE plan_id = ? ORDER BY order_index'
    ).all(plan.id) as PlanTaskRow[];
    return { ...plan, tasks };
  },

  /**
   * V7: 按日期范围列出计划（含任务）。
   * 用于日历月视图和范围查询。
   */
  listPlansByRange(scope: PlanScope, from: string, to: string): PlanWithTasks[] {
    const plans = getDatabase().prepare(
      `SELECT * FROM plans
       WHERE user_id = ? AND character_id = ? AND date >= ? AND date <= ? AND status != 'cancelled'
       ORDER BY date ASC, updated_at DESC`
    ).all(scope.userId, scope.characterId, from, to) as PlanRow[];
    return plans.map(plan => {
      const tasks = getDatabase().prepare(
        'SELECT * FROM plan_tasks WHERE plan_id = ? ORDER BY order_index'
      ).all(plan.id) as PlanTaskRow[];
      return { ...plan, tasks };
    });
  },

  /**
   * V7: 按任务内容搜索计划。
   * 用于 PlanMemoryRetriever 和"我之前哪天安排了健身"等查询。
   * 只搜索非取消的计划。
   */
  searchPlans(scope: PlanScope, query: string, range?: { from: string; to: string }): PlanWithTasks[] {
    const queryParams: any[] = [scope.userId, scope.characterId, `%${query}%`];
    let dateFilter = '';
    if (range) {
      dateFilter = ' AND date >= ? AND date <= ?';
      queryParams.push(range.from, range.to);
    }
    const plans = getDatabase().prepare(
      `SELECT DISTINCT p.* FROM plans p
       INNER JOIN plan_tasks t ON t.plan_id = p.id
       WHERE p.user_id = ? AND p.character_id = ? AND t.content LIKE ? AND p.status != 'cancelled'
       ${dateFilter}
       ORDER BY p.date DESC`
    ).all(...queryParams) as PlanRow[];
    return plans.map(plan => {
      const tasks = getDatabase().prepare(
        'SELECT * FROM plan_tasks WHERE plan_id = ? ORDER BY order_index'
      ).all(plan.id) as PlanTaskRow[];
      return { ...plan, tasks };
    });
  },

  /**
   * V7: 获取月视图计划摘要。
   * 返回指定月份每天的计划状态和任务数量。
   * 不加载任务详情，仅返回摘要（用于月视图标记）。
   */
  getPlansForMonth(scope: PlanScope, year: number, month: number): Array<{
    id: string;
    date: string;
    status: PlanStatus;
    taskCount: number;
    completedCount: number;
  }> {
    const monthStr = `${year}-${String(month).padStart(2, '0')}`;
    const rows = getDatabase().prepare(
      `SELECT p.id, p.date, p.status,
              COUNT(t.id) as task_count,
              SUM(CASE WHEN t.completed = 1 THEN 1 ELSE 0 END) as completed_count
       FROM plans p
       LEFT JOIN plan_tasks t ON t.plan_id = p.id
       WHERE p.user_id = ? AND p.character_id = ? AND p.date LIKE ? AND p.status != 'cancelled'
       GROUP BY p.id
       ORDER BY p.date ASC`
    ).all(scope.userId, scope.characterId, `${monthStr}-%`) as Array<{
      id: string;
      date: string;
      status: PlanStatus;
      task_count: number;
      completed_count: number;
    }>;
    return rows.map(r => ({
      id: r.id,
      date: r.date,
      status: r.status,
      taskCount: r.task_count,
      completedCount: r.completed_count || 0
    }));
  },

  /**
   * V7: 获取指定日期需要激活的 scheduled 计划。
   * 由 CalendarActivationService 调用。
   */
  getScheduledPlansForDate(scope: PlanScope, date: string): PlanWithTasks[] {
    const plans = getDatabase().prepare(
      `SELECT * FROM plans
       WHERE user_id = ? AND character_id = ? AND date = ? AND status = 'scheduled'
       ORDER BY created_at ASC`
    ).all(scope.userId, scope.characterId, date) as PlanRow[];
    return plans.map(plan => {
      const tasks = getDatabase().prepare(
        'SELECT * FROM plan_tasks WHERE plan_id = ? ORDER BY order_index'
      ).all(plan.id) as PlanTaskRow[];
      return { ...plan, tasks };
    });
  },

  /**
   * V7: 按 scope 获取当前草案（不限日期）。
   * 向后兼容旧 getDraftPlan()，但按 scope 隔离。
   */
  getDraftPlanByScope(scope: PlanScope): PlanWithTasks | null {
    const plan = getDatabase().prepare(
      `SELECT * FROM plans
       WHERE user_id = ? AND character_id = ? AND status = 'draft'
       ORDER BY updated_at DESC LIMIT 1`
    ).get(scope.userId, scope.characterId) as PlanRow | undefined;
    if (!plan) return null;
    const tasks = getDatabase().prepare(
      'SELECT * FROM plan_tasks WHERE plan_id = ? ORDER BY order_index'
    ).all(plan.id) as PlanTaskRow[];
    return { ...plan, tasks };
  },

  /**
   * V7: 按 scope 获取当前 active 计划（不限日期）。
   * 向后兼容旧 getActivePlan()，但按 scope 隔离。
   */
  getActivePlanByScope(scope: PlanScope): PlanWithTasks | null {
    const plan = getDatabase().prepare(
      `SELECT * FROM plans
       WHERE user_id = ? AND character_id = ? AND status = 'active'
       ORDER BY updated_at DESC LIMIT 1`
    ).get(scope.userId, scope.characterId) as PlanRow | undefined;
    if (!plan) return null;
    const tasks = getDatabase().prepare(
      'SELECT * FROM plan_tasks WHERE plan_id = ? ORDER BY order_index'
    ).all(plan.id) as PlanTaskRow[];
    return { ...plan, tasks };
  }
};
