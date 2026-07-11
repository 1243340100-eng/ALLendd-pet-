/**
 * Reflection 队列 repository。
 * 异步反思任务持久化，失败可重试，不影响聊天。
 */
import { getDatabase } from '../connection';

export interface ReflectionJobRow {
  id: string;
  turn_id: string;
  user_id: string;
  character_id: string;
  status: string;
  payload_json: string;
  attempts: number;
  last_error: string | null;
  created_at: string;
  next_retry_at: string | null;
  completed_at: string | null;
}

export const reflectionRepository = {
  enqueue(job: {
    id: string;
    turn_id: string;
    user_id: string;
    character_id: string;
    payload_json: string;
  }): void {
    getDatabase().prepare(`
      INSERT INTO reflection_jobs (id, turn_id, user_id, character_id, status, payload_json)
      VALUES (@id, @turn_id, @user_id, @character_id, 'pending', @payload_json)
    `).run(job);
  },

  /**
   * 原子地取出下一个待执行任务并标记为 processing。
   * 使用数据库事务确保 dequeue + markProcessing 不会被打断，
   * 避免并发或崩溃导致任务丢失。
   */
  dequeueAndMarkProcessing(): ReflectionJobRow | null {
    const db = getDatabase();
    const now = new Date().toISOString();
    return db.transaction(() => {
      const row = db.prepare(`
        SELECT * FROM reflection_jobs
        WHERE status = 'pending' AND (next_retry_at IS NULL OR next_retry_at <= ?)
        ORDER BY created_at LIMIT 1
      `).get(now) as ReflectionJobRow | undefined;
      if (!row) return null;
      db.prepare('UPDATE reflection_jobs SET status = \'processing\' WHERE id = ?').run(row.id);
      return row;
    })();
  },

  /** 取出下一个待执行的反思任务（不标记，仅查询） */
  dequeue(): ReflectionJobRow | null {
    const now = new Date().toISOString();
    const row = getDatabase().prepare(`
      SELECT * FROM reflection_jobs
      WHERE status = 'pending' AND (next_retry_at IS NULL OR next_retry_at <= ?)
      ORDER BY created_at LIMIT 1
    `).get(now) as ReflectionJobRow | undefined;
    return row ?? null;
  },

  markProcessing(id: string): void {
    getDatabase().prepare('UPDATE reflection_jobs SET status = \'processing\' WHERE id = ?').run(id);
  },

  markCompleted(id: string): void {
    getDatabase().prepare(
      'UPDATE reflection_jobs SET status = \'completed\', completed_at = datetime(\'now\') WHERE id = ?'
    ).run(id);
  },

  markFailed(id: string, error: string, nextRetryAt: string): void {
    getDatabase().prepare(`
      UPDATE reflection_jobs
      SET status = 'pending', attempts = attempts + 1, last_error = ?, next_retry_at = ?
      WHERE id = ?
    `).run(error, nextRetryAt, id);
  },

  /**
   * 启动时重置所有 processing 状态的任务为 pending。
   * 如果应用在任务标记为 processing 后崩溃，该任务重启后
   * 不会被 dequeue() 取出（查询只选 pending），导致永久卡住。
   * 此方法在 worker.start() 首次处理前调用，恢复卡住的任务。
   * 返回重置的任务数量。
   */
  resetProcessingJobs(): number {
    const result = getDatabase().prepare(`
      UPDATE reflection_jobs
      SET status = 'pending', attempts = attempts + 1, next_retry_at = datetime('now')
      WHERE status = 'processing'
    `).run();
    return result.changes;
  },

  getPendingCount(): number {
    const row = getDatabase().prepare('SELECT COUNT(*) as c FROM reflection_jobs WHERE status = \'pending\'').get() as any;
    return row?.c ?? 0;
  },

  /** 获取 processing 状态的任务数（用于测试和诊断） */
  getProcessingCount(): number {
    const row = getDatabase().prepare('SELECT COUNT(*) as c FROM reflection_jobs WHERE status = \'processing\'').get() as any;
    return row?.c ?? 0;
  }
};
