/**
 * load_planning_context 节点。
 * 加载 TimeService 当前时间、时区、用户资料和现有计划上下文。
 *
 * 要求 9：加入 TimeService 当前时间、时区、用户资料和现有计划上下文。
 */
import type { PlanningStateType } from '../state';
import type { TimeService } from '../../../../services/TimeService';
import type { UserContextService } from '../../../../services/UserContextService';
import { planRepository } from '../../../../infrastructure/database/repositories/plan-repository';
import { toPlanDraft } from '../tools';
import { createLogger } from '../../../../infrastructure/logging/logger';

const log = createLogger('PlanningGraph:loadContext');

/** 创建 load_planning_context 节点 */
export function createLoadPlanningContextNode(deps: {
  timeService: TimeService;
  userContextService: UserContextService;
}) {
  return function loadPlanningContext(state: PlanningStateType): Partial<PlanningStateType> {
    const phaseStartMs = Date.now();
    const timeContext = deps.timeService.getCurrentTimeContext();
    const userContext = deps.userContextService.load(state.userId);

    // 加载现有计划（active 或 draft）
    let existingPlan = planRepository.getActivePlan();
    if (!existingPlan) {
      existingPlan = planRepository.getDraftPlan();
    }

    // 如果状态中没有 currentDraft，但从数据库加载到了 draft，恢复它
    let currentDraft = state.currentDraft;
    if (!currentDraft && existingPlan && existingPlan.status === 'draft') {
      currentDraft = toPlanDraft(
        { id: existingPlan.id, date: existingPlan.date, tasks: existingPlan.tasks },
        existingPlan.draft_version ?? 1
      );
    }

    const durationMs = Date.now() - phaseStartMs;
    log.info('planning context loaded', {
      traceId: state.traceId,
      fields: {
        hasTime: !!timeContext,
        hasUser: !!userContext,
        existingPlanStatus: existingPlan?.status ?? 'none',
        draftVersion: currentDraft?.draftVersion ?? 0,
        durationMs
      }
    });

    return {
      timeContext,
      userContext,
      existingPlan,
      currentDraft,
      draftVersion: currentDraft?.draftVersion ?? state.draftVersion,
      // Trace: 记录 load_context 阶段
      tracePhases: [...state.tracePhases, {
        name: 'load_planning_context',
        success: true,
        durationMs
      }]
    };
  };
}
