/**
 * 技能：get_current_time
 * 获取当前精确时间。只读技能，不调用外部网络。
 *
 * 返回精确到秒的本地时间、UTC、时区、星期。
 * permissionLevel = auto_allow，无需用户确认。
 */
import { z } from 'zod';
import { SKILL_ID, PERMISSION_LEVEL } from '../../shared/constants';
import type { SkillDefinition, SkillContext } from '../../services/SkillRegistry';
import { TimeService } from '../../services/TimeService';
import { createLogger } from '../../infrastructure/logging/logger';

const log = createLogger('Skill:get_current_time');

/** 创建获取时间输入 */
export const getCurrentTimeInputSchema = z.object({
  timezone: z.string().default('Asia/Shanghai')
});

export type GetCurrentTimeInput = z.infer<typeof getCurrentTimeInputSchema>;

/** 创建获取时间输出 */
export interface GetCurrentTimeOutput {
  /** UTC ISO 时间 */
  utcIso: string;
  /** 本地显示时间（精确到秒） */
  localDisplay: string;
  /** 时区 */
  timezone: string;
  /** UTC 偏移 */
  utcOffset: string;
  /** 星期几 */
  weekday: string;
  /** 毫秒时间戳 */
  epochMs: number;
  /** 人类可读的消息 */
  message: string;
}

export const getCurrentTimeSkill: SkillDefinition<GetCurrentTimeInput, GetCurrentTimeOutput> = {
  id: SKILL_ID.GET_CURRENT_TIME,
  name: '获取当前时间',
  description: '获取当前精确时间，包括本地时间、UTC、时区和星期。只读，不调用外部网络。',
  permissionLevel: PERMISSION_LEVEL.AUTO_ALLOW,
  inputSchema: getCurrentTimeInputSchema,
  handler: async (input: GetCurrentTimeInput, context: SkillContext): Promise<GetCurrentTimeOutput> => {
    log.info('getting current time', {
      traceId: context.traceId,
      fields: { timezone: input.timezone }
    });

    const timeService = new TimeService(input.timezone);
    const ctx = timeService.getCurrentTimeContext();

    const message = `现在是 ${ctx.localDisplay}（${ctx.weekday}），时区 ${ctx.timezone}（UTC${ctx.utcOffset}）。`;

    log.info('current time retrieved', {
      traceId: context.traceId,
      fields: { localDisplay: ctx.localDisplay }
    });

    return {
      utcIso: ctx.utcIso,
      localDisplay: ctx.localDisplay,
      timezone: ctx.timezone,
      utcOffset: ctx.utcOffset,
      weekday: ctx.weekday,
      epochMs: ctx.epochMs,
      message
    };
  }
};
