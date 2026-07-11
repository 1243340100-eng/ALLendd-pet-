/**
 * 节点：load_completed_turn
 * 加载已完成的对话轮次数据。
 * 这是 ReflectionGraph 的入口节点。
 */
import type { ReflectionStateType, ReflectionStateUpdate } from '../state';
import { createLogger } from '../../../../infrastructure/logging/logger';

const log = createLogger('ReflectionGraph:load_completed_turn');

export async function loadCompletedTurn(
  state: ReflectionStateType
): Promise<ReflectionStateUpdate> {
  log.info('loading completed turn', {
    traceId: state.traceId,
    fields: {
      turnId: state.reflectionPayload.turnId,
      userMessageLength: state.reflectionPayload.userMessage.length,
      assistantReplyLength: state.reflectionPayload.assistantReply.length
    }
  });

  // 验证反思负载完整性
  const payload = state.reflectionPayload;
  if (!payload.userMessage || !payload.assistantReply) {
    log.warn('incomplete reflection payload, skipping', {
      traceId: state.traceId
    });
    return {
      candidates: [],
      reflectionResult: {
        extractedCount: 0,
        validCount: 0,
        insertedCount: 0,
        updatedCount: 0,
        duplicateCount: 0,
        filteredCount: 0,
        success: true,
        errorMessage: 'Incomplete payload, nothing to reflect on'
      }
    };
  }

  log.info('completed turn loaded', {
    traceId: state.traceId,
    fields: { turnId: payload.turnId }
  });

  return {};
}
