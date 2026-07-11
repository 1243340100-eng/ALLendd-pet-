/**
 * ReminderSchedulerBridge：技能与调度器之间的桥接模块。
 *
 * 问题：create-reminder 技能（src/skills/）直接调用 reminderRepository.insert()
 * 写入数据库，但无法访问 SchedulerService 实例来启动定时器。
 * 此 bridge 模块通过模块级引用解决循环依赖问题。
 *
 * 使用方式：
 * - integration.ts 初始化时调用 setSchedulerInstance(scheduler)
 * - create-reminder 技能 insert 后调用 notifyReminderCreated(reminderId)
 * - bridge 加载 reminder 行并调用 scheduler.scheduleTimer()
 */
import type { SchedulerService } from './SchedulerService';
import { reminderRepository } from '../infrastructure/database/repositories/reminder-repository';
import { createLogger } from '../infrastructure/logging/logger';

const log = createLogger('ReminderSchedulerBridge');

let schedulerInstance: SchedulerService | null = null;

/** 注册 SchedulerService 实例（integration.ts 初始化时调用） */
export function setSchedulerInstance(scheduler: SchedulerService): void {
  schedulerInstance = scheduler;
  log.info('scheduler instance registered');
}

/**
 * 通知调度器有新提醒创建。
 * 技能调用 reminderRepository.insert() 后调用此方法，
 * bridge 会加载提醒行并启动精确倒计时定时器。
 */
export function notifyReminderCreated(reminderId: string): void {
  if (!schedulerInstance) {
    log.warn('scheduler not initialized, timer will be set on next start()', {
      fields: { reminderId }
    });
    return;
  }

  const row = reminderRepository.getById(reminderId);
  if (!row) {
    log.warn('reminder not found in DB, cannot schedule timer', {
      fields: { reminderId }
    });
    return;
  }

  if (!row.is_active) {
    log.debug('reminder already inactive, skipping timer', {
      fields: { reminderId }
    });
    return;
  }

  schedulerInstance.scheduleTimer(row);
  log.info('timer scheduled for new reminder', {
    fields: { reminderId, nextTriggerAt: row.next_trigger_at }
  });
}

/** 通知调度器提醒被取消 */
export function notifyReminderCancelled(reminderId: string): void {
  if (!schedulerInstance) return;
  schedulerInstance.cancel(reminderId);
}
