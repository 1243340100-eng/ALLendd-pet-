/**
 * 节点：enqueue_reflection
 * 将反思任务放入后台队列。
 *
 * Reflection 失败不影响聊天。
 * V1 只做最小异步版本：构建 ReflectionPayload，留待后台处理。
 */
import type { ConversationStateType, ConversationStateUpdate } from '../state';
import type { ReflectionPayload } from '../../../../shared/contracts/graph-state';
import { enqueueReflectionTask } from '../../../../services/ReflectionWorker';
import { createLogger } from '../../../../infrastructure/logging/logger';

const log = createLogger('ConversationGraph:enqueue_reflection');

/** 生成唯一 ID */
function generateId(prefix: string): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${ts}-${rand}`;
}

export async function enqueueReflection(
  state: ConversationStateType
): Promise<ConversationStateUpdate> {
  log.info('enqueuing reflection', {
    traceId: state.traceId
  });

  // 不对表情请求、计划查询和提醒创建做反思
  if (state.intent === 'expression' || state.intent === 'list_schedule' || state.intent === 'create_reminder') {
    log.info('skipping reflection for this intent', {
      fields: { intent: state.intent }
    });
    return {};
  }

  // 构建反思负载
  const payload: ReflectionPayload = {
    turnId: generateId('turn'),
    userMessage: state.userInput,
    assistantReply: state.responseDTO?.text ?? state.responseText,
    emotion: state.responseDTO?.expression
  };

  // 推入后台反思队列，由 ReflectionWorker 异步处理。
  // 失败不影响聊天；worker 未启动时仅入队不执行。
  try {
    enqueueReflectionTask({
      payload,
      userId: state.userId,
      characterId: state.characterId,
      sessionId: state.sessionId,
      persona: state.persona
    });
  } catch (error) {
    log.warn('failed to enqueue reflection, will be skipped', {
      fields: { error: (error as Error)?.message }
    });
  }

  log.info('reflection enqueued', {
    fields: { turnId: payload.turnId }
  });

  return { reflectionPayload: payload };
}
