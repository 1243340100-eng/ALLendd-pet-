/**
 * 节点：receive_chat
 * 接收用户消息，验证输入非空。
 */
import type { ConversationStateType, ConversationStateUpdate } from '../state';
import { createLogger } from '../../../../infrastructure/logging/logger';
import { GraphError } from '../../../../shared/contracts/errors';

const log = createLogger('ConversationGraph:receive_chat');

export async function receiveChat(
  state: ConversationStateType
): Promise<ConversationStateUpdate> {
  log.info('received chat', {
    traceId: state.traceId,
    fields: { inputLength: state.userInput.length }
  });

  if (!state.userInput || state.userInput.trim().length === 0) {
    log.warn('empty user input', { traceId: state.traceId });
    return {
      errors: [...state.errors, {
        code: 'ipc_validation_failed' as const,
        message: 'User input is empty',
        node: 'receive_chat',
        recovered: false,
        occurredAt: new Date().toISOString()
      }],
      responseText: '似乎没有收到消息内容，可以再说一次吗？',
      expression: 'waiting'
    };
  }

  return {};
}
