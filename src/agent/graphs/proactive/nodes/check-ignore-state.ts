/**
 * 节点：check_ignore_state
 * 检查同类问候被忽略次数。
 *
 * 对同类问候连续忽略 2 次后，当天停止该类问候。
 * 忽略规则不影响用户创建的提醒。
 */
import type { ProactiveStateType, ProactiveStateUpdate } from '../state';
import { proactiveDeliveryRepository } from '../../../../infrastructure/database/repositories/proactive-delivery-repository';
import { createLogger } from '../../../../infrastructure/logging/logger';

const log = createLogger('ProactiveGraph:check_ignore_state');

export async function checkIgnoreState(
  state: ProactiveStateType
): Promise<ProactiveStateUpdate> {
  const policy = state.policy;
  if (!policy) {
    log.warn('no policy loaded, skipping ignore check', { traceId: state.traceId });
    return {};
  }

  // 提醒不受忽略规则影响
  if (state.proactiveType === 'reminder') {
    log.debug('reminder exempt from ignore check', { traceId: state.traceId });
    return { ignoredCount: 0 };
  }

  const deliveryType = state.proactiveType;
  const ignoredCount = proactiveDeliveryRepository.getTodayIgnoredCount(
    state.userId,
    state.characterId,
    deliveryType,
    state.dailyDate
  );

  log.info('checking ignore state', {
    traceId: state.traceId,
    fields: {
      deliveryType,
      ignoredCount,
      threshold: policy.ignoreThreshold
    }
  });

  if (ignoredCount >= policy.ignoreThreshold) {
    log.info('ignore threshold reached, suppressing', {
      fields: { deliveryType, ignoredCount }
    });
    return {
      ignoredCount,
      delivery: 'suppressed'
    };
  }

  return { ignoredCount };
}
