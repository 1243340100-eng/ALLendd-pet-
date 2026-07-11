/**
 * 技能：list_today_schedule
 * 查询今日计划。聚合今日提醒、今日任务、已过期未完成任务。
 * 不需要模型调用，纯数据库读取。
 *
 * 对应架构计划第 5.2 节"今日计划分支"。
 */
import { z } from 'zod';
import { SKILL_ID, PERMISSION_LEVEL } from '../../shared/constants';
import type { SkillDefinition } from '../../services/SkillRegistry';
import { reminderRepository } from '../../infrastructure/database/repositories/reminder-repository';
import { TimeService } from '../../services/TimeService';
import { createLogger } from '../../infrastructure/logging/logger';

const log = createLogger('Skill:list_today_schedule');

export const listScheduleInputSchema = z.object({
  timezone: z.string().default('Asia/Shanghai')
});

export type ListScheduleInput = z.infer<typeof listScheduleInputSchema>;

export interface ScheduleEntry {
  id: string;
  type: 'reminder' | 'task';
  title: string;
  scheduledAt: string;
  completed: boolean;
  overdue: boolean;
}

export interface ListScheduleOutput {
  entries: ScheduleEntry[];
  totalCount: number;
  overdueCount: number;
  message: string;
}

export const listTodayScheduleSkill: SkillDefinition<ListScheduleInput, ListScheduleOutput> = {
  id: SKILL_ID.LIST_TODAY_SCHEDULE,
  name: '今日计划',
  description: '查询今日提醒和任务，包括已过期未完成的项。',
  permissionLevel: PERMISSION_LEVEL.AUTO_ALLOW,
  inputSchema: listScheduleInputSchema,
  handler: async (input: ListScheduleInput, context): Promise<ListScheduleOutput> => {
    log.info('listing today schedule', {
      traceId: context.traceId,
      fields: { timezone: input.timezone }
    });

    const timeService = new TimeService();
    const now = timeService.nowUtc();
    const nowDate = new Date();
    const dayStart = timeService.getDayStartUtc(nowDate);
    const dayEnd = timeService.getDayEndUtc(nowDate);

    // 查询活跃提醒
    const reminders = reminderRepository.getActiveReminders();
    const entries: ScheduleEntry[] = [];

    for (const rem of reminders) {
      if (rem.user_id !== context.userId || rem.character_id !== context.characterId) continue;

      const isOverdue = rem.next_trigger_at < now;
      const isToday = rem.next_trigger_at >= dayStart && rem.next_trigger_at <= dayEnd;

      if (isToday || isOverdue) {
        entries.push({
          id: rem.id,
          type: 'reminder',
          title: rem.content,
          scheduledAt: rem.next_trigger_at,
          completed: false,
          overdue: isOverdue
        });
      }
    }

    // 按时间排序
    entries.sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));

    const overdueCount = entries.filter((e) => e.overdue).length;
    const totalCount = entries.length;

    let message: string;
    if (totalCount === 0) {
      message = '今天没有待办事项。';
    } else {
      const parts = entries.map((e) => {
        const time = timeService.toLocalDisplay(e.scheduledAt, input.timezone);
        const prefix = e.overdue ? '[已过期] ' : '';
        return `${prefix}${time} ${e.title}`;
      });
      message = `今日计划（${totalCount}项）：\n${parts.join('\n')}`;
    }

    log.info('schedule listed', {
      traceId: context.traceId,
      fields: { totalCount, overdueCount }
    });

    return { entries, totalCount, overdueCount, message };
  }
};
