/**
 * 节点：receive_event
 * 接收主动事件，确定事件类型。
 *
 * 事件类型映射：
 * - reminder_due → reminder
 * - startup → startup_digest
 * - daily_greeting_due → daily_greeting
 */
import type { ProactiveStateType, ProactiveStateUpdate, ProactiveType } from '../state';
import { createLogger } from '../../../../infrastructure/logging/logger';

const log = createLogger('ProactiveGraph:receive_event');

/** 根据事件类型推断主动事件类型 */
export function inferProactiveType(eventType: string): ProactiveType {
  switch (eventType) {
    case 'reminder_due':
      return 'reminder';
    case 'startup':
      return 'startup_digest';
    case 'daily_greeting_due':
      return 'daily_greeting';
    default:
      return 'daily_greeting';
  }
}

export async function receiveEvent(
  state: ProactiveStateType
): Promise<ProactiveStateUpdate> {
  const inferredType = inferProactiveType(state.event.type);

  log.info('received proactive event', {
    traceId: state.traceId,
    fields: {
      eventType: state.event.type,
      proactiveType: inferredType,
      dedupeKey: state.event.dedupeKey ?? 'none'
    }
  });

  return {
    proactiveType: inferredType,
    dailyDate: new Date().toISOString().slice(0, 10)
  };
}
