/**
 * 节点：build_response
 * 组装最终响应 DTO，确保始终包含有效的表情和动作默认值。
 *
 * 表情、动作不得额外消耗一次模型调用。
 * 如果结构化输出无效，由规则映射为 neutral/idle。
 */
import type { ConversationStateType, ConversationStateUpdate, ResponseDTO } from '../state';
import { DEFAULT_EXPRESSION, DEFAULT_MOTION } from '../state';
import { createLogger } from '../../../../infrastructure/logging/logger';

const log = createLogger('ConversationGraph:build_response');

/** 有效表情列表 */
const VALID_EXPRESSIONS = new Set([
  'idle', 'waving', 'waiting', 'jumping', 'running',
  'running-left', 'running-right', 'failed', 'review'
]);

/** 规则映射：无效表情映射为 idle */
function sanitizeExpression(expr: string | undefined): string {
  if (!expr || !VALID_EXPRESSIONS.has(expr)) {
    return DEFAULT_EXPRESSION;
  }
  return expr;
}

/** 规则映射：无效动作映射为 idle */
function sanitizeMotion(motion: string | undefined): string {
  if (!motion || !VALID_EXPRESSIONS.has(motion)) {
    return DEFAULT_MOTION;
  }
  return motion;
}

export async function buildResponse(
  state: ConversationStateType
): Promise<ConversationStateUpdate> {
  log.info('building response DTO', {
    traceId: state.traceId
  });

  // 确保始终有有效文本
  const text = state.responseText || '（无回复内容）';

  // 确保表情和动作有效
  const expression = sanitizeExpression(state.expression);
  const motion = sanitizeMotion(state.motion);

  // 收集关联的记忆 ID
  const memoryIds = state.retrievedMemories.map((m) => m.id);

  // 组装 DTO
  const dto: ResponseDTO = {
    text,
    expression,
    motion,
    memoryIds: memoryIds.length > 0 ? memoryIds : undefined,
    skillExecuted: state.selectedSkillId ?? undefined,
    shouldAskUser: state.shouldAskUser || undefined,
    checkpointId: state.checkpointId || undefined
  };

  log.info('response DTO built', {
    fields: {
      textLength: text.length,
      expression,
      motion,
      shouldAskUser: dto.shouldAskUser ?? false
    }
  });

  return { responseDTO: dto };
}
