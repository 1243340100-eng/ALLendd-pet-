/**
 * 节点：check_dnd
 * 勿扰时间检测。
 *
 * 勿扰期间普通问候直接跳过；提醒延迟至勿扰结束。
 * 用户可关闭或修改勿扰时间。
 */
import type { ProactiveStateType, ProactiveStateUpdate } from '../state';
import { TimeService } from '../../../../services/TimeService';
import { createLogger } from '../../../../infrastructure/logging/logger';

const log = createLogger('ProactiveGraph:check_dnd');

export function createCheckDndNode(timeService: TimeService) {
  return async function checkDnd(
    state: ProactiveStateType
  ): Promise<ProactiveStateUpdate> {
    const policy = state.policy;
    if (!policy) {
      log.warn('no policy loaded, skipping DND check', { traceId: state.traceId });
      return { inDnd: false };
    }

    // 勿扰未启用
    if (!policy.dndEnabled) {
      return { inDnd: false };
    }

    const now = new Date();
    const inDnd = timeService.isInDnd(now, policy.dndStart, policy.dndEnd);

    log.info('checking DND', {
      traceId: state.traceId,
      fields: {
        inDnd,
        dndWindow: `${policy.dndStart}-${policy.dndEnd}`,
        proactiveType: state.proactiveType
      }
    });

    if (!inDnd) {
      return { inDnd: false };
    }

    // 勿扰期间的策略
    if (state.proactiveType === 'reminder') {
      // 提醒延迟至勿扰结束
      log.info('in DND, deferring reminder', {
        fields: { dedupeKey: state.event.dedupeKey }
      });
      return {
        inDnd: true,
        delivery: 'deferred'
      };
    }

    // 普通问候直接跳过
    log.info('in DND, suppressing non-reminder', {
      fields: { proactiveType: state.proactiveType }
    });
    return {
      inDnd: true,
      delivery: 'suppressed'
    };
  };
}
