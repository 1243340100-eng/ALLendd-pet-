/**
 * execute_tool 节点。
 * 执行经 Zod 校验后的 Planning Tool。
 *
 * 要求 6：不允许模型直接操作 repository 或执行 SQL。
 * 要求 7：所有写操作通过经过 Zod 校验的 Planning Tools。
 * 要求 8：publish_plan 必须要求明确用户确认；不能由模型擅自发布。
 * 要求 10：用户反馈优先 patch 当前草案，不默认删除全部任务重建。
 */
import type { PlanningStateType } from '../state';
import { executePlanningTool } from '../tools';
import { planRepository } from '../../../../infrastructure/database/repositories/plan-repository';
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

    // 如果没有草案，但动作需要草案（patch/delete/add/publish），返回错误
    const requiresDraft = ['patch_tasks', 'delete_task', 'add_task', 'publish_plan'].includes(action.type);
    if (requiresDraft && !state.currentDraft) {
      const durationMs = Date.now() - phaseStartMs;
      return {
        graphIterationCount,
        errors: [...state.errors, {
          code: 'skill_input_invalid' as const,
          message: `动作 ${action.type} 需要已有草案`,
          node: 'execute_tool',
          // 阻断 2：手动编辑失败不参与模型恢复，recovered=false
          recovered: state.isManualEdit ? false : true,
          occurredAt: new Date().toISOString()
        }],
        // 修复 2：注入 lastToolError 和 lastAttemptedAction 到下次模型上下文
        lastToolError: `动作 ${action.type} 需要已有草案`,
        lastAttemptedAction: action.type,
        // 阻断 1：明确覆盖工具执行状态
        toolExecutionStatus: 'failed' as const,
        responseText: '还没有计划草案，请先告诉我你今天的目标。',
        // Trace: 记录 execute_tool 失败
        tracePhases: [...state.tracePhases, {
          name: 'execute_tool',
          success: false,
          actionType: action.type,
          toolName: action.type,
          error: `动作 ${action.type} 需要已有草案`,
          durationMs
        }],
        // 自动修正次数 +1（非手动编辑时）
        autoCorrectionCount: state.isManualEdit ? state.autoCorrectionCount : state.autoCorrectionCount + 1
      };
    }

    // 获取或创建 plan ID 和 date
    const today = state.timeContext
      ? state.timeContext.localDisplay.slice(0, 10).replace(/-/g, '-')
      : new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });

    const planId = state.currentDraft?.planId ?? `plan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const date = state.currentDraft?.date ?? today;

    // 从时间上下文获取当前小时和分钟（用于校验过去时间）
    const currentTimeHour = state.timeContext
      ? parseInt(state.timeContext.localDisplay.slice(11, 13), 10)
      : new Date().getHours();
    const currentTimeMinute = state.timeContext
      ? parseInt(state.timeContext.localDisplay.slice(14, 16), 10)
      : new Date().getMinutes();

    // 执行 Planning Tool（Zod 校验已在 agent_decide 完成，此处执行写操作）
    const result = executePlanningTool(action, {
      planId,
      date,
      currentDraft: state.currentDraft,
      userConfirmed: state.userConfirmed,
      currentTimeHour,
      currentTimeMinute
    });

    if (!result.success) {
      const durationMs = Date.now() - phaseStartMs;
      log.warn('planning tool execution failed', {
        traceId: state.traceId,
        fields: { actionType: action.type, error: result.error }
      });
      return {
        graphIterationCount,
        errors: [...state.errors, {
          code: 'skill_input_invalid' as const,
          message: result.error ?? 'Planning tool execution failed',
          node: 'execute_tool',
          // 阻断 2：手动编辑失败不参与模型恢复，recovered=false
          recovered: state.isManualEdit ? false : true,
          occurredAt: new Date().toISOString()
        }],
        // 修复 2：注入 lastToolError 和 lastAttemptedAction 到下次模型上下文
        lastToolError: result.error ?? 'Planning tool execution failed',
        lastAttemptedAction: action.type,
        // 阻断 1：明确覆盖工具执行状态为 failed
        toolExecutionStatus: 'failed' as const,
        responseText: result.error ?? '操作失败，请重试。',
        // Trace: 记录 execute_tool 失败
        tracePhases: [...state.tracePhases, {
          name: 'execute_tool',
          success: false,
          actionType: action.type,
          toolName: action.type,
          error: (result.error ?? 'execution failed').slice(0, 200),
          durationMs
        }],
        // 自动修正次数 +1（非手动编辑时）
        autoCorrectionCount: state.isManualEdit ? state.autoCorrectionCount : state.autoCorrectionCount + 1
      };
    }

    // 修复 2：成功后清理已恢复错误，防止错误信息残留到后续轮次
    const lastError = state.errors[state.errors.length - 1];

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
      currentDraft: result.draft ?? state.currentDraft,
      draftVersion: result.draft?.draftVersion ?? state.draftVersion,
      published: result.published ?? false,
      // 修复 3：写入操作后进入 awaiting_confirmation
      awaitingConfirmation: shouldAwaitConfirmation ? true : state.awaitingConfirmation,
      // 修复 2：成功后清理 lastToolError，防止错误信息残留
      lastToolError: '',
      lastAttemptedAction: '',
      // 阻断 1：明确覆盖工具执行状态为 succeeded
      toolExecutionStatus: 'succeeded' as const,
      // Trace: 记录 execute_tool 成功
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
