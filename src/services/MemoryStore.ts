/**
 * MemoryStore：记忆管理。
 * 对应架构计划第 2.3 节。
 *
 * 职责：
 * - 管理全局用户档案
 * - 管理角色关系记忆
 * - 管理事件记忆
 * - 检索与当前消息相关的记忆
 * - 支持记忆 CRUD
 * - 支持导出和清空
 * - 强制执行角色隔离
 * - 保存记忆来源、置信度和更新时间
 */
import { memoryRepository, type MemoryRow } from '../infrastructure/database/repositories/memory-repository';
import { createLogger } from '../infrastructure/logging/logger';
import type { MemoryScope, MemoryType } from '../shared/constants';

const log = createLogger('MemoryStore');

export interface MemoryInput {
  id: string;
  userId: string;
  characterId?: string;
  scope: MemoryScope;
  type: MemoryType;
  content: string;
  structuredData?: string;
  confidence: number;
  sourceMessageId?: string;
}

export class MemoryStore {
  /** 添加记忆。强制角色隔离。 */
  add(input: MemoryInput): void {
    if (input.scope === 'global' && input.characterId) {
      throw new Error('Global memory must not have characterId');
    }
    const characterId = input.scope === 'global' ? null : input.characterId;
    if (input.scope === 'character' && !characterId) {
      throw new Error('Character memory requires characterId');
    }
    memoryRepository.insert({
      id: input.id,
      user_id: input.userId,
      character_id: characterId ?? null,
      scope: input.scope,
      type: input.type,
      content: input.content,
      structured_data: input.structuredData ?? null,
      confidence: input.confidence,
      source_message_id: input.sourceMessageId ?? null
    });
    log.info('memory added', {
      fields: { id: input.id, scope: input.scope, type: input.type }
    });
  }

  /** 检索当前用户+角色的记忆（含全局） */
  retrieve(userId: string, characterId: string, options?: {
    type?: MemoryType;
    keyword?: string;
    limit?: number;
  }): MemoryRow[] {
    if (options?.keyword) {
      return memoryRepository.search(userId, characterId, options.keyword, options.limit ?? 10);
    }
    return memoryRepository.listForCharacter(userId, characterId, {
      type: options?.type,
      limit: options?.limit ?? 20
    });
  }

  /** 编辑记忆（带作用域校验） */
  update(id: string, patch: { content?: string; confidence?: number; structuredData?: string }, context?: {
    userId?: string;
    characterId?: string;
  }): void {
    memoryRepository.update(id, {
      content: patch.content,
      confidence: patch.confidence,
      structured_data: patch.structuredData
    }, context);
  }

  /** 软删除单条（带作用域校验） */
  delete(id: string, context?: {
    userId?: string;
    characterId?: string;
  }): void {
    memoryRepository.softDelete(id, context);
  }

  /** 永久删除单条（带作用域校验） */
  purge(id: string, context?: {
    userId?: string;
    characterId?: string;
  }): void {
    memoryRepository.hardDelete(id, context);
  }

  /** 清空指定角色的记忆（保留全局） */
  clearCharacter(userId: string, characterId: string): number {
    const count = memoryRepository.clearCharacterMemories(userId, characterId);
    log.info('character memories cleared', {
      fields: { userId, characterId, count }
    });
    return count;
  }

  /** 清空全部记忆 */
  clearAll(userId: string): number {
    const count = memoryRepository.clearAllMemories(userId);
    log.info('all memories cleared', { fields: { userId, count } });
    return count;
  }

  /** 导出记忆为带版本号的 JSON */
  exportAll(userId: string): { schemaVersion: number; exportedAt: string; memories: MemoryRow[] } {
    return {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      memories: memoryRepository.exportAll(userId)
    };
  }

  /** 查看单条 */
  getById(id: string): MemoryRow | null {
    return memoryRepository.getById(id);
  }
}
