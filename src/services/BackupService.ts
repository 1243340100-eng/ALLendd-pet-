/**
 * 用户数据备份与恢复服务。
 * 对应架构计划第 8 节"完成用户数据迁移和备份策略"。
 *
 * 职责：
 * - 导出全部用户数据（记忆、提醒、任务、会话、消息、设置）为可移植 JSON
 * - 从 JSON 恢复用户数据（用于迁移或灾难恢复）
 * - 导出文件不包含密钥、checkpoint 内部状态、模型用量统计
 */
import { getDatabase } from '../infrastructure/database/connection';
import { createLogger } from '../infrastructure/logging/logger';

const log = createLogger('BackupService');

/** 导出数据结构 */
export interface UserDataExport {
  schemaVersion: number;
  exportedAt: string;
  userId: string;
  memories: Array<{
    id: string;
    scope: string;
    type: string;
    content: string;
    structured_data: string | null;
    confidence: number;
    source_message_id: string | null;
    character_id: string | null;
    created_at: string;
    updated_at: string;
  }>;
  reminders: Array<{
    id: string;
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
  }>;
  tasks: Array<{
    id: string;
    character_id: string;
    title: string;
    status: string;
    due_at: string | null;
    completed_at: string | null;
    created_at: string;
  }>;
  sessions: Array<{
    id: string;
    character_id: string;
    started_at: string;
    last_active_at: string;
    is_active: number;
  }>;
  messages: Array<{
    id: string;
    session_id: string;
    character_id: string;
    role: string;
    content: string;
    memory_ids: string | null;
    created_at: string;
  }>;
  userProfiles: Array<{
    key: string;
    value: string;
    confidence: number;
    source: string;
    updated_at: string;
  }>;
  characterRelationships: Array<{
    character_id: string;
    key: string;
    value: string;
    updated_at: string;
  }>;
  settings: Array<{
    key: string;
    value: string;
  }>;
}

