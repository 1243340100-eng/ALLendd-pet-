/**
 * 节点：render_or_notify
 * 执行投递。
 *
 * - pet_bubble: 设置表情和动作，由 UI 渲染气泡
 * - system_notification: 调用通知适配器，播放声音（如果启用）
 * - deferred: 仅记录，等待补发
 * - suppressed: 仅记录，不投递
 */
import type { ProactiveStateType, ProactiveStateUpdate, DeliveryResult } from '../state';
import type { NotificationAdapter } from '../../../../adapters/notifications/NotificationAdapter';
import type { SoundAdapter } from '../../../../adapters/sound/SoundAdapter';
import { createLogger } from '../../../../infrastructure/logging/logger';

const log = createLogger('ProactiveGraph:render_or_notify');

export function createRenderOrNotifyNode(
  notificationAdapter: NotificationAdapter,
  soundAdapter: SoundAdapter
) {
  return async function renderOrNotify(
    state: ProactiveStateType
  ): Promise<ProactiveStateUpdate> {
    log.info('rendering or notifying', {
      traceId: state.traceId,
      fields: { delivery: state.delivery }
    });

    const message = state.composedMessage || '';
    let result: DeliveryResult;

    switch (state.delivery) {
      case 'system_notification': {
        // 显示系统通知，等待实际投递结果
        const title = getNotificationTitle(state.proactiveType);
        const notifyOk = await notificationAdapter.showNotification(title, message);

        if (notifyOk) {
          // 通知成功显示
          if (soundAdapter.isEnabled()) {
            soundAdapter.play('notification');
          }
          result = {
            channel: 'system_notification',
            message,
            expression: state.expression,
            motion: state.motion,
            delivered: true
          };
        } else {
          // 通知失败（不支持/构造失败/show 抛错）：回退到桌宠气泡
          // 等待 Renderer ACK 确认实际显示
          log.warn('system notification failed, falling back to pet_bubble', {
            fields: { proactiveType: state.proactiveType }
          });
          const payload = state.event.payload as { reminderOccurrenceId?: string } | undefined;
          const deliveryId = payload?.reminderOccurrenceId || state.event.eventId;
          result = {
            channel: 'pet_bubble',
            message,
            expression: state.expression,
            motion: state.motion,
            delivered: false,
            deliveryId
          };
        }
        break;
      }

      case 'pet_bubble': {
        // 桌宠气泡：设置表情和动作，由 dispatcher 发送给 UI。
        // delivered=false：Graph 仅生成投递意图，不决定 UI 投递成功。
        // dispatcher 负责将消息转发给 renderer，并等待 renderer 的 ACK
        // 确认气泡实际显示后才标记 delivered=true。
        // deliveryId 用于追踪 ACK：优先使用 reminderOccurrenceId（提醒），
        // 否则使用 eventId（日报/问候等）。
        const payload = state.event.payload as { reminderOccurrenceId?: string } | undefined;
        const deliveryId = payload?.reminderOccurrenceId || state.event.eventId;
        result = {
          channel: 'pet_bubble',
          message,
          expression: state.expression,
          motion: state.motion,
          delivered: false,
          deliveryId
        };
        break;
      }

      case 'deferred': {
        // 延迟投递：不执行任何操作
        log.info('delivery deferred, waiting for re-delivery', {
          fields: { dedupeKey: state.event.dedupeKey }
        });
        result = {
          channel: 'deferred',
          message,
          expression: state.expression,
          motion: state.motion,
          delivered: false
        };
        break;
      }

      case 'suppressed':
      default: {
        // 被抑制：不投递
        log.info('delivery suppressed', {
          fields: { proactiveType: state.proactiveType }
        });
        result = {
          channel: 'suppressed',
          message,
          expression: state.expression,
          motion: state.motion,
          delivered: false
        };
        break;
      }
    }

    return { deliveryResult: result };
  };
}

/** 获取通知标题 */
function getNotificationTitle(proactiveType: string): string {
  switch (proactiveType) {
    case 'reminder':
      return '提醒';
    case 'startup_digest':
      return '今日日报';
    case 'daily_greeting':
      return '问候';
    default:
      return '通知';
  }
}
