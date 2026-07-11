/**
 * 节点：check_daily_quota
 * 检查每日主动投递配额。
 *
 * 非提醒型主动行为每日最多 maxDailyProactive 次（默认 5）。
 * 用户主动创建的到期提醒属于履约行为，不受配额限制。
 */
import type { ProactiveStateType, ProactiveStateUpdate } from '../state';
import { proactiveDeliveryRepository } from '../../../../infrastructure/database/repositories/proactive-delivery-repository';
import { createLogger } from '../../../../infrastructure/logging/logger';

const log = createLogger('ProactiveGraph:check_daily_quota');

export async function checkDailyQuota(
  state: ProactiveStateType
): Promise<ProactiveStateUpdate> {
  const policy = state.policy;
  if (!policy) {
    log.warn('no policy loaded, skipping quota check', { traceId: state.traceId });
    return {};
  }

  // 提醒不受配额限制
  if (state.proactiveType === 'reminder') {
    log.debug('reminder exempt from quota check', { traceId: state.traceId });
    return { dailyCount: 0 };
  }

  const dailyCount = proactiveDeliveryRepository.getTodayTotalCount(
    state.userId,
    state.characterId,
    state.dailyDate
  );

  log.info('checking daily quota', {
    traceId: state.traceId,
    fields: {
      dailyCount,
      maxDaily: policy.maxDailyProactive,
      proactiveType: state.proactiveType
    }
  });

  if (dailyCount >= policy.maxDailyProactive) {
    log.info('daily quota exceeded, suppressing', {
      fields: { dailyCount, maxDaily: policy.maxDailyProactive }
    });
    return {
      dailyCount,
      delivery: 'suppressed'
    };
  }

  return { dailyCount };
}
