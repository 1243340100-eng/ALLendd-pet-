/**
 * 节点：emit_response
 * 返回响应 DTO。
 *
 * Graph 失败不会导致聊天窗口卡死。
 * 如果 DTO 为空，返回安全的后备回复。
 */
import type { ConversationStateType, ConversationStateUpdate, ResponseDTO } from '../state';
import { DEFAULT_EXPRESSION, DEFAULT_MOTION } from '../state';
import { createLogger } from '../../../../infrastructure/logging/logger';

const log = createLogger('ConversationGraph:emit_response');

export async function emitResponse(
  state: ConversationStateType
): Promise<ConversationStateUpdate> {
  log.info('emitting response', {
    traceId: state.traceId
  });

  // 确保 DTO 存在
  let dto = state.responseDTO;
  if (!dto) {
    log.warn('no response DTO, creating fallback');
    dto = {
      text: state.responseText || '抱歉，我遇到了一些问题，请稍后再试。',
      expression: state.expression || DEFAULT_EXPRESSION,
      motion: state.motion || DEFAULT_MOTION
    };
  }

  // 如果有错误但 DTO 有效，确保 Graph 失败不导致卡死
  if (state.errors.length > 0) {
    log.info('emitting response with errors', {
      fields: { errorCount: state.errors.length }
    });
  }

  log.info('response emitted', {
    fields: {
      textLength: dto.text.length,
      expression: dto.expression,
      motion: dto.motion
    }
  });

  return { responseDTO: dto };
}
