/**
 * 技能：set_pet_expression
 * 设置角色表情/动作。
 *
 * 对应架构计划第 5.2 节"表情请求分支"。
 */
import { z } from 'zod';
import { SKILL_ID, PERMISSION_LEVEL } from '../../shared/constants';
import type { SkillDefinition } from '../../services/SkillRegistry';
import { createLogger } from '../../infrastructure/logging/logger';

const log = createLogger('Skill:set_pet_expression');

/** 可用的表情/动作列表 */
const VALID_EXPRESSIONS = [
  'idle', 'waving', 'waiting', 'jumping', 'running',
  'running-left', 'running-right', 'failed', 'review'
] as const;

export const setExpressionInputSchema = z.object({
  expression: z.enum(VALID_EXPRESSIONS),
  durationMs: z.number().int().positive().max(60000).optional()
});

export type SetExpressionInput = z.infer<typeof setExpressionInputSchema>;

export interface SetExpressionOutput {
  expression: string;
  durationMs?: number;
  message: string;
}

export const setPetExpressionSkill: SkillDefinition<SetExpressionInput, SetExpressionOutput> = {
  id: SKILL_ID.SET_PET_EXPRESSION,
  name: '设置表情',
  description: '设置角色表情或动作。',
  permissionLevel: PERMISSION_LEVEL.AUTO_ALLOW,
  inputSchema: setExpressionInputSchema,
  handler: async (input: SetExpressionInput, context): Promise<SetExpressionOutput> => {
    log.info('setting expression', {
      traceId: context.traceId,
      fields: { expression: input.expression }
    });

    return {
      expression: input.expression,
      durationMs: input.durationMs,
      message: `表情已设置为 ${input.expression}`
    };
  }
};
