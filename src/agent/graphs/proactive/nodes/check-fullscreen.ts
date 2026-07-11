/**
 * 节点：check_fullscreen
 * 全屏检测。
 *
 * 全屏游戏时暂停所有桌宠主动弹出、声音和系统通知。
 * 全屏期间到期提醒保留为待投递，退出全屏后补发。
 * 非提醒型主动行为在全屏时直接跳过。
 */
import type { ProactiveStateType, ProactiveStateUpdate } from '../state';
import type { FullscreenAdapter } from '../../../../adapters/fullscreen/FullscreenAdapter';
import { createLogger } from '../../../../infrastructure/logging/logger';

const log = createLogger('ProactiveGraph:check_fullscreen');

export function createCheckFullscreenNode(fullscreenAdapter: FullscreenAdapter) {
  return async function checkFullscreen(
    state: ProactiveStateType
  ): Promise<ProactiveStateUpdate> {
    const isFullscreen = fullscreenAdapter.isFullscreen();

    log.info('checking fullscreen', {
      traceId: state.traceId,
      fields: { isFullscreen, proactiveType: state.proactiveType }
    });

    if (!isFullscreen) {
      return { fullscreen: false };
    }

    // 全屏时的策略
    if (state.proactiveType === 'reminder') {
      // 提醒保留为待投递，退出全屏后补发
      log.info('fullscreen active, deferring reminder', {
        fields: { dedupeKey: state.event.dedupeKey }
      });
      return {
        fullscreen: true,
        delivery: 'deferred'
      };
    }

    // 非提醒型主动行为直接跳过
    log.info('fullscreen active, suppressing non-reminder', {
      fields: { proactiveType: state.proactiveType }
    });
    return {
      fullscreen: true,
      delivery: 'suppressed'
    };
  };
}
