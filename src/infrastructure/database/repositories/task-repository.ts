/**
 * 任务 repository。
 * 查询今日任务和已过期未完成任务。
 * 对应 tasks 表。
 */
import { getDatabase } from '../connection';

export interface TaskRow {
  id: string;
  user_id: string;
  character_id: string;
  title: string;
  status: string;
  due_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export const taskRepository = {
  /** 获取今日到期任务 */
  getTodayTasks(userId: string, characterId: string, dayStart: string, dayEnd: string): TaskRow[] {
    return getDatabase().prepare(
      `SELECT * FROM tasks
       WHERE user_id = ? AND character_id = ?
       AND due_at IS NOT NULL AND due_at >= ? AND due_at <= ?
       AND status != 'completed'
       ORDER BY due_at`
    ).all(userId, characterId, dayStart, dayEnd) as TaskRow[];
  },

  /** 获取已过期未完成任务 */
  getOverdueTasks(userId: string, characterId: string, now: string): TaskRow[] {
    return getDatabase().prepare(
      `SELECT * FROM tasks
       WHERE user_id = ? AND character_id = ?
       AND due_at IS NOT NULL AND due_at < ?
       AND status != 'completed'
       ORDER BY due_at`
    ).all(userId, characterId, now) as TaskRow[];
  },

  /** 获取所有未完成任务 */
  getIncompleteTasks(userId: string, characterId: string): TaskRow[] {
    return getDatabase().prepare(
      `SELECT * FROM tasks
       WHERE user_id = ? AND character_id = ?
       AND status != 'completed'
       ORDER BY due_at`
    ).all(userId, characterId) as TaskRow[];
  },

  insert(task: Omit<TaskRow, 'created_at' | 'updated_at'>): void {
    getDatabase().prepare(`
      INSERT INTO tasks (id, user_id, character_id, title, status, due_at, completed_at)
      VALUES (@id, @user_id, @character_id, @title, @status, @due_at, @completed_at)
    `).run(task);
  },

  updateStatus(id: string, status: string): void {
    getDatabase().prepare(
      'UPDATE tasks SET status = ?, updated_at = datetime(\'now\') WHERE id = ?'
    ).run(status, id);
  }
};
