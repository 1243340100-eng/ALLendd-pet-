/**
 * 节点：record_delivery
 * 记录投递结果。
 *
 * - 成功投递（pet_bubble / system_notification）：写入 proactive_deliveries 表
 * - 延迟投递（deferred）：不记录，保持 event_outbox 为 pending 状态
 * - 被抑制（suppressed）：标记 event_outbox 为 processed（去重完成）
 *
 * 每日主动次数统计在本地日期跨日时正确重置（通过 daily_date 字段）。
 */
import type { ProactiveStateType, ProactiveStateUpdate, DeliveryResult } from '../state';
import { proactiveDeliveryRepository } from '../../../../infrastructure/database/repositories/proactive-delivery-repository';
import { eventOutboxRepository } from '../../../../infrastructure/database/repositories/event-outbox-repository';
import { createLogger } from '../../../../infrastructure/logging/logger';

const log = createLogger('ProactiveGraph:record_delivery');

export async function recordDelivery(
  state: ProactiveStateType
): Promise<ProactiveStateUpdate> {
  const result = state.deliveryResult;
  if (!result) {
    log.warn('no delivery result to record', { traceId: state.traceId });
    return {};
  }

  log.info('recording delivery', {
    traceId: state.traceId,
    fields: {
      channel: result.channel,
      delivered: result.delivered,
      proactiveType: state.proactiveType
    }
  });

  // 成功投递：记录到 proactive_deliveries
  if (result.delivered) {
    try {
      proactiveDeliveryRepository.record({
        user_id: state.userId,
        character_id: state.characterId,
        delivery_type: state.proactiveType,
        ignored: 0,
        daily_date: state.dailyDate
      });

      // 标记 event_outbox 为已处理
      if (state.event.dedupeKey) {
        try {
          eventOutboxRepository.markProcessed(state.event.eventId);
        } catch (error) {
          log.warn('failed to mark outbox as processed', {
            fields: { error: (error as Error)?.message }
          });
        }
      }

      log.info('delivery recorded', {
        fields: { deliveryType: state.proactiveType, dailyDate: state.dailyDate }
      });
    } catch (error) {
      log.error('failed to record delivery', {
        fields: { error: (error as Error)?.message }
      });
    }
  } else if (result.channel === 'suppressed') {
    // 被抑制：标记 outbox 为已处理（避免重复处理）
    if (state.event.dedupeKey) {
      try {
        eventOutboxRepository.markProcessed(state.event.eventId);
      } catch (error) {
        log.warn('failed to mark outbox as processed (suppressed)', {
          fields: { error: (error as Error)?.message }
        });
      }
    }
  }
  // deferred：不标记 outbox，保持 pending 状态等待补发

  return {};
}
