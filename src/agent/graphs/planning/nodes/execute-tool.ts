/**
 * execute_tool 节点。
 * 执行经 Zod 校验后的 Planning Tool。
 *
 * 要求 6：不允许模型直接操作 repository 或执行 SQL。
 * 要求 7：所有写操作通过经过 Zod 校验的 Planning Tools。
 * 要求 8：publish_plan 必须要求明确用户确认；不能由模型擅自发布。
 * 要求 10：用户反馈优先 patch 当前草案，不默认删除全部任务重建。
 *
 * 日历扩展：
 * - 只读工具（get_plan_by_date 等）通过 executeReadonlyTool 执行，返回 toolResult
 * - 只读工具执行后设置 lastToolWasReadonly=true，由 graph 路由回 agent_decide
 * - cancel_plan 不需要 currentDraft，可通过 action.planId 取消指定计划
 */
import type { PlanningStateType } from '../state';
import { isReadonlyAction } from '../state';
import { executePlanningTool, executeReadonlyTool, validateTargetDate } from '../tools';
import { planRepository } from '../../../../infrastructure/database/repositories/plan-repository';
import type { PlanScope } from '../../../../infrastructure/database/repositories/plan-repository';
import { createLogger } from '../../../../infrastructure/logging/logger';

const log = createLogger('PlanningGraph:executeTool');