export const BackupService = {
  /** 导出指定用户的全部数据 */
  exportUserData(userId: string): UserDataExport {
    const db = getDatabase();
    log.info('exporting user data', { fields: { userId } });

    const memories = db.prepare(`
      SELECT id, scope, type, content, structured_data, confidence,
             source_message_id, character_id, created_at, updated_at
      FROM memories WHERE user_id = ? AND deleted_at IS NULL
      ORDER BY created_at
    `).all(userId) as UserDataExport['memories'];

    const reminders = db.prepare(`
      SELECT id, character_id, content, trigger_at, timezone, is_repeating,
             recurrence_rule, priority, is_active, next_trigger_at, created_at
      FROM reminders WHERE user_id = ?
      ORDER BY created_at
    `).all(userId) as UserDataExport['reminders'];

    const tasks = db.prepare(`
      SELECT id, character_id, title, status, due_at, completed_at, created_at
      FROM tasks WHERE user_id = ?
      ORDER BY created_at
    `).all(userId) as UserDataExport['tasks'];

    const sessions = db.prepare(`
      SELECT id, character_id, started_at, last_active_at, is_active
      FROM sessions WHERE user_id = ?
      ORDER BY started_at
    `).all(userId) as UserDataExport['sessions'];

    const sessionIds = sessions.map(s => s.id);
    let messages: UserDataExport['messages'] = [];
    if (sessionIds.length > 0) {
      const placeholders = sessionIds.map(() => '?').join(',');
      messages = db.prepare(`
        SELECT id, session_id, character_id, role, content, memory_ids, created_at
        FROM messages WHERE session_id IN (${placeholders})
        ORDER BY created_at
      `).all(...sessionIds) as UserDataExport['messages'];
    }

    const userProfiles = db.prepare(`
      SELECT key, value, confidence, source, updated_at
      FROM user_profiles WHERE user_id = ?
      ORDER BY key
    `).all(userId) as UserDataExport['userProfiles'];

    const characterRelationships = db.prepare(`
      SELECT character_id, key, value, updated_at
      FROM character_relationships WHERE user_id = ?
      ORDER BY character_id, key
    `).all(userId) as UserDataExport['characterRelationships'];

    const settings = db.prepare(`
      SELECT key, value FROM app_settings
      WHERE key NOT LIKE '%secret%' AND key NOT LIKE '%api_key%'
      ORDER BY key
    `).all() as UserDataExport['settings'];

    const exportData: UserDataExport = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      userId,
      memories,
      reminders,
      tasks,
      sessions,
      messages,
      userProfiles,
      characterRelationships,
      settings
    };

    log.info('user data exported', {
      fields: {
        userId,
        memories: memories.length,
        reminders: reminders.length,
        tasks: tasks.length,
        messages: messages.length
      }
    });

    return exportData;
  },

  /**
   * 从导出数据恢复用户数据。
   * 使用事务，全部成功才提交。已有同 ID 数据会被跳过。
   */
  importUserData(data: UserDataExport, userId: string): {
    imported: { memories: number; reminders: number; tasks: number; sessions: number; messages: number };
    skipped: number;
  } {
    const db = getDatabase();
    log.info('importing user data', {
      fields: {
        sourceUserId: data.userId,
        targetUserId: userId,
        schemaVersion: data.schemaVersion
      }
    });

    if (data.schemaVersion !== 1) {
      throw new Error(`Unsupported schema version: ${data.schemaVersion}`);
    }

    let imported = { memories: 0, reminders: 0, tasks: 0, sessions: 0, messages: 0 };
    let skipped = 0;

    const importTx = db.transaction(() => {
      // 记忆
      for (const m of data.memories) {
        const exists = db.prepare('SELECT 1 FROM memories WHERE id = ?').get(m.id);
        if (exists) { skipped++; continue; }
        db.prepare(`
          INSERT INTO memories (id, user_id, character_id, scope, type, content, structured_data, confidence, source_message_id, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(m.id, userId, m.character_id, m.scope, m.type, m.content,
              m.structured_data, m.confidence, m.source_message_id, m.created_at, m.updated_at);
        imported.memories++;
      }

      // 提醒
      for (const r of data.reminders) {
        const exists = db.prepare('SELECT 1 FROM reminders WHERE id = ?').get(r.id);
        if (exists) { skipped++; continue; }
        db.prepare(`
          INSERT INTO reminders (id, user_id, character_id, content, trigger_at, timezone, is_repeating, recurrence_rule, priority, is_active, next_trigger_at, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(r.id, userId, r.character_id, r.content, r.trigger_at, r.timezone,
              r.is_repeating, r.recurrence_rule, r.priority, r.is_active, r.next_trigger_at, r.created_at);
        imported.reminders++;
      }

      // 任务
      for (const t of data.tasks) {
        const exists = db.prepare('SELECT 1 FROM tasks WHERE id = ?').get(t.id);
        if (exists) { skipped++; continue; }
        db.prepare(`
          INSERT INTO tasks (id, user_id, character_id, title, status, due_at, completed_at, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(t.id, userId, t.character_id, t.title, t.status, t.due_at, t.completed_at, t.created_at);
        imported.tasks++;
      }

      // 会话
      for (const s of data.sessions) {
        const exists = db.prepare('SELECT 1 FROM sessions WHERE id = ?').get(s.id);
        if (exists) { skipped++; continue; }
        db.prepare(`
          INSERT INTO sessions (id, user_id, character_id, started_at, last_active_at, is_active)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(s.id, userId, s.character_id, s.started_at, s.last_active_at, s.is_active);
        imported.sessions++;
      }

      // 消息
      for (const msg of data.messages) {
        const exists = db.prepare('SELECT 1 FROM messages WHERE id = ?').get(msg.id);
        if (exists) { skipped++; continue; }
        db.prepare(`
          INSERT INTO messages (id, session_id, user_id, character_id, role, content, memory_ids, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(msg.id, msg.session_id, userId, msg.character_id, msg.role, msg.content, msg.memory_ids, msg.created_at);
        imported.messages++;
      }

      // 用户档案
      for (const p of data.userProfiles) {
        db.prepare(`
          INSERT OR REPLACE INTO user_profiles (user_id, key, value, confidence, source, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(userId, p.key, p.value, p.confidence, p.source, p.updated_at);
      }

      // 角色关系
      for (const r of data.characterRelationships) {
        db.prepare(`
          INSERT OR REPLACE INTO character_relationships (user_id, character_id, key, value, updated_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(userId, r.character_id, r.key, r.value, r.updated_at);
      }

      // 设置
      for (const s of data.settings) {
        db.prepare('INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime(\'now\'))')
          .run(s.key, s.value);
      }
    });

    importTx();

    log.info('user data imported', {
      fields: { imported, skipped }
    });

    return { imported, skipped };
  }
};
