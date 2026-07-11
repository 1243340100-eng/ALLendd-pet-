/**
 * 节点：load_context
 * 加载会话上下文：Persona、最近消息、角色配置。
 */
import type { ConversationStateType, ConversationStateUpdate } from '../state';
import type { ChatMessage } from '../../../../shared/contracts/graph-state';
import { messageRepository } from '../../../../infrastructure/database/repositories/session-repository';
import { createLogger } from '../../../../infrastructure/logging/logger';

const log = createLogger('ConversationGraph:load_context');

/** 加载最近消息的最大数量 */
const MAX_RECENT_MESSAGES = 10;

export async function loadContext(
  state: ConversationStateType
): Promise<ConversationStateUpdate> {
  log.info('loading context', {
    traceId: state.traceId,
    fields: { sessionId: state.sessionId }
  });

  let messages: ChatMessage[] = state.messages;

  // 如果 state 中没有历史消息，从数据库加载
  if (messages.length === 0 && state.sessionId) {
    try {
      const rows = messageRepository.getBySession(state.sessionId, MAX_RECENT_MESSAGES);
      // 数据库按 created_at DESC 返回，需要反转为时间顺序
      messages = rows.reverse().map((r) => ({
        role: r.role as 'user' | 'assistant' | 'system',
        content: r.content,
        createdAt: r.created_at,
        memoryIds: r.memory_ids ? r.memory_ids.split(',').filter(Boolean) : undefined
      }));
      log.info('loaded messages from DB', {
        fields: { count: messages.length }
      });
    } catch (error) {
      log.warn('failed to load messages from DB', {
        fields: { error: (error as Error)?.message }
      });
    }
  }

  return { messages };
}
