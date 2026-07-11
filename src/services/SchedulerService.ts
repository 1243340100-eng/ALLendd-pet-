/**
 * SchedulerService：持久化提醒调度。
 * 对应架构计划第 2.2 节。
 *
 * 关键保证：
 * - 重启应用不会丢提醒（基于数据库，不是内存定时器作为唯一真相源）
 * - 同一 reminderOccurrenceId 最多成功投递一次
 * - 应用启动及系统休眠恢复后补查错过的提醒
 * - 不调用模型，不直接操作 UI
 *
 * 调度机制：
 * - 使用 setTimeout 精确倒计时（非轮询），创建即计算剩余时间
 * - 每个提醒有独立的 timer，到期精确触发
 * - 保留 5 分钟兜底轮询，防止系统休眠恢复等边缘场景
 *
 * 修正投递顺序：
 * 1. markOccurrencePending（保留，dedup）
 * 2. 写入 outbox
 * 3. 调用 handler（通知回调）
 * 4. markOccurrenceDelivered（确认投递成功）
 * 5. 更新下一次触发 / 停用
 *
 * 如果在步骤 4 之前崩溃，occurrence 仍为 pending，
 * 下次重扫时会重新投递（不会丢失，也不会重复）。
 */
import { reminderRepository, type ReminderRow } from '../infrastructure/database/repositories/reminder-repository';
import { TimeService } from './TimeService';
import { createLogger } from '../infrastructure/logging/logger';

const log = createLogger('SchedulerService');

/** setTimeout 最大延迟（约 24.8 天），超过此值需分阶段等待 */
const MAX_TIMER_DELAY = 2_147_483_000;

/** 兜底轮询间隔（5 分钟），仅用于系统休眠恢复等边缘场景 */
const FALLBACK_INTERVAL_MS = 300_000;

export interface ReminderDueEvent {
  reminderId: string;
  reminderOccurrenceId: string;
  content: string;
  scheduledAt: string;
  priority: 'low' | 'normal' | 'high';
}

export type ReminderDueHandler = (event: ReminderDueEvent) => Promise<boolean> | boolean;

export class SchedulerService {
  private timeService: TimeService;
  private handler: ReminderDueHandler | null = null;
  private fallbackIntervalId: ReturnType<typeof setInterval> | null = null;
  /** 每个提醒的精确倒计时定时器 */
  private timers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private started = false;

  constructor(timeService: TimeService) {
    this.timeService = timeService;
  }

  /** 注册提醒到期回调 */
  onReminderDue(handler: ReminderDueHandler): void {
    this.handler = handler;
  }

  /**
   * 注册提醒。
   * 写入数据库并立即启动精确倒计时定时器。
   */
  register(reminder: {
    id: string;
    userId: string;
    characterId: string;
    content: string;
    triggerAt: string;
    timezone: string;
    isRepeating: boolean;
    recurrenceRule: string;
    priority: 'low' | 'normal' | 'high';
  }): void {
    reminderRepository.insert({
      id: reminder.id,
      user_id: reminder.userId,
      character_id: reminder.characterId,
      content: reminder.content,
      trigger_at: reminder.triggerAt,
      timezone: reminder.timezone,
      is_repeating: reminder.isRepeating ? 1 : 0,
      recurrence_rule: reminder.recurrenceRule,
      priority: reminder.priority,
      is_active: 1,
      next_trigger_at: reminder.triggerAt
    });
    log.info('reminder registered', {
      fields: { id: reminder.id, triggerAt: reminder.triggerAt }
    });

    // 立即启动倒计时定时器
    const row = reminderRepository.getById(reminder.id);
    if (row) {
      this.scheduleTimer(row);
    }
  }

  /** 取消提醒 */
  cancel(reminderId: string): void {
    this.clearTimer(reminderId);
    reminderRepository.deactivate(reminderId);
    log.info('reminder cancelled', { fields: { id: reminderId } });
  }

