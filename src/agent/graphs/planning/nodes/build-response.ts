/**
 * build_response 节点。
 * 构建 PlanningResponseDTO 返回给 main.js IPC。
 *
 * 要求 11：计划模式增加独立消息历史，草案卡片与对话同时显示。
 * 要求 14：保留 Planning Bubble 的 renderer 展示职责，不把 UI 放进 Graph。
 */
import type { PlanningStateType, PlanningResponseDTO, PlanningTrace } from '../state';
import { sanitizePlanningTraceText } from '../sanitize';
import { createLogger } from '../../../../infrastructure/logging/logger';

const log = createLogger('PlanningGraph:buildResponse');

/** 创建 build_response 节点 */
export function createBuildResponseNode() {
  return function buildResponse(state: PlanningStateType): Partial<PlanningStateType> {
    const phaseStartMs = Date.now();
    const action = state.agentAction;
    const lastError = state.errors[state.errors.length - 1];

    // 阻断 2：根据当前 toolExecutionStatus 决定 ok，不根据历史 errors 判断
    const toolFailed = state.toolExecutionStatus === 'failed';
    const agentFailed = state.toolExecutionStatus === 'idle' && lastError?.recovered === false;
    const currentFailed = toolFailed || agentFailed;

    // 构建响应 DTO
    const dto: PlanningResponseDTO = {
      ok: !currentFailed,
      plan: state.currentDraft ?? undefined,
      message: state.responseText || (currentFailed ? (state.lastToolError || lastError?.message) : undefined),
      actionType: action?.type,
      awaitingConfirmation: state.published ? false : state.awaitingConfirmation,
      published: state.published,
      resolvedModel: state.resolvedModel || undefined,
      responseModel: state.responseModel || undefined
    };

    // 阻断 2：失败时设置 reason 为当前工具错误
    if (currentFailed) {
      dto.ok = false;
      dto.reason = state.lastToolError || lastError?.message || '操作失败';
    }

    // 更新独立消息历史
    const messages = [...state.messages];
    if (state.userInput) {
      messages.push({ role: 'user', content: state.userInput });
    }
    if (state.responseText) {
      messages.push({ role: 'assistant', content: state.responseText });
    }
    const trimmedMessages = messages.slice(-20);

    // 汇总 Planning Trace
    const completedAt = new Date().toISOString();
    const startedAtMs = new Date(state.startedAt).getTime();
    const totalDurationMs = Date.now() - startedAtMs;
    const configuredModel = state.configuredModel || '';
    const resolvedModel = state.resolvedModel || '';
    const responseModel = state.responseModel || '';
    // 三者一致性检查：非空且相等（responseModel 可能为空如果未调用模型）
    const modelConsistent = !!configuredModel &&
      configuredModel === resolvedModel &&
      (!responseModel || responseModel === resolvedModel);
    const finalResult: 'ok' | 'fail' | 'published' = state.published
      ? 'published'
      : currentFailed ? 'fail' : 'ok';

    const buildResponseDurationMs = Date.now() - phaseStartMs;

    const trace: PlanningTrace = {
      traceId: state.traceId,
      startedAt: state.startedAt,
      completedAt,
      totalDurationMs,
      configuredModel,
      resolvedModel,
      responseModel,
      modelConsistent,
      phases: [...state.tracePhases, {
        name: 'build_response',
        success: !currentFailed,
        actionType: action?.type,
        durationMs: buildResponseDurationMs
      }],
      modelCallCount: state.modelCallCount,
      inputTokens: state.lastInputTokens,
      outputTokens: state.lastOutputTokens,
      totalInputTokens: state.totalInputTokens,
      totalOutputTokens: state.totalOutputTokens,
      autoCorrectionCount: state.autoCorrectionCount,
      draftVersion: state.currentDraft?.draftVersion ?? state.draftVersion,
      finalResult,
      userConfirmed: state.userConfirmed,
      userInputSummary: sanitizePlanningTraceText(state.userInput, 80)
    };

    log.info('planning response built', {
      traceId: state.traceId,
      fields: {
        ok: dto.ok,
        actionType: dto.actionType,
        published: dto.published,
        messageCount: trimmedMessages.length,
        draftVersion: state.currentDraft?.draftVersion,
        modelConsistent,
        totalDurationMs,
        totalInputTokens: state.totalInputTokens,
        totalOutputTokens: state.totalOutputTokens
      }
    });

    return {
      responseDTO: dto,
      messages: trimmedMessages,
      planningTrace: trace
    };
  };
}
