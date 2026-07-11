/**
 * 提醒 repository。验证"重启后提醒仍存在"。
 * 包含提醒和提醒触发实例（防重复）。
 */
import { getDatabase, transaction } from '../connection';

export interface ReminderRow {
  id: string;
  user_id: string;
  character_id: string;
  content: string;
  trigger_at: string;
  timezone: string;
  is_repeating: number;
  recurrence_rule: string;
  priority: string;
  is_active: number;
  next_trigger_at: string;
  created_at: string;
  updated_at: string;
}

export interface ReminderOccurrenceRow {
  id: string;
  reminder_id: string;
  scheduled_at: string;
  delivered_at: string | null;
  delivery_status: string;
  created_at: string;
}

export const reminderRepository = {
  insert(reminder: Omit<ReminderRow, 'created_at' | 'updated_at'>): void {
    getDatabase().prepare(`
      INSERT INTO reminders (id, user_id, character_id, content, trigger_at, timezone, is_repeating, recurrence_rule, priority, is_active, next_trigger_at)
      VALUES (@id, @user_id, @character_id, @content, @trigger_at, @timezone, @is_repeating, @recurrence_rule, @priority, @is_active, @next_trigger_at)
    `).run(reminder);
  },

  getById(id: string): ReminderRow | null {
    return (getDatabase().prepare('SELECT * FROM reminders WHERE id = ?').get(id) as ReminderRow | undefined) ?? null;
  },

  getActiveReminders(): ReminderRow[] {
    return getDatabase().prepare('SELECT * FROM reminders WHERE is_active = 1 ORDER BY next_trigger_at').all() as ReminderRow[];
  },

  /** 获取到期待触发的提醒 */
  getDueReminders(now: string): ReminderRow[] {
    return getDatabase().prepare(
      'SELECT * FROM reminders WHERE is_active = 1 AND next_trigger_at <= ? ORDER BY next_trigger_at'
    ).all(now) as ReminderRow[];
  },

  updateNextTrigger(id: string, nextTriggerAt: string): void {
    getDatabase().prepare('UPDATE reminders SET next_trigger_at = ?, updated_at = datetime(\'now\') WHERE id = ?')
      .run(nextTriggerAt, id);
  },

  deactivate(id: string): void {
    getDatabase().prepare('UPDATE reminders SET is_active = 0, updated_at = datetime(\'now\') WHERE id = ?').run(id);
  },

  /**
   * 原子地插入触发实例并标记为"待投递"（pending）。
   * 基于 UNIQUE(reminder_id, scheduled_at) 约束保证同一提醒同一时间只投递一次。
   * 投递成功后需调用 markOccurrenceDelivered 更新状态。
   */
  markOccurrencePending(reminderId: string, scheduledAt: string): { inserted: boolean } {
    return transaction(() => {
      const existing = getDatabase().prepare(
        'SELECT id FROM reminder_occurrences WHERE reminder_id = ? AND scheduled_at = ?'
      ).get(reminderId, scheduledAt);
      if (existing) {
        return { inserted: false };
      }
      const occurrenceId = `occ-${reminderId}-${scheduledAt}`;
      getDatabase().prepare(`
        INSERT INTO reminder_occurrences (id, reminder_id, scheduled_at, delivered_at, delivery_status)
        VALUES (?, ?, ?, NULL, 'pending')
      `).run(occurrenceId, reminderId, scheduledAt);
      return { inserted: true };
    });
  },

  /**
   * 将待投递的触发实例标记为"已投递"（delivered）。
   * 在投递成功（outbox 写入 + handler 调用）后调用。
   */
  markOccurrenceDelivered(reminderId: string, scheduledAt: string): void {
    getDatabase().prepare(`
      UPDATE reminder_occurrences
      SET delivery_status = 'delivered', delivered_at = datetime('now')
      WHERE reminder_id = ? AND scheduled_at = ? AND delivery_status = 'pending'
    `).run(reminderId, scheduledAt);
  },

  hasOccurrenceBeenDelivered(reminderId: string, scheduledAt: string): boolean {
    const row = getDatabase().prepare(
      'SELECT id FROM reminder_occurrences WHERE reminder_id = ? AND scheduled_at = ? AND delivery_status = \'delivered\''
    ).get(reminderId, scheduledAt);
    return !!row;
  },

  delete(id: string): void {
    getDatabase().prepare('DELETE FROM reminders WHERE id = ?').run(id);
  }
};