/** 创建 execute_tool 节点 */
export function createExecuteToolNode() {
  return function executeTool(state: PlanningStateType): Partial<PlanningStateType> {
    const phaseStartMs = Date.now();
    const action = state.agentAction;
    if (!action) {
      return {};
    }

    // graphIterationCount 每次进入 execute_tool 时递增（独立于 modelCallCount 的通用循环上限）
    const graphIterationCount = state.graphIterationCount + 1;
    const toolAttemptCount = state.toolAttemptCount + 1;

    // 日历扩展：只读工具走专用路径
    if (isReadonlyAction(action.type)) {
      const scope: PlanScope = { userId: state.userId, characterId: state.characterId };
      const readonlyResult = executeReadonlyTool(action, scope);
      const durationMs = Date.now() - phaseStartMs;

      if (!readonlyResult.success) {
        log.warn('readonly tool failed', {
          traceId: state.traceId,
          fields: { actionType: action.type, error: readonlyResult.error }
        });
        return {
          graphIterationCount,
          toolAttemptCount,
          lastToolWasReadonly: true,
          toolExecutionStatus: 'failed' as const,
          lastToolError: readonlyResult.error ?? '只读工具执行失败',
          lastAttemptedAction: action.type,
          toolResult: '',
          tracePhases: [...state.tracePhases, {
            name: 'execute_tool',
            success: false,
            actionType: action.type,
            toolName: action.type,
            error: (readonlyResult.error ?? 'readonly tool failed').slice(0, 200),
            durationMs
          }]
        };
      }

      log.info('readonly tool executed', {
        traceId: state.traceId,
        fields: {
          actionType: action.type,
          toolResultLength: readonlyResult.toolResult?.length ?? 0,
          durationMs
        }
      });

      return {
        graphIterationCount,
        toolAttemptCount,
        lastToolWasReadonly: true,
        toolExecutionStatus: 'succeeded' as const,
        toolResult: readonlyResult.toolResult ?? '',
        lastToolError: '',
        lastAttemptedAction: '',
        tracePhases: [...state.tracePhases, {
          name: 'execute_tool',
          success: true,
          actionType: action.type,
          toolName: action.type,
          durationMs
        }]
      };
    }

    // 日历扩展：cancel_plan 不需要 currentDraft
    const requiresDraft = ['patch_tasks', 'delete_task', 'add_task', 'publish_plan'].includes(action.type);
    if (requiresDraft && !state.currentDraft) {
      const durationMs = Date.now() - phaseStartMs;
      return {
        graphIterationCount,
        toolAttemptCount,
        errors: [...state.errors, {
          code: 'skill_input_invalid' as const,
          message: `动作 ${action.type} 需要已有草案`,
          node: 'execute_tool',
          recovered: state.isManualEdit ? false : true,
          occurredAt: new Date().toISOString()
        }],
        lastToolError: `动作 ${action.type} 需要已有草案`,
        lastAttemptedAction: action.type,
        toolExecutionStatus: 'failed' as const,
        responseText: '还没有计划草案，请先告诉我你今天的目标。',
        tracePhases: [...state.tracePhases, {
          name: 'execute_tool',
          success: false,
          actionType: action.type,
          toolName: action.type,
          error: `动作 ${action.type} 需要已有草案`,
          durationMs
        }],
        autoCorrectionCount: state.isManualEdit ? state.autoCorrectionCount : state.autoCorrectionCount + 1
      };
    }

    // 获取或创建 plan ID 和 date
    const today = state.timeContext
      ? state.timeContext.localDisplay.slice(0, 10).replace(/-/g, '-')
      : new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });

    const planId = state.currentDraft?.planId ?? action.planId ?? `plan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // V7 修复：优先使用 action.target_date（模型输出的目标日期），其次 state.targetDate（日历入口），
    // 最后今天。这样从计划模式输入框用自然语言指定未来日期时，date 和 mode 都正确。
    const effectiveTargetDate = action.target_date || state.targetDate || today;
    const date = state.currentDraft?.date ?? effectiveTargetDate;

    // 从时间上下文获取当前小时和分钟（用于校验过去时间）
    const currentTimeHour = state.timeContext
      ? parseInt(state.timeContext.localDisplay.slice(11, 13), 10)
      : new Date().getHours();
    const currentTimeMinute = state.timeContext
      ? parseInt(state.timeContext.localDisplay.slice(14, 16), 10)
      : new Date().getMinutes();

    // V7 修复：对所有写操作校验目标日期，并基于 action.target_date 重算 mode。
    // 之前只对 create_draft/publish_plan 校验，且传给 executePlanningTool 的 mode 取自
    // state.targetDateMode（load_calendar_context 设为 'today'），而非 action.target_date
    // 的实际 mode。导致从输入框说"明天"时，future_date 被错误按 today 校验。
    const writeActionTypes = ['create_draft', 'publish_plan', 'patch_tasks', 'add_task'];
    let effectiveMode: 'future_date' | 'today' | 'past_date' | undefined =
      (state.targetDateMode || undefined) as 'future_date' | 'today' | 'past_date' | undefined;

    if (writeActionTypes.includes(action.type)) {
      const dateValidation = validateTargetDate(effectiveTargetDate, today, { allowPast: false });
      if (!dateValidation.valid) {
        const durationMs = Date.now() - phaseStartMs;
        return {
          graphIterationCount,
          toolAttemptCount,
          errors: [...state.errors, {
            code: 'skill_input_invalid' as const,
            message: dateValidation.error!,
            node: 'execute_tool',
            recovered: state.isManualEdit ? false : true,
            occurredAt: new Date().toISOString()
          }],
          lastToolError: dateValidation.error!,
          lastAttemptedAction: action.type,
          toolExecutionStatus: 'failed' as const,
          responseText: dateValidation.error!,
          tracePhases: [...state.tracePhases, {
            name: 'execute_tool',
            success: false,
            actionType: action.type,
            toolName: action.type,
            error: dateValidation.error!.slice(0, 200),
            durationMs
          }],
          autoCorrectionCount: state.isManualEdit ? state.autoCorrectionCount : state.autoCorrectionCount + 1
        };
      }
      // V7 修复：用 action.target_date 计算的 mode 覆盖 state 的旧 mode
      if (dateValidation.mode) {
        effectiveMode = dateValidation.mode;
      }
    }

    // 执行 Planning Tool（Zod 校验已在 agent_decide 完成，此处执行写操作）
    // V7 修复：传入基于 action.target_date 重算的 effectiveMode
    const result = executePlanningTool(action, {
      planId,
      date,
      currentDraft: state.currentDraft,
      userConfirmed: state.userConfirmed,
      currentTimeHour,
      currentTimeMinute,
      scope: { userId: state.userId, characterId: state.characterId },
      targetDateMode: effectiveMode
    });

    if (!result.success) {
      const durationMs = Date.now() - phaseStartMs;
      log.warn('planning tool execution failed', {
        traceId: state.traceId,
        fields: { actionType: action.type, error: result.error }
      });
      return {
        graphIterationCount,
        toolAttemptCount,
        errors: [...state.errors, {
          code: 'skill_input_invalid' as const,
          message: result.error ?? 'Planning tool execution failed',
          node: 'execute_tool',
          recovered: state.isManualEdit ? false : true,
          occurredAt: new Date().toISOString()
        }],
        lastToolError: result.error ?? 'Planning tool execution failed',
        lastAttemptedAction: action.type,
        toolExecutionStatus: 'failed' as const,
        responseText: result.error ?? '操作失败，请重试。',
        tracePhases: [...state.tracePhases, {
          name: 'execute_tool',
          success: false,
          actionType: action.type,
          toolName: action.type,
          error: (result.error ?? 'execution failed').slice(0, 200),
          durationMs
        }],
        autoCorrectionCount: state.isManualEdit ? state.autoCorrectionCount : state.autoCorrectionCount + 1
      };
    }

    // 更新模型信息到数据库
    if (state.resolvedModel || state.responseModel) {
      try {
        planRepository.updateModelInfo(planId, state.resolvedModel || null, state.responseModel || null);
      } catch (error) {
        log.warn('failed to update model info', {
          fields: { error: (error as Error)?.message }
        });
      }
    }

    const durationMs = Date.now() - phaseStartMs;
    log.info('planning tool executed', {
      traceId: state.traceId,
      fields: {
        actionType: action.type,
        published: result.published ?? false,
        draftVersion: result.draft?.draftVersion,
        durationMs
      }
    });

    // 修复 3：create_draft 后自动进入 awaiting_confirmation
    const shouldAwaitConfirmation = action.type === 'create_draft' ||
      action.type === 'patch_tasks' ||
      action.type === 'add_task' ||
      action.type === 'delete_task';

    return {
      graphIterationCount,
      toolAttemptCount,
      currentDraft: result.draft ?? state.currentDraft,
      draftVersion: result.draft?.draftVersion ?? state.draftVersion,
      published: result.published ?? false,
      awaitingConfirmation: shouldAwaitConfirmation ? true : state.awaitingConfirmation,
      lastToolError: '',
      lastAttemptedAction: '',
      lastToolWasReadonly: false,
      toolExecutionStatus: 'succeeded' as const,
      tracePhases: [...state.tracePhases, {
        name: 'execute_tool',
        success: true,
        actionType: action.type,
        toolName: action.type,
        durationMs
      }]
    };
  };
}
