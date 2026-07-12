/**
 * load_calendar_context 节点（日历扩展）。
 *
 * 职责：
 * - 解析当前规划的目标日期（targetDate / selectedDate / 默认今天）
 * - 使用 validateTargetDate 校验目标日期
 * - 按 scope（userId + characterId）加载今天的 active 计划和目标日期的计划
 * - 设置 targetDateMode（future_date / today / past_date）
 *
 * 注意：
 * - 不信任模型输出的日期，todayDate 由 TimeService 提供
 * - 过去日期的查看允许，但创建/修改由 execute_tool 中的 validateTargetDate 拒绝
 * - 使用 scope 隔离查询，不使用全局 getActivePlan()/getDraftPlan()
 */
import type { PlanningStateType } from '../state';
import type { TimeService } from '../../../../services/TimeService';
import { planRepository } from '../../../../infrastructure/database/repositories/plan-repository';
import type { PlanScope } from '../../../../infrastructure/database/repositories/plan-repository';
import { validateTargetDate } from '../tools';
import { createLogger } from '../../../../infrastructure/logging/logger';

const log = createLogger('PlanningGraph:loadCalendarContext');

/** 创建 load_calendar_context 节点 */
export function createLoadCalendarContextNode(deps: {
  timeService: TimeService;
}) {
  return function loadCalendarContext(state: PlanningStateType): Partial<PlanningStateType> {
    const phaseStartMs = Date.now();
    const todayDate = deps.timeService.getTodayDateString();

    // 解析目标日期：优先使用 state.targetDate（由调用方传入），其次 selectedDate
    const rawTargetDate = state.targetDate || state.selectedDate || todayDate;

    // 校验目标日期
    const dateValidation = validateTargetDate(rawTargetDate, todayDate, { allowPast: true });
    if (!dateValidation.valid || !dateValidation.mode) {
      log.warn('target date invalid, falling back to today', {
        traceId: state.traceId,
        fields: { rawTargetDate, todayDate, error: dateValidation.error }
      });
      // 无效日期回退到今天
      const fallbackMode = 'today' as const;
      const scope: PlanScope = { userId: state.userId, characterId: state.characterId };
      const todayPlan = planRepository.getTodayActivePlan(scope, todayDate);
      const durationMs = Date.now() - phaseStartMs;
      return {
        targetDate: todayDate,
        targetDateMode: fallbackMode,
        todayPlan,
        selectedPlan: todayPlan,
        toolResult: '',
        tracePhases: [...state.tracePhases, {
          name: 'load_calendar_context',
          success: true,
          durationMs,
          error: dateValidation.error
        }]
      };
    }

    const targetDate = rawTargetDate;
    const mode = dateValidation.mode;
    const scope: PlanScope = { userId: state.userId, characterId: state.characterId };

    // 加载今天的 active 计划
    const todayPlan = planRepository.getTodayActivePlan(scope, todayDate);

    // 加载目标日期的计划
    let selectedPlan = null;
    if (mode === 'today') {
      selectedPlan = todayPlan;
    } else {
      // future_date 或 past_date：查询目标日期的 live 计划
      selectedPlan = planRepository.getPlanByDate(scope, targetDate);
    }

    // 如果没有 planningThreadId，根据目标日期生成
    const planningThreadId = state.planningThreadId || `date:${targetDate}`;

    const durationMs = Date.now() - phaseStartMs;
    log.info('calendar context loaded', {
      traceId: state.traceId,
      fields: {
        todayDate,
        targetDate,
        mode,
        hasTodayPlan: !!todayPlan,
        hasSelectedPlan: !!selectedPlan,
        selectedPlanStatus: selectedPlan?.status ?? 'none',
        planningThreadId,
        durationMs
      }
    });

    return {
      targetDate,
      targetDateMode: mode,
      planningThreadId,
      todayPlan,
      selectedPlan,
      toolResult: '',
      tracePhases: [...state.tracePhases, {
        name: 'load_calendar_context',
        success: true,
        durationMs
      }]
    };
  };
}
