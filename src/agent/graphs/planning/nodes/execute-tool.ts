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
    const action = state.agentAction;
    if (!action) {
      return {};
    }

    // 如果没有草案，但动作需要草案（patch/delete/add/publish），返回错误
    const requiresDraft = ['patch_tasks', 'delete_task', 'add_task', 'publish_plan'].includes(action.type);
    if (requiresDraft && !state.currentDraft) {
      return {
        errors: [...state.errors, {
          code: 'skill_input_invalid' as const,
          message: `动作 ${action.type} 需要已有草案`,
          node: 'execute_tool',
          recovered: true,
          occurredAt: new Date().toISOString()
        }],
        responseText: '还没有计划草案，请先告诉我你今天的目标。'
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
      log.warn('planning tool execution failed', {
        traceId: state.traceId,
        fields: { actionType: action.type, error: result.error }
      });
      return {
        errors: [...state.errors, {
          code: 'skill_input_invalid' as const,
          message: result.error ?? 'Planning tool execution failed',
          node: 'execute_tool',
          recovered: true,
          occurredAt: new Date().toISOString()
        }],
        responseText: result.error ?? '操作失败，请重试。'
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

    log.info('planning tool executed', {
      traceId: state.traceId,
      fields: {
        actionType: action.type,
        published: result.published ?? false,
        draftVersion: result.draft?.draftVersion
      }
    });

    return {
      currentDraft: result.draft ?? state.currentDraft,
      draftVersion: result.draft?.draftVersion ?? state.draftVersion,
      published: result.published ?? false
    };
  };
}
