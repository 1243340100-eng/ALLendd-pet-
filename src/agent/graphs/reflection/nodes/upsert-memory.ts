/**
 * 节点：upsert_memory
 * 将记忆候选写入数据库。
 * 新记忆插入，已有重复的更新。
 */
import type { ReflectionStateType, ReflectionStateUpdate, MemoryCandidate } from '../state';
import { memoryRepository } from '../../../../infrastructure/database/repositories/memory-repository';
import { createLogger } from '../../../../infrastructure/logging/logger';

const log = createLogger('ReflectionGraph:upsert_memory');

/** 生成唯一 ID */
function generateId(prefix: string): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${ts}-${rand}`;
}

export async function upsertMemory(
  state: ReflectionStateType
): Promise<ReflectionStateUpdate> {
  log.info('upserting memories', {
    traceId: state.traceId,
    fields: { count: state.newCandidates.length }
  });

  // 如果已经结束，跳过
  if (state.reflectionResult) {
    return {};
  }

  const savedCandidates: MemoryCandidate[] = [];

  for (const candidate of state.newCandidates) {
    try {
      // 如果有重复 ID 且内容更丰富，更新已有记忆
      if (candidate.duplicateOfId) {
        memoryRepository.update(candidate.duplicateOfId, {
          content: candidate.content,
          confidence: candidate.confidence
        });
        savedCandidates.push({
          ...candidate,
          savedId: candidate.duplicateOfId,
          updated: true
        });
        log.info('memory updated', {
          traceId: state.traceId,
          fields: { id: candidate.duplicateOfId }
        });
      } else {
        // 新记忆
        const id = generateId('mem');
        const charId = candidate.scope === 'global' ? null : state.characterId;
        // 使用 payload 中的消息时间（如有），否则回退到 graph 开始时间
        const sourceOccurredAt = (state.reflectionPayload as any)?.occurredAt ?? state.startedAt;
        // 写入时区：精确到秒的本地时区标识
        const writeTimezone = new Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
        memoryRepository.insert({
          id,
          user_id: state.userId,
          character_id: charId,
          scope: candidate.scope,
          type: candidate.type,
          content: candidate.content,
          structured_data: null,
          confidence: candidate.confidence,
          source_message_id: state.reflectionPayload.turnId,
          source_occurred_at: sourceOccurredAt,
          write_timezone: writeTimezone,
          source_role: candidate.sourceRole ?? 'user'
        });
        savedCandidates.push({
          ...candidate,
          savedId: id,
          updated: false
        });
        log.info('memory inserted', {
          traceId: state.traceId,
          fields: { id, scope: candidate.scope, type: candidate.type }
        });
      }
    } catch (error) {
      log.warn('failed to upsert memory', {
        traceId: state.traceId,
        fields: {
          error: (error as Error)?.message,
          content: candidate.content.slice(0, 50)
        }
      });
    }
  }

  log.info('upsert complete', {
    traceId: state.traceId,
    fields: {
      inserted: savedCandidates.filter(c => !c.updated).length,
      updated: savedCandidates.filter(c => c.updated).length
    }
  });

  return { savedCandidates };
}
