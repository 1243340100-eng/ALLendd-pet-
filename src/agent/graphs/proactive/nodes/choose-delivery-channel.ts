/**
 * 节点：choose_delivery_channel
 * 选择投递通道。
 *
 * 系统通知和声音分别设置。
 * 如果策略未启用系统通知，则默认使用桌宠气泡。
 */
import type { ProactiveStateType, ProactiveStateUpdate } from '../state';
import { createLogger } from '../../../../infrastructure/logging/logger';

const log = createLogger('ProactiveGraph:choose_delivery_channel');

export async function chooseDeliveryChannel(
  state: ProactiveStateType
): Promise<ProactiveStateUpdate> {
  const policy = state.policy;

  // 如果已经被前面的检查节点设置为 deferred 或 suppressed，保持不变
  if (state.delivery === 'deferred' || state.delivery === 'suppressed') {
    log.info('delivery already decided by check node', {
      fields: { delivery: state.delivery }
    });
    return {};
  }

  // 系统通知优先用于提醒
  if (policy?.systemNotificationEnabled && state.proactiveType === 'reminder') {
    log.info('choosing system notification for reminder', {
      fields: { soundEnabled: policy.soundEnabled }
    });
    return { delivery: 'system_notification' };
  }

  // 默认使用桌宠气泡
  log.info('choosing pet bubble', {
    fields: { proactiveType: state.proactiveType }
  });
  return { delivery: 'pet_bubble' };
}
