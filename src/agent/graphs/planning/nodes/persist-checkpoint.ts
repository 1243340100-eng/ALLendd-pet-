/**
 * persist_checkpoint 节点。
 * 保存或消费 checkpoint，支持重启后恢复规划对话。
 *
 * 要求 4：PlanningGraph 使用持久化 checkpoint 保存完整规划对话。
 * 测试要求：重启后恢复规划对话、草案版本和 active 气泡。
 */
import type { PlanningStateType } from '../state';
import { checkpointRepository } from '../../../../infrastructure/database/repositories/checkpoint-repository';
import { createLogger } from '../../../../infrastructure/logging/logger';

const log = createLogger('PlanningGraph:persistCheckpoint');

/** 修复 5：构建 scope_key */
function buildScopeKey(userId: string, characterId: string): string {
  return `${userId}:${characterId}`;
}

/** 创建 persist_checkpoint 节点 */
export function createPersistCheckpointNode() {
  return function persistCheckpoint(state: PlanningStateType): Partial<PlanningStateType> {
    // 修复 5：scope_key 按 userId + characterId 隔离
    const scopeKey = buildScopeKey(state.userId, state.characterId);

    // 如果已发布，消费 checkpoint（不再需要恢复）
    if (state.published) {
      if (state.checkpointId) {
        try {
          checkpointRepository.consume(state.checkpointId);
          log.info('checkpoint consumed after publish', {
            traceId: state.traceId,
            fields: { checkpointId: state.checkpointId }
          });
        } catch (error) {
          log.warn('failed to consume checkpoint', {
            fields: { error: (error as Error)?.message }
          });
        }
      }
      return {};
    }

    // 如果需要追问用户、等待确认、或有未发布的草案，保存 checkpoint
    if (state.shouldAskUser || state.awaitingConfirmation || (state.currentDraft && !state.published)) {
      const checkpointId = state.checkpointId || `planning-${state.traceId}-${Date.now()}`;
      try {
        const stateJson = JSON.stringify({
          messages: state.messages,
          currentDraft: state.currentDraft,
          draftVersion: state.draftVersion,
          userConfirmed: state.userConfirmed,
          awaitingConfirmation: state.awaitingConfirmation,
          userId: state.userId,
          characterId: state.characterId
        });
        const reason = state.shouldAskUser
          ? 'ask_clarification'
          : state.awaitingConfirmation
            ? 'awaiting_confirmation'
            : 'draft_pending';
        checkpointRepository.save({
          id: checkpointId,
          graph_type: 'planning',
          state_json: stateJson,
          reason,
          scope_key: scopeKey
        });
        log.info('checkpoint saved', {
          traceId: state.traceId,
          fields: {
            checkpointId,
            reason,
            scopeKey,
            messageCount: state.messages.length,
            draftVersion: state.draftVersion
          }
        });
        return { checkpointId };
      } catch (error) {
        log.warn('failed to save checkpoint', {
          fields: { error: (error as Error)?.message }
        });
      }
    }

    return {};
  };
}
