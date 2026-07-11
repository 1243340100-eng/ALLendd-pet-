/**
 * build_response 节点。
 * 构建 PlanningResponseDTO 返回给 main.js IPC。
 *
 * 要求 11：计划模式增加独立消息历史，草案卡片与对话同时显示。
 * 要求 14：保留 Planning Bubble 的 renderer 展示职责，不把 UI 放进 Graph。
 */
import type { PlanningStateType, PlanningResponseDTO } from '../state';
import { createLogger } from '../../../../infrastructure/logging/logger';

const log = createLogger('PlanningGraph:buildResponse');

/** 创建 build_response 节点 */
export function createBuildResponseNode() {
  return function buildResponse(state: PlanningStateType): Partial<PlanningStateType> {
    const action = state.agentAction;
    const hasErrors = state.errors.length > 0;
    const lastError = state.errors[state.errors.length - 1];

    // 构建响应 DTO
    const dto: PlanningResponseDTO = {
      ok: !hasErrors || (lastError?.recovered ?? false),
      plan: state.currentDraft ?? undefined,
      message: state.responseText || (hasErrors ? lastError?.message : undefined),
      actionType: action?.type,
      awaitingConfirmation: state.awaitingConfirmation,
      published: state.published,
      resolvedModel: state.resolvedModel || undefined,
      responseModel: state.responseModel || undefined
    };

    // 如果有未恢复的错误，设置 reason
    if (hasErrors && !lastError?.recovered) {
      dto.ok = false;
      dto.reason = lastError?.message;
    }

    // 更新独立消息历史
    const messages = [...state.messages];
    // 添加用户消息
    if (state.userInput) {
      messages.push({ role: 'user', content: state.userInput });
    }
    // 添加助手回复
    if (state.responseText) {
      messages.push({ role: 'assistant', content: state.responseText });
    }
    // 限制历史长度，保留最近 20 条
    const trimmedMessages = messages.slice(-20);

    log.info('planning response built', {
      traceId: state.traceId,
      fields: {
        ok: dto.ok,
        actionType: dto.actionType,
        published: dto.published,
        messageCount: trimmedMessages.length,
        draftVersion: state.currentDraft?.draftVersion
      }
    });

    return {
      responseDTO: dto,
      messages: trimmedMessages
    };
  };
}
