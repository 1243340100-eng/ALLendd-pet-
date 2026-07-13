/**
 * Graph Checkpoint 仓库。
 * 对应架构计划第 8 节"部分 checkpoint 恢复"。
 *
 * 设计：
 * - 当 Graph 因需要追问用户而中断时，将状态序列化存入 graph_checkpoints 表
 * - 用户回复后，从 checkpoint 恢复状态继续执行
 * - 已消费的 checkpoint 标记 consumed_at，不删除（审计）
 */
import { getDatabase, transaction } from '../connection';

export interface CheckpointRow {
  id: string;
  graph_type: string;
  state_json: string;
  reason: string;
  created_at: string;
  consumed_at: string | null;
  /** 修复 5：scope_key 用于按 userId + characterId + planningThreadId 隔离 */
  scope_key?: string;
}

export const checkpointRepository = {
  /** 保存 checkpoint（Graph 中断时）。同 scope_key 的旧 checkpoint 自动标记消费。UPDATE+INSERT 在单一事务中。 */
  save(checkpoint: {
    id: string;
    graph_type: string;
    state_json: string;
    reason: string;
    scope_key?: string;
  }): void {
    const scopeKey = checkpoint.scope_key ?? '';
    transaction(() => {
      const db = getDatabase();
      // 先消费同 scope_key 的旧未消费 checkpoint，确保 getActiveByScope 只返回最新
      if (scopeKey) {
        db.prepare(`
          UPDATE graph_checkpoints SET consumed_at = datetime('now')
          WHERE graph_type = ? AND scope_key = ? AND consumed_at IS NULL
        `).run(checkpoint.graph_type, scopeKey);
      }
      db.prepare(`
        INSERT OR REPLACE INTO graph_checkpoints (id, graph_type, state_json, reason, scope_key)
        VALUES (@id, @graph_type, @state_json, @reason, @scope_key)
      `).run({
        ...checkpoint,
        scope_key: scopeKey
      });
    });
  },

  /** 按 ID 加载 checkpoint */
  load(id: string): CheckpointRow | null {
    const row = getDatabase().prepare(
      'SELECT * FROM graph_checkpoints WHERE id = ?'
    ).get(id) as CheckpointRow | undefined;
    return row ?? null;
  },

  /** 获取用户最新未消费的 checkpoint（全局，向后兼容） */
  getActive(graphType: string): CheckpointRow | null {
    const row = getDatabase().prepare(`
      SELECT * FROM graph_checkpoints
      WHERE graph_type = ? AND consumed_at IS NULL
      ORDER BY created_at DESC LIMIT 1
    `).get(graphType) as CheckpointRow | undefined;
    return row ?? null;
  },

  /**
   * 修复 5：按 scope_key 获取用户最新未消费的 checkpoint。
   * scope_key = `${userId}:${characterId}`，实现隔离。
   */
  getActiveByScope(graphType: string, scopeKey: string): CheckpointRow | null {
    const row = getDatabase().prepare(`
      SELECT * FROM graph_checkpoints
      WHERE graph_type = ? AND scope_key = ? AND consumed_at IS NULL
      ORDER BY created_at DESC LIMIT 1
    `).get(graphType, scopeKey) as CheckpointRow | undefined;
    return row ?? null;
  },

  /** 标记 checkpoint 已消费（用户已回复） */
  consume(id: string): void {
    getDatabase().prepare(
      'UPDATE graph_checkpoints SET consumed_at = datetime(\'now\') WHERE id = ?'
    ).run(id);
  },

  /** 清理已消费超过指定天数的 checkpoint */
  cleanConsumedBefore(daysOld: number): number {
    const result = getDatabase().prepare(`
      DELETE FROM graph_checkpoints
      WHERE consumed_at IS NOT NULL
        AND consumed_at < datetime('now', ?)
    `).run(`-${daysOld} days`);
    return result.changes;
  }
};
