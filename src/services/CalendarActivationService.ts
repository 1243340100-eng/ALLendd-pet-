/**
 * CalendarActivationService — 每日计划激活服务。
 *
 * 职责（规格第七节）：
 * 1. 应用启动后检查本地今天日期
 * 2. 应用运行跨日时再次检查
 * 3. 查询今天 scheduled 计划
 * 4. 原子地转换为 active（planRepository.activatePlan 已原子化）
 * 5. 通过 event_outbox 写入幂等事件（dedupeKey = daily_plan:${planId}:${date}）
 * 6. 触发 ProactiveGraph 的 daily_plan 事件（由 caller 处理）
 * 7. 通知 renderer 刷新计划气泡（由 caller 处理）
 * 8. 同一 planId + date 只能激活和通知一次（dedupeKey 保证）
 *
 * 幂等机制：
 * - activatePlan SQL WHERE status='scheduled' 保证只会转换一次
 * - event_outbox dedupeKey = daily_plan:${planId}:${date} 保证事件只发布一次
 * - 即使服务重复调用，也不会重复激活或重复通知
 *
 * 不做的事：
 * - 不调用模型（ProactiveGraph 负责生成符合角色人格的提示）
 * - 不直接操作 UI（caller 负责 renderer 刷新）
 * - 不为每个任务创建 reminder（除非用户明确单独设置提醒）
 */
import { planRepository } from '../infrastructure/database/repositories/plan-repository';
import type { PlanScope, PlanWithTasks } from '../infrastructure/database/repositories/plan-repository';
import { eventOutboxRepository } from '../infrastructure/database/repositories/event-outbox-repository';
import type { TimeService } from './TimeService';
import { createLogger } from '../infrastructure/logging/logger';

const log = createLogger('CalendarActivationService');

/** 激活结果 */
export interface ActivationResult {
  /** 本次激活的计划列表（可能为空，表示没有需要激活的 scheduled 计划） */
  activatedPlans: PlanWithTasks[];
  /** 本次跳过的计划（已经激活过的，幂等跳过） */
  skippedCount: number;
  /** 今天的本地日期 YYYY-MM-DD */
  todayDate: string;
}

export class CalendarActivationService {
  private timeService: TimeService;
  /** 上次检查的日期（用于跨日检测） */
  private lastCheckedDate: string = '';

  constructor(timeService: TimeService) {
    this.timeService = timeService;
  }

  /**
   * 激活今天的 scheduled 计划。
   *
   * 幂等：同一 planId + date 只会激活一次。
   * activatePlan 的 SQL WHERE status='scheduled' 保证原子性，
   * event_outbox 的 dedupeKey 保证事件只发布一次。
   *
   * @param scope 用户 + 角色隔离
   * @returns 激活结果，包含本次激活的计划列表
   */
  activateTodayPlans(scope: PlanScope): ActivationResult {
    const todayDate = this.timeService.getTodayDateString();
    this.lastCheckedDate = todayDate;

    // 查询今天所有 scheduled 计划
    const scheduledPlans = planRepository.getScheduledPlansForDate(scope, todayDate);

    if (scheduledPlans.length === 0) {
      log.info('no scheduled plans to activate', {
        fields: { todayDate, userId: scope.userId, characterId: scope.characterId }
      });
      return { activatedPlans: [], skippedCount: 0, todayDate };
    }

    const activatedPlans: PlanWithTasks[] = [];
    let skippedCount = 0;

    for (const plan of scheduledPlans) {
      // 原子转换 scheduled → active
      // activatePlan 的 SQL WHERE status='scheduled' 保证只会成功一次
      const activated = planRepository.activatePlan(plan.id);
      if (!activated) {
        // 已经激活过（幂等跳过）
        skippedCount++;
        log.debug('plan already activated, skipping', {
          fields: { planId: plan.id, date: todayDate }
        });
        continue;
      }

      // 写入 event_outbox 幂等事件
      // dedupeKey = daily_plan:${planId}:${date} 保证同一计划同一天只通知一次
      const dedupeKey = `daily_plan:${plan.id}:${todayDate}`;
      const eventId = `evt-daily-plan-${plan.id}-${todayDate}`;
      const eventPayload = JSON.stringify({
        planId: plan.id,
        date: todayDate,
        userId: scope.userId,
        characterId: scope.characterId,
        taskCount: plan.tasks.length,
        taskSummary: plan.tasks.map(t => ({
          content: t.content,
          startTime: t.start_time,
          endTime: t.end_time,
          completed: t.completed === 1
        }))
      });

      const publishResult = eventOutboxRepository.publish({
        id: eventId,
        event_type: 'daily_plan_due',
        payload_json: eventPayload,
        dedupe_key: dedupeKey
      });

      activatedPlans.push(plan);

      log.info('plan activated', {
        fields: {
          planId: plan.id,
          date: todayDate,
          taskCount: plan.tasks.length,
          eventPublished: publishResult.published,
          dedupeKey
        }
      });
    }

    log.info('activation complete', {
      fields: {
        todayDate,
        totalScheduled: scheduledPlans.length,
        activated: activatedPlans.length,
        skipped: skippedCount
      }
    });

    return { activatedPlans, skippedCount, todayDate };
  }

  /**
   * 检测跨日：如果上次检查的日期与今天不同，返回 true。
   * 用于应用运行中跨日时再次激活。
   */
  hasDateChanged(): boolean {
    const todayDate = this.timeService.getTodayDateString();
    return this.lastCheckedDate !== '' && this.lastCheckedDate !== todayDate;
  }

  /**
   * 启动跨日检测定时器。
   * 每 5 分钟检查一次日期是否变化，变化时触发激活。
   *
   * @param scope 用户 + 角色隔离
   * @param onActivated 激活回调（caller 负责 ProactiveGraph 触发和 renderer 刷新）
   * @returns 定时器 ID（用于停止）
   */
  startCrossDayWatcher(
    scope: PlanScope,
    onActivated: (result: ActivationResult) => void
  ): ReturnType<typeof setInterval> {
    const CHECK_INTERVAL_MS = 300_000; // 5 分钟

    const timer = setInterval(() => {
      if (this.hasDateChanged()) {
        log.info('cross-day detected, activating plans', {
          fields: {
            lastCheckedDate: this.lastCheckedDate,
            todayDate: this.timeService.getTodayDateString()
          }
        });
        try {
          const result = this.activateTodayPlans(scope);
          if (result.activatedPlans.length > 0) {
            onActivated(result);
          }
        } catch (error) {
          log.error('cross-day activation failed', {
            fields: { error: (error as Error)?.message }
          });
        }
      }
    }, CHECK_INTERVAL_MS);

    log.info('cross-day watcher started', {
      fields: { checkIntervalMs: CHECK_INTERVAL_MS }
    });

    return timer;
  }
}