  /**
   * 为单个提醒安排精确倒计时定时器。
   * - delay > 0：setTimeout 等待到精确触发时刻
   * - delay <= 0：已过期，立即触发
   * - delay > MAX_TIMER_DELAY：分阶段等待，到期前重新调度
   */
  scheduleTimer(reminder: ReminderRow): void {
    // 先清除旧定时器（如果有）
    this.clearTimer(reminder.id);

    const now = Date.now();
    const triggerMs = new Date(reminder.next_trigger_at).getTime();

    if (isNaN(triggerMs)) {
      log.warn('invalid next_trigger_at, skipping timer', {
        fields: { id: reminder.id, next_trigger_at: reminder.next_trigger_at }
      });
      return;
    }

    let delay = triggerMs - now;

    if (delay <= 0) {
      // 已过期，立即触发
      log.info('reminder already due, firing immediately', {
        fields: { id: reminder.id, delay }
      });
      this.fireReminder(reminder);
      return;
    }

    // 超过最大延迟时分阶段等待
    if (delay > MAX_TIMER_DELAY) {
      delay = MAX_TIMER_DELAY;
      log.info('scheduling timer in stages (delay exceeds max)', {
        fields: { id: reminder.id, originalDelay: triggerMs - now, cappedDelay: delay }
      });
    } else {
      log.info('scheduling timer', {
        fields: { id: reminder.id, delayMs: delay, triggerAt: reminder.next_trigger_at }
      });
    }

    const timer = setTimeout(() => {
      this.timers.delete(reminder.id);
      // 重新检查：如果 delay 被截断，需继续等待
      const currentRow = reminderRepository.getById(reminder.id);
      if (!currentRow || !currentRow.is_active) return;

      const remaining = new Date(currentRow.next_trigger_at).getTime() - Date.now();
      if (remaining > 1000) {
        // 还没到时间（delay 被截断），重新调度
        this.scheduleTimer(currentRow);
        return;
      }

      // 时间到了，触发
      this.fireReminder(currentRow);
    }, delay);

    this.timers.set(reminder.id, timer);
  }

  /**
   * 触发提醒：执行完整的投递流程。
   * 投递成功后，如果是重复提醒，调度下一次。
   */
  private async fireReminder(reminder: ReminderRow): Promise<void> {
    log.info('timer fired, checking due reminder', {
      fields: { id: reminder.id, content: reminder.content.slice(0, 50) }
    });

    const delivered = await this.checkDueReminders();

    // 检查这个提醒是否已被处理（可能被 checkDueReminders 中的 advance/deactivate 处理了）
    const updatedRow = reminderRepository.getById(reminder.id);
    if (updatedRow && updatedRow.is_active) {
      // 仍活跃：可能是重复提醒已更新 next_trigger_at，调度下一次
      this.scheduleTimer(updatedRow);
    }
  }

  /**
   * 检查到期提醒并投递。
   * 防重复：基于 reminder_occurrences 唯一约束。
   *
   * 投递顺序：
   * 1. markOccurrencePending（占位 + dedup）
   * 2. 调用 handler（等待 Graph 完成）
   *    - handler 内部调用 dispatcher.dispatch → ProactiveGraph
   *    - ProactiveGraph 的 deduplicate 节点负责 outbox 发布和去重
   *    - 不要在 SchedulerService 中提前发布 outbox，否则
   *      ProactiveGraph 的 deduplicate 会因 id 冲突误判为重复，
   *      导致 delivery: 'suppressed'，提醒被静默吞掉
   * 3. handler 返回 true → markOccurrenceDelivered（确认）
   * 4. 更新下一次触发 / 停用
   *
   * 如果 handler 返回 false 或抛出，occurrence 保持 pending，下次重试。
   */
  async checkDueReminders(): Promise<ReminderDueEvent[]> {
    const now = this.timeService.nowUtc();
    const due = reminderRepository.getDueReminders(now);
    const delivered: ReminderDueEvent[] = [];

    for (const reminder of due) {
      // 1. 占位（pending），dedup
      const result = reminderRepository.markOccurrencePending(
        reminder.id,
        reminder.next_trigger_at
      );
      if (!result.inserted) {
        // 已存在 occurrence，检查是否已投递
        const alreadyDelivered = reminderRepository.hasOccurrenceBeenDelivered(
          reminder.id,
          reminder.next_trigger_at
        );
        if (alreadyDelivered) {
          log.debug('reminder occurrence already delivered, skipping', {
            fields: { id: reminder.id, at: reminder.next_trigger_at }
          });
          // 已投递但提醒仍 active：说明上次投递后未更新 next_trigger
          this.advanceReminder(reminder);
          continue;
        }
        // pending 状态：上次投递未完成，重试
        log.info('retrying pending occurrence', {
          fields: { id: reminder.id, at: reminder.next_trigger_at }
        });
      }

      const event: ReminderDueEvent = {
        reminderId: reminder.id,
        reminderOccurrenceId: `occ-${reminder.id}-${reminder.next_trigger_at}`,
        content: reminder.content,
        scheduledAt: reminder.next_trigger_at,
        priority: reminder.priority as 'low' | 'normal' | 'high'
      };

      // 2. 调用 handler（等待 Graph 完成确认投递）
      // 注意：不要在此处发布 outbox，ProactiveGraph 的 deduplicate 节点负责
      let handlerSuccess = true;
      if (this.handler) {
        try {
          const handlerResult = await this.handler(event);
          handlerSuccess = handlerResult !== false;
        } catch (error) {
          log.warn('handler threw, occurrence stays pending for retry', {
            fields: { id: reminder.id, error: (error as Error)?.message }
          });
          handlerSuccess = false;
        }
      }

      if (!handlerSuccess) {
        // handler 未确认投递，occurrence 保持 pending，下次重试
        log.info('handler did not confirm delivery, occurrence stays pending', {
          fields: { id: reminder.id }
        });
        continue;
      }

      // 4. 确认投递成功
      reminderRepository.markOccurrenceDelivered(reminder.id, reminder.next_trigger_at);

      // 5. 更新下一次触发时间 / 停用
      this.advanceReminder(reminder);

      delivered.push(event);
    }

    if (delivered.length > 0) {
      log.info('reminders delivered', { fields: { count: delivered.length } });
    }
    return delivered;
  }

