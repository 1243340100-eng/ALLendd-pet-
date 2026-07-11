/**
 * FullscreenAdapter：全屏检测适配器。
 * 对应架构计划第 5.3 节全屏暂停策略。
 *
 * 全屏游戏时暂停所有桌宠主动弹出、声音和系统通知。
 * 全屏期间到期提醒保留为待投递，退出全屏后补发。
 */
import { createLogger } from '../../infrastructure/logging/logger';

const log = createLogger('FullscreenAdapter');

/** 全屏适配器接口 */
export interface FullscreenAdapter {
  /** 当前是否全屏 */
  isFullscreen(): boolean;
  /** 注册全屏状态变化回调 */
  onFullscreenChange(callback: (fullscreen: boolean) => void): void;
}

/**
 * 默认全屏适配器。
 * V1 使用 Electron 的 screen API 检测。
 * 测试时可注入 mock。
 */
export class DefaultFullscreenAdapter implements FullscreenAdapter {
  private fullscreen = false;
  private callbacks: Array<(fullscreen: boolean) => void> = [];

  isFullscreen(): boolean {
    return this.fullscreen;
  }

  onFullscreenChange(callback: (fullscreen: boolean) => void): void {
    this.callbacks.push(callback);
  }

  /** 设置全屏状态（供 Electron 主进程调用） */
  setFullscreen(fullscreen: boolean): void {
    if (this.fullscreen !== fullscreen) {
      this.fullscreen = fullscreen;
      log.info('fullscreen state changed', { fields: { fullscreen } });
      for (const cb of this.callbacks) {
        try {
          cb(fullscreen);
        } catch (error) {
          log.warn('fullscreen callback error', {
            fields: { error: (error as Error)?.message }
          });
        }
      }
    }
  }
}
