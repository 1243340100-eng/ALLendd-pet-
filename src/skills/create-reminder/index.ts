/**
 * 技能：create_reminder
 * 创建提醒。提取提醒字段、校验、保存到数据库、注册调度。
 *
 * 对应架构计划第 5.2 节"创建提醒分支"。
 *
 * 修正：
 * - 重复提醒的第一次触发时间就是用户指定的时间，不是 +1 天后
 * - recurrenceRule 使用 JSON 格式 { frequency: 'daily' } 保持与 SchedulerService 一致
 */
import { z } from 'zod';
import { SKILL_ID, PERMISSION_LEVEL } from '../../shared/constants';
import type { SkillDefinition, SkillContext } from '../../services/SkillRegistry';
import { reminderRepository } from '../../infrastructure/database/repositories/reminder-repository';
import { notifyReminderCreated } from '../../services/reminder-scheduler-bridge';
import { TimeService } from '../../services/TimeService';
import { TimeInvalidError } from '../../shared/contracts/errors';
import { createLogger } from '../../infrastructure/logging/logger';

const log = createLogger('Skill:create_reminder');

/** 创建提醒输入 */
export const createReminderInputSchema = z.object({
  content: z.string().min(1).max(500),
  triggerAt: z.string().min(1),
  timezone: z.string().default('Asia/Shanghai'),
  isRepeating: z.boolean().default(false),
  recurrenceRule: z.string().default(''),
  priority: z.enum(['low', 'normal', 'high']).default('normal')
});

export type CreateReminderInput = z.infer<typeof createReminderInputSchema>;

/** 创建提醒输出 */
export interface CreateReminderOutput {
  reminderId: string;
  content: string;
  triggerAt: string;
  isRepeating: boolean;
  message: string;
}

function generateId(prefix: string): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${ts}-${rand}`;
}

export const createReminderSkill: SkillDefinition<CreateReminderInput, CreateReminderOutput> = {
  id: SKILL_ID.CREATE_REMINDER,
  name: '创建提醒',
  description: '根据用户输入创建定时提醒。用户明确说"提醒我……"即视为本次创建授权。',
  permissionLevel: PERMISSION_LEVEL.AUTO_ALLOW, // 聊天中明确说"提醒我"即授权
  inputSchema: createReminderInputSchema,
  handler: async (input: CreateReminderInput, context: SkillContext): Promise<CreateReminderOutput> => {
    log.info('creating reminder', {
      traceId: context.traceId,
      fields: { content: input.content.slice(0, 50), triggerAt: input.triggerAt }
    });

    // 校验时间
    const timeService = new TimeService(input.timezone);
    const resolved = timeService.resolve({
      raw: input.triggerAt,
      candidateUtc: input.triggerAt,
      timezone: input.timezone
    });
    const validatedAt = resolved.utc;

    const reminderId = generateId('rem');

    // 重复提醒的第一次触发时间就是用户指定的时间
    // SchedulerService 在投递成功后才计算下一次触发时间
    const nextTrigger = validatedAt;

    // 保存到数据库（事务性，失败不回复"已创建"）
    reminderRepository.insert({
      id: reminderId,
      user_id: context.userId,
      character_id: context.characterId,
      content: input.content,
      trigger_at: validatedAt,
      timezone: input.timezone,
      is_repeating: input.isRepeating ? 1 : 0,
      recurrence_rule: input.recurrenceRule,
      priority: input.priority,
      is_active: 1,
      next_trigger_at: nextTrigger
    });

    // 通知调度器立即启动精确倒计时定时器
    notifyReminderCreated(reminderId);

    log.info('reminder created', {
      traceId: context.traceId,
      fields: { reminderId, nextTrigger }
    });

    return {
      reminderId,
      content: input.content,
      triggerAt: validatedAt,
      isRepeating: input.isRepeating,
      message: `已创建提醒：${input.content}，将在 ${timeService.toLocalDisplay(validatedAt, input.timezone)} 触发。`
    };
  }
};
