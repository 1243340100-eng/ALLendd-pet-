/**
 * Graph Checkpoint 仓库。
 * 对应架构计划第 8 节"部分 checkpoint 恢复"。
 *
 * 设计：
 * - 当 Graph 因需要追问用户而中断时，将状态序列化存入 graph_checkpoints 表
 * - 用户回复后，从 checkpoint 恢复状态继续执行
 * - 已消费的 checkpoint 标记 consumed_at，不删除（审计）
 */
import { getDatabase } from '../connection';

export interface CheckpointRow {
  id: string;
  graph_type: string;
  state_json: string;
  reason: string;
  created_at: string;
  consumed_at: string | null;
}

export const checkpointRepository = {
  /** 保存 checkpoint（Graph 中断时） */
  save(checkpoint: {
    id: string;
    graph_type: string;
    state_json: string;
    reason: string;
  }): void {
    getDatabase().prepare(`
      INSERT INTO graph_checkpoints (id, graph_type, state_json, reason)
      VALUES (@id, @graph_type, @state_json, @reason)
    `).run(checkpoint);
  },

  /** 按 ID 加载 checkpoint */
  load(id: string): CheckpointRow | null {
    const row = getDatabase().prepare(
      'SELECT * FROM graph_checkpoints WHERE id = ?'
    ).get(id) as CheckpointRow | undefined;
    return row ?? null;
  },

  /** 获取用户最新未消费的 checkpoint */
  getActive(graphType: string): CheckpointRow | null {
    const row = getDatabase().prepare(`
      SELECT * FROM graph_checkpoints
      WHERE graph_type = ? AND consumed_at IS NULL
      ORDER BY created_at DESC LIMIT 1
    `).get(graphType) as CheckpointRow | undefined;
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
