/**
 * 事件 outbox repository。
 * 可靠事件投递和去重。对应计划第 8 节 event_outbox 表。
 */
import { getDatabase } from '../connection';

export interface EventOutboxRow {
  id: string;
  event_type: string;
  payload_json: string;
  dedupe_key: string | null;
  status: string;
  created_at: string;
  processed_at: string | null;
}

export const eventOutboxRepository = {
  /**
   * 投递事件。若 dedupeKey 已存在则跳过（去重）。
   */
  publish(event: {
    id: string;
    event_type: string;
    payload_json: string;
    dedupe_key?: string;
  }): { published: boolean } {
    try {
      getDatabase().prepare(`
        INSERT INTO event_outbox (id, event_type, payload_json, dedupe_key, status)
        VALUES (@id, @event_type, @payload_json, @dedupe_key, 'pending')
      `).run({
        ...event,
        dedupe_key: event.dedupe_key ?? null
      });
      return { published: true };
    } catch {
      // dedupe_key 唯一约束冲突 = 重复事件，跳过
      return { published: false };
    }
  },

  getPending(): EventOutboxRow[] {
    return getDatabase().prepare(
      'SELECT * FROM event_outbox WHERE status = \'pending\' ORDER BY created_at'
    ).all() as EventOutboxRow[];
  },

  markProcessed(id: string): void {
    getDatabase().prepare(
      'UPDATE event_outbox SET status = \'processed\', processed_at = datetime(\'now\') WHERE id = ?'
    ).run(id);
  }
};
