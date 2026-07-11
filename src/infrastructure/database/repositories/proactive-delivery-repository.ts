/**
 * 主动投递记录 repository。
 * 跟踪每日投递次数和忽略次数。
 * 对应 proactive_deliveries 表。
 */
import { getDatabase } from '../connection';

export interface ProactiveDeliveryRow {
  id: string;
  user_id: string;
  character_id: string;
  delivery_type: string;
  delivered_at: string;
  ignored: number;
  daily_date: string;
}

export const proactiveDeliveryRepository = {
  /** 记录一次投递 */
  record(delivery: Omit<ProactiveDeliveryRow, 'id' | 'delivered_at'>): void {
    const id = `del-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    getDatabase().prepare(`
      INSERT INTO proactive_deliveries (id, user_id, character_id, delivery_type, ignored, daily_date)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, delivery.user_id, delivery.character_id, delivery.delivery_type, delivery.ignored, delivery.daily_date);
  },

  /** 获取某类型今日投递次数 */
  getTodayCount(userId: string, characterId: string, deliveryType: string, dailyDate: string): number {
    const row = getDatabase().prepare(
      'SELECT COUNT(*) as count FROM proactive_deliveries WHERE user_id = ? AND character_id = ? AND delivery_type = ? AND daily_date = ?'
    ).get(userId, characterId, deliveryType, dailyDate) as { count: number };
    return row.count;
  },

  /** 获取某类型今日被忽略次数 */
  getTodayIgnoredCount(userId: string, characterId: string, deliveryType: string, dailyDate: string): number {
    const row = getDatabase().prepare(
      'SELECT COUNT(*) as count FROM proactive_deliveries WHERE user_id = ? AND character_id = ? AND delivery_type = ? AND daily_date = ? AND ignored = 1'
    ).get(userId, characterId, deliveryType, dailyDate) as { count: number };
    return row.count;
  },

  /** 获取今日总主动投递次数 */
  getTodayTotalCount(userId: string, characterId: string, dailyDate: string): number {
    const row = getDatabase().prepare(
      `SELECT COUNT(*) as count FROM proactive_deliveries 
       WHERE user_id = ? AND character_id = ? AND daily_date = ? AND delivery_type != 'reminder'`
    ).get(userId, characterId, dailyDate) as { count: number };
    return row.count;
  },

  /** 标记投递为已忽略 */
  markIgnored(id: string): void {
    getDatabase().prepare('UPDATE proactive_deliveries SET ignored = 1 WHERE id = ?').run(id);
  },

  /** 获取今日所有投递 */
  getTodayDeliveries(userId: string, characterId: string, dailyDate: string): ProactiveDeliveryRow[] {
    return getDatabase().prepare(
      'SELECT * FROM proactive_deliveries WHERE user_id = ? AND character_id = ? AND daily_date = ? ORDER BY delivered_at'
    ).all(userId, characterId, dailyDate) as ProactiveDeliveryRow[];
  }
};
