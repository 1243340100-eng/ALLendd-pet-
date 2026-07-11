/**
 * 节点：persist_messages
 * 将用户消息和助手回复保存到数据库。
 */
import type { ConversationStateType, ConversationStateUpdate } from '../state';
import { messageRepository, sessionRepository } from '../../../../infrastructure/database/repositories/session-repository';
import { createLogger } from '../../../../infrastructure/logging/logger';

const log = createLogger('ConversationGraph:persist_messages');

/** 生成唯一 ID */
function generateId(prefix: string): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${ts}-${rand}`;
}

export async function persistMessages(
  state: ConversationStateType
): Promise<ConversationStateUpdate> {
  log.info('persisting messages', {
    traceId: state.traceId,
    fields: { sessionId: state.sessionId }
  });

  const memoryIds = state.retrievedMemories.map((m) => m.id).join(',');
  const now = new Date().toISOString();

  try {
    // 保存用户消息
    messageRepository.insert({
      id: generateId('msg'),
      session_id: state.sessionId,
      user_id: state.userId,
      character_id: state.characterId,
      role: 'user',
      content: state.userInput,
      memory_ids: memoryIds || null
    });

    // 保存助手回复
    messageRepository.insert({
      id: generateId('msg'),
      session_id: state.sessionId,
      user_id: state.userId,
      character_id: state.characterId,
      role: 'assistant',
      content: state.responseDTO?.text ?? state.responseText,
      memory_ids: memoryIds || null
    });

    // 更新会话活跃时间
    sessionRepository.touch(state.sessionId);

    log.info('messages persisted', {
      fields: { userMessage: state.userInput.slice(0, 50) }
    });
  } catch (error) {
    log.error('failed to persist messages', {
      traceId: state.traceId,
      fields: { error: (error as Error)?.message }
    });
    // 持久化失败不中断流程，返回 DTO 已构建
    return {
      errors: [...state.errors, {
        code: 'database_error' as const,
        message: `Failed to persist messages: ${(error as Error)?.message}`,
        node: 'persist_messages',
        recovered: true,
        occurredAt: now
      }]
    };
  }

  return {};
}
