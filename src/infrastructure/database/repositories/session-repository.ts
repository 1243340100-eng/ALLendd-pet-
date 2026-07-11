/**
 * 会话和消息 repository。验证"重启后会话仍存在"。
 */
import { getDatabase } from '../connection';

export interface SessionRow {
  id: string;
  user_id: string;
  character_id: string;
  started_at: string;
  last_active_at: string;
  is_active: number;
}

export interface MessageRow {
  id: string;
  session_id: string;
  user_id: string;
  character_id: string;
  role: string;
  content: string;
  memory_ids: string | null;
  created_at: string;
}

export const sessionRepository = {
  insert(session: Omit<SessionRow, 'started_at' | 'last_active_at' | 'is_active'>): SessionRow {
    getDatabase().prepare(`
      INSERT INTO sessions (id, user_id, character_id) VALUES (?, ?, ?)
    `).run(session.id, session.user_id, session.character_id);
    return this.getById(session.id)!;
  },

  getById(id: string): SessionRow | null {
    return (getDatabase().prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow | undefined) ?? null;
  },

  getActiveSession(userId: string, characterId: string): SessionRow | null {
    return (getDatabase().prepare(
      'SELECT * FROM sessions WHERE user_id = ? AND character_id = ? AND is_active = 1 ORDER BY started_at DESC LIMIT 1'
    ).get(userId, characterId) as SessionRow | undefined) ?? null;
  },

  touch(id: string): void {
    getDatabase().prepare('UPDATE sessions SET last_active_at = datetime(\'now\') WHERE id = ?').run(id);
  },

  deactivate(id: string): void {
    getDatabase().prepare('UPDATE sessions SET is_active = 0 WHERE id = ?').run(id);
  }
};

export const messageRepository = {
  insert(msg: Omit<MessageRow, 'created_at'>): void {
    getDatabase().prepare(`
      INSERT INTO messages (id, session_id, user_id, character_id, role, content, memory_ids)
      VALUES (@id, @session_id, @user_id, @character_id, @role, @content, @memory_ids)
    `).run({
      ...msg,
      memory_ids: msg.memory_ids ?? null
    });
  },

  getBySession(sessionId: string, limit = 50): MessageRow[] {
    return getDatabase().prepare(
      'SELECT * FROM messages WHERE session_id = ? ORDER BY created_at DESC LIMIT ?'
    ).all(sessionId, limit) as MessageRow[];
  }
};
