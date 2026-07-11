/**
 * 节点：deduplicate
 * 基于 dedupeKey 检查事件是否已处理。
 *
 * 应用重启不会重复发送相同日报或提醒。
 * 已处理（status='processed'）的事件被跳过。
 * 新事件写入 event_outbox，状态为 pending。
 */
import type { ProactiveStateType, ProactiveStateUpdate } from '../state';
import { eventOutboxRepository } from '../../../../infrastructure/database/repositories/event-outbox-repository';
import { createLogger } from '../../../../infrastructure/logging/logger';

const log = createLogger('ProactiveGraph:deduplicate');

export async function deduplicate(
  state: ProactiveStateType
): Promise<ProactiveStateUpdate> {
  const dedupeKey = state.event.dedupeKey;

  // 没有去重键，无法去重，直接通过
  if (!dedupeKey) {
    log.debug('no dedupe key, skipping dedup', { traceId: state.traceId });
    return {};
  }

  // 查找已处理的事件
  const pending = eventOutboxRepository.getPending();
  const alreadyProcessed = pending.find(
    (e) => e.dedupe_key === dedupeKey && e.status === 'processed'
  );

  // 检查是否已存在（包括 pending 状态）
  const existing = pending.find((e) => e.dedupe_key === dedupeKey);

  if (alreadyProcessed) {
    log.info('duplicate event detected, suppressing', {
      fields: { dedupeKey }
    });
    return {
      isDuplicate: true,
      delivery: 'suppressed'
    };
  }

  // 如果事件不存在，尝试发布
  if (!existing) {
    const result = eventOutboxRepository.publish({
      id: state.event.eventId,
      event_type: state.event.type as string,
      payload_json: JSON.stringify(state.event.payload),
      dedupe_key: dedupeKey
    });

    if (!result.published) {
      // 唯一约束冲突 = 已存在但不在 pending 列表中 = 可能已处理
      log.info('event already exists in outbox, suppressing', {
        fields: { dedupeKey }
      });
      return {
        isDuplicate: true,
        delivery: 'suppressed'
      };
    }
  }

  log.debug('event is not duplicate, continuing', {
    fields: { dedupeKey }
  });

  return {};
}