  /** 更新下一次触发时间或停用提醒 */
  private advanceReminder(reminder: ReminderRow): void {
    if (reminder.is_repeating) {
      const nextTrigger = this.computeNextOccurrence(reminder);
      if (nextTrigger) {
        reminderRepository.updateNextTrigger(reminder.id, nextTrigger);
      } else {
        reminderRepository.deactivate(reminder.id);
      }
    } else {
      reminderRepository.deactivate(reminder.id);
    }
  }

  /**
   * 启动调度器。
   * 1. 加载所有活跃提醒，为每个安排精确定时器
   * 2. 启动兜底轮询（5 分钟，仅用于系统休眠恢复等边缘场景）
   */
  start(): void {
    if (this.started) return;
    this.started = true;

    // 加载所有活跃提醒并安排定时器
    const activeReminders = reminderRepository.getActiveReminders();
    log.info('loading active reminders for scheduling', {
      fields: { count: activeReminders.length }
    });

    for (const reminder of activeReminders) {
      this.scheduleTimer(reminder);
    }

    // 兜底轮询：每 5 分钟检查一次，防止系统休眠恢复等导致 timer 丢失
    this.fallbackIntervalId = setInterval(() => {
      this.checkDueReminders().catch((err) => {
        log.error('fallback check failed', { fields: { error: (err as Error)?.message } });
      });
      // 重新调度可能因系统休眠而错过的定时器
      this.rescheduleAllTimers();
    }, FALLBACK_INTERVAL_MS);

    log.info('scheduler started', {
      fields: { activeTimers: this.timers.size, fallbackIntervalMs: FALLBACK_INTERVAL_MS }
    });
  }

  /** 重新调度所有活跃提醒的定时器（用于系统休眠恢复后） */
  private rescheduleAllTimers(): void {
    const activeReminders = reminderRepository.getActiveReminders();
    for (const reminder of activeReminders) {
      if (!this.timers.has(reminder.id)) {
        // 没有定时器但提醒仍活跃：重新调度
        log.info('rescheduling missing timer', {
          fields: { id: reminder.id, next_trigger_at: reminder.next_trigger_at }
        });
        this.scheduleTimer(reminder);
      }
    }
  }

  /** 停止 */
  stop(): void {
    if (this.fallbackIntervalId) {
      clearInterval(this.fallbackIntervalId);
      this.fallbackIntervalId = null;
    }
    for (const [id, timer] of this.timers) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.started = false;
    log.info('scheduler stopped');
  }

  /** 启动/休眠恢复后补查错过的提醒 */
  async recoverMissedReminders(): Promise<ReminderDueEvent[]> {
    log.info('recovering missed reminders');
    return this.checkDueReminders();
  }

  /** 清除单个提醒的定时器 */
  private clearTimer(reminderId: string): void {
    const timer = this.timers.get(reminderId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(reminderId);
    }
  }

  /** 计算重复提醒的下一次触发时间 */
  private computeNextOccurrence(reminder: ReminderRow): string | null {
    if (!reminder.recurrence_rule) return null;
    try {
      const rule = JSON.parse(reminder.recurrence_rule);
      const frequency = rule.frequency ?? rule;
      const current = new Date(reminder.next_trigger_at);
      switch (frequency) {
        case 'daily': {
          const next = new Date(current);
          next.setDate(next.getDate() + 1);
          return next.toISOString();
        }
        case 'weekly': {
          const next = new Date(current);
          next.setDate(next.getDate() + 7);
          return next.toISOString();
        }
        default:
          return null;
      }
    } catch {
      return null;
    }
  }
}
