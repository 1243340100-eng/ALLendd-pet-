/**
 * 节点：record_result
 * 记录反思结果，汇总统计信息。
 * 这是 ReflectionGraph 的最终节点。
 */
import type { ReflectionStateType, ReflectionStateUpdate, ReflectionResult } from '../state';
import { createLogger } from '../../../../infrastructure/logging/logger';

const log = createLogger('ReflectionGraph:record_result');

export async function recordResult(
  state: ReflectionStateType
): Promise<ReflectionStateUpdate> {
  log.info('recording reflection result', {
    traceId: state.traceId
  });

  // 如果已经因为负载不完整而结束，保留已有结果
  if (state.reflectionResult) {
    log.info('reflection already concluded, keeping existing result');
    return {};
  }

  const extractedCount = state.candidates.length;
  const validCount = state.validCandidates.length;
  const filteredCount = extractedCount - validCount;
  const insertedCount = state.savedCandidates.filter(c => !c.updated && c.savedId).length;
  const updatedCount = state.savedCandidates.filter(c => c.updated && c.savedId).length;
  // 重复数 = 有效候选数 - 非重复候选数（非重复 = newCandidates 中无 duplicateOfId 的）
  const nonDuplicates = state.newCandidates.filter(c => !c.duplicateOfId).length;
  const duplicateCount = state.validCandidates.length - nonDuplicates;

  const result: ReflectionResult = {
    extractedCount,
    validCount,
    insertedCount,
    updatedCount,
    duplicateCount,
    filteredCount,
    success: true
  };

  log.info('reflection result recorded', {
    traceId: state.traceId,
    fields: { ...result }
  });

  return { reflectionResult: result };
}
