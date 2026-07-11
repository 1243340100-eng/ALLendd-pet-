/**
 * 记忆 repository。
 * 强制执行角色隔离：global 记忆 character_id 必须为空，
 * character 记忆必须包含 character_id。
 */
import { getDatabase } from '../connection';

export interface MemoryRow {
  id: string;
  user_id: string;
  character_id: string | null;
  scope: 'global' | 'character';
  type: 'profile' | 'preference' | 'event' | 'relationship' | 'project';
  content: string;
  structured_data: string | null;
  confidence: number;
  source_message_id: string | null;
  /** 记忆来源事件发生时间（精确到秒的 ISO 字符串） */
  source_occurred_at: string | null;
  /** 写入时使用的时区标识 */
  write_timezone: string | null;
  /** 来源角色：'user' | 'assistant' */
  source_role: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export const memoryRepository = {
  insert(memory: Omit<MemoryRow, 'created_at' | 'updated_at' | 'deleted_at' | 'source_occurred_at' | 'write_timezone' | 'source_role'> & {
    source_occurred_at?: string | null;
    write_timezone?: string | null;
    source_role?: string;
  }): void {
    // 强制角色隔离规则
    if (memory.scope === 'global' && memory.character_id !== null) {
      throw new Error('Global memory must have null character_id');
    }
    if (memory.scope === 'character' && !memory.character_id) {
      throw new Error('Character memory must have character_id');
    }
    const sourceOccurredAt = memory.source_occurred_at ?? null;
    const writeTimezone = memory.write_timezone ?? null;
    const sourceRole = memory.source_role ?? 'user';
    getDatabase().prepare(`
      INSERT INTO memories (id, user_id, character_id, scope, type, content, structured_data, confidence, source_message_id, source_occurred_at, write_timezone, source_role)
      VALUES (@id, @user_id, @character_id, @scope, @type, @content, @structured_data, @confidence, @source_message_id, @source_occurred_at, @write_timezone, @source_role)
    `).run({
      ...memory,
      character_id: memory.character_id ?? null,
      structured_data: memory.structured_data ?? null,
      source_message_id: memory.source_message_id ?? null,
      source_occurred_at: sourceOccurredAt,
      write_timezone: writeTimezone,
      source_role: sourceRole
    });
  },

  getById(id: string): MemoryRow | null {
    return (getDatabase().prepare('SELECT * FROM memories WHERE id = ?').get(id) as MemoryRow | undefined) ?? null;
  },

  /** 检索当前用户+角色的记忆（含全局记忆） */
  listForCharacter(userId: string, characterId: string, options?: {
    type?: string;
    limit?: number;
  }): MemoryRow[] {
    const limit = options?.limit ?? 50;
    if (options?.type) {
      return getDatabase().prepare(`
        SELECT * FROM memories
        WHERE user_id = ? AND deleted_at IS NULL
          AND (scope = 'global' OR character_id = ?)
          AND type = ?
        ORDER BY updated_at DESC LIMIT ?
      `).all(userId, characterId, options.type, limit) as MemoryRow[];
    }
    return getDatabase().prepare(`
      SELECT * FROM memories
      WHERE user_id = ? AND deleted_at IS NULL
        AND (scope = 'global' OR character_id = ?)
      ORDER BY updated_at DESC LIMIT ?
    `).all(userId, characterId, limit) as MemoryRow[];
  },

  /** 关键词检索 */
  search(userId: string, characterId: string, keyword: string, limit = 10): MemoryRow[] {
    return getDatabase().prepare(`
      SELECT * FROM memories
      WHERE user_id = ? AND deleted_at IS NULL
        AND (scope = 'global' OR character_id = ?)
        AND content LIKE ?
      ORDER BY confidence DESC, updated_at DESC LIMIT ?
    `).all(userId, characterId, `%${keyword}%`, limit) as MemoryRow[];
  },

  /**
   * 更新记忆（带作用域校验）。
   * 只有属于当前用户且属于当前角色（或全局）的记忆才能被修改。
   * 返回是否成功（changes === 1）。
   */
  update(id: string, patch: { content?: string; confidence?: number; structured_data?: string }, context?: {
    userId?: string;
    characterId?: string;
  }): boolean {
    const current = this.getById(id);
    if (!current) throw new Error(`Memory not found: ${id}`);

    // 如果提供了上下文，进行作用域校验
    if (context?.userId && context?.characterId) {
      const result = getDatabase().prepare(`
        UPDATE memories
        SET content = ?, confidence = ?, structured_data = ?, updated_at = datetime('now')
        WHERE id = ?
          AND user_id = ?
          AND (scope = 'global' OR character_id = ?)
          AND deleted_at IS NULL
      `).run(
        patch.content ?? current.content,
        patch.confidence ?? current.confidence,
        patch.structured_data ?? current.structured_data,
        id,
        context.userId,
        context.characterId
      );
      if (result.changes !== 1) {
        throw new Error(`Memory scope check failed: ${id} does not belong to user ${context.userId} / character ${context.characterId}`);
      }
      return true;
    }

    // 无上下文：保持向后兼容（内部调用，如 findDuplicate 更新）
    getDatabase().prepare(`
      UPDATE memories
      SET content = ?, confidence = ?, structured_data = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(
      patch.content ?? current.content,
      patch.confidence ?? current.confidence,
      patch.structured_data ?? current.structured_data,
      id
    );
    return true;
  },

  /**
   * 软删除（带作用域校验）。
   * 只有属于当前用户且属于当前角色（或全局）的记忆才能被删除。
   */
  softDelete(id: string, context?: {
    userId?: string;
    characterId?: string;
  }): boolean {
    if (context?.userId && context?.characterId) {
      const result = getDatabase().prepare(`
        UPDATE memories SET deleted_at = datetime('now')
        WHERE id = ?
          AND user_id = ?
          AND (scope = 'global' OR character_id = ?)
          AND deleted_at IS NULL
      `).run(id, context.userId, context.characterId);
      if (result.changes !== 1) {
        throw new Error(`Memory scope check failed: ${id} does not belong to user ${context.userId} / character ${context.characterId}`);
      }
      return true;
    }
    getDatabase().prepare('UPDATE memories SET deleted_at = datetime(\'now\') WHERE id = ?').run(id);
    return true;
  },

  /**
   * 物理删除（带作用域校验，永久清除）。
   * 只有属于当前用户且属于当前角色（或全局）的记忆才能被永久删除。
   */
  hardDelete(id: string, context?: {
    userId?: string;
    characterId?: string;
  }): boolean {
    if (context?.userId && context?.characterId) {
      const result = getDatabase().prepare(`
        DELETE FROM memories
        WHERE id = ?
          AND user_id = ?
          AND (scope = 'global' OR character_id = ?)
      `).run(id, context.userId, context.characterId);
      if (result.changes !== 1) {
        throw new Error(`Memory scope check failed: ${id} does not belong to user ${context.userId} / character ${context.characterId}`);
      }
      return true;
    }
    getDatabase().prepare('DELETE FROM memories WHERE id = ?').run(id);
    return true;
  },

  /** 清空指定角色的记忆（保留全局） */
  clearCharacterMemories(userId: string, characterId: string): number {
    const result = getDatabase().prepare(
      'UPDATE memories SET deleted_at = datetime(\'now\') WHERE user_id = ? AND character_id = ? AND deleted_at IS NULL'
    ).run(userId, characterId);
    return result.changes;
  },

  /** 清空全部记忆 */
  clearAllMemories(userId: string): number {
    const result = getDatabase().prepare(
      'UPDATE memories SET deleted_at = datetime(\'now\') WHERE user_id = ? AND deleted_at IS NULL'
    ).run(userId);
    return result.changes;
  },

  /** 导出（不含已删除） */
  exportAll(userId: string): MemoryRow[] {
    return getDatabase().prepare(
      'SELECT * FROM memories WHERE user_id = ? AND deleted_at IS NULL ORDER BY created_at'
    ).all(userId) as MemoryRow[];
  },

  /**
   * 查找内容相似的记忆（用于去重）。
   * 跨 scope 查找：检查全局记忆和当前角色记忆中是否有重复。
   */
  findDuplicate(
    userId: string,
    characterId: string,
    _scope: string,
    type: string,
    content: string
  ): MemoryRow | null {
    // 精确匹配优先（跨 scope 查找）
    const exact = getDatabase().prepare(`
      SELECT * FROM memories
      WHERE user_id = ? AND deleted_at IS NULL
        AND type = ?
        AND (scope = 'global' OR character_id = ?)
        AND content = ?
      LIMIT 1
    `).get(userId, type, characterId, content) as MemoryRow | undefined;
    if (exact) return exact;

    // 模糊匹配：新内容是已有记忆的子串或反之
    const candidates = getDatabase().prepare(`
      SELECT * FROM memories
      WHERE user_id = ? AND deleted_at IS NULL
        AND type = ?
        AND (scope = 'global' OR character_id = ?)
      LIMIT 50
    `).all(userId, type, characterId) as MemoryRow[];

    for (const row of candidates) {
      const newIncludesExisting = content.includes(row.content);
      const existingIncludesNew = row.content.includes(content);

      // 新内容包含已有内容（用户提供更多信息）— 只要已有内容至少 4 字符就视为重复
      if (newIncludesExisting && row.content.length >= 4) {
        return row;
      }

      // 已有内容包含新内容（用户提供更少信息）— 需要长度相似
      if (existingIncludesNew) {
        const lenDiff = Math.abs(row.content.length - content.length);
        const maxLen = Math.max(row.content.length, content.length);
        if (maxLen === 0 || lenDiff / maxLen <= 0.3) {
          return row;
        }
      }
    }

    return null;
  }
};
