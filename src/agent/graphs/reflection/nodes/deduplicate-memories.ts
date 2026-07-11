/**
 * 节点：deduplicate_memories
 * 检查已有记忆，避免重复写入。
 * 使用 memoryRepository.findDuplicate 查找相似记忆。
 */
import type { ReflectionStateType, ReflectionStateUpdate, MemoryCandidate } from '../state';
import { memoryRepository } from '../../../../infrastructure/database/repositories/memory-repository';
import { createLogger } from '../../../../infrastructure/logging/logger';

const log = createLogger('ReflectionGraph:deduplicate_memories');

export async function deduplicateMemories(
  state: ReflectionStateType
): Promise<ReflectionStateUpdate> {
  log.info('deduplicating memories', {
    traceId: state.traceId,
    fields: { count: state.validCandidates.length }
  });

  // 如果已经结束，跳过
  if (state.reflectionResult) {
    return {};
  }

  const newCandidates: MemoryCandidate[] = [];
  let duplicateCount = 0;

  for (const candidate of state.validCandidates) {
    try {
      const existing = memoryRepository.findDuplicate(
        state.userId,
        state.characterId,
        candidate.scope,
        candidate.type,
        candidate.content
      );

      if (existing) {
        duplicateCount++;
        // 重复但内容更长时，标记为需要更新
        if (candidate.content.length > existing.content.length) {
          newCandidates.push({
            ...candidate,
            duplicateOfId: existing.id,
            updated: false // 将在 upsert 阶段更新
          });
          log.info('duplicate found, will update with richer content', {
            traceId: state.traceId,
            fields: { existingId: existing.id }
          });
        } else {
          log.info('duplicate found, skipping', {
            traceId: state.traceId,
            fields: { existingId: existing.id }
          });
        }
      } else {
        newCandidates.push(candidate);
      }
    } catch (error) {
      log.warn('dedup check failed, treating as new', {
        traceId: state.traceId,
        fields: { error: (error as Error)?.message }
      });
      newCandidates.push(candidate);
    }
  }

  log.info('deduplication complete', {
    traceId: state.traceId,
    fields: {
      new: newCandidates.length,
      duplicates: duplicateCount
    }
  });

  return { newCandidates };
}
