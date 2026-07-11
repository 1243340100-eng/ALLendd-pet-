/**
 * 主动策略 repository。
 * 从 proactive_policies 表加载用户配置的主动投递策略。
 * 对应架构计划第 5.3 节主动策略。
 */
import { getDatabase } from '../connection';
import type { ProactivePolicy } from '../../../shared/contracts/graph-state';

export interface ProactivePolicyRow {
  id: string;
  user_id: string;
  character_id: string;
  dnd_enabled: number;
  dnd_start: string;
  dnd_end: string;
  max_daily_proactive: number;
  ignore_threshold: number;
  system_notification_enabled: number;
  sound_enabled: number;
  updated_at: string;
}

/** 默认主动策略 */
export const DEFAULT_PROACTIVE_POLICY: ProactivePolicy = {
  dndEnabled: true,
  dndStart: '22:00',
  dndEnd: '08:00',
  maxDailyProactive: 5,
  ignoreThreshold: 2,
  systemNotificationEnabled: false,
  soundEnabled: false
};

function rowToPolicy(row: ProactivePolicyRow): ProactivePolicy {
  return {
    dndEnabled: row.dnd_enabled === 1,
    dndStart: row.dnd_start,
    dndEnd: row.dnd_end,
    maxDailyProactive: row.max_daily_proactive,
    ignoreThreshold: row.ignore_threshold,
    systemNotificationEnabled: row.system_notification_enabled === 1,
    soundEnabled: row.sound_enabled === 1
  };
}

export const proactivePolicyRepository = {
  /** 获取用户策略，不存在则返回默认 */
  get(userId: string, characterId: string): ProactivePolicy {
    const row = getDatabase().prepare(
      'SELECT * FROM proactive_policies WHERE user_id = ? AND character_id = ?'
    ).get(userId, characterId) as ProactivePolicyRow | undefined;

    if (!row) {
      return { ...DEFAULT_PROACTIVE_POLICY };
    }
    return rowToPolicy(row);
  },

  /** 保存或更新策略 */
  upsert(userId: string, characterId: string, policy: ProactivePolicy): void {
    const id = `pol-${userId}-${characterId}`;
    getDatabase().prepare(`
      INSERT INTO proactive_policies (id, user_id, character_id, dnd_enabled, dnd_start, dnd_end, max_daily_proactive, ignore_threshold, system_notification_enabled, sound_enabled, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(user_id, character_id) DO UPDATE SET
        dnd_enabled = excluded.dnd_enabled,
        dnd_start = excluded.dnd_start,
        dnd_end = excluded.dnd_end,
        max_daily_proactive = excluded.max_daily_proactive,
        ignore_threshold = excluded.ignore_threshold,
        system_notification_enabled = excluded.system_notification_enabled,
        sound_enabled = excluded.sound_enabled,
        updated_at = datetime('now')
    `).run(
      id, userId, characterId,
      policy.dndEnabled ? 1 : 0,
      policy.dndStart,
      policy.dndEnd,
      policy.maxDailyProactive,
      policy.ignoreThreshold,
      policy.systemNotificationEnabled ? 1 : 0,
      policy.soundEnabled ? 1 : 0
    );
  }
};
