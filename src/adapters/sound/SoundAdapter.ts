/**
 * SoundAdapter：声音适配器。
 * 对应架构计划第 5.3 节声音开关。
 */
import { createLogger } from '../../infrastructure/logging/logger';

const log = createLogger('SoundAdapter');

/** 声音适配器接口 */
export interface SoundAdapter {
  /** 播放提示音 */
  play(sound: string): void;
  /** 是否启用 */
  isEnabled(): boolean;
}

/**
 * 默认声音适配器。
 * V1 使用简单的文件播放或 Electron shell.beep()。
 */
export class DefaultSoundAdapter implements SoundAdapter {
  private enabled: boolean;

  constructor(enabled = false) {
    this.enabled = enabled;
  }

  play(sound: string): void {
    if (!this.enabled) {
      log.debug('sound disabled, skipping', { fields: { sound } });
      return;
    }

    // 尝试使用 Electron shell.beep()；非 Electron 环境（测试）回退到日志
    try {
      const { shell } = require('electron');
      if (shell?.beep) {
        shell.beep();
        log.info('sound played via shell.beep', { fields: { sound } });
        return;
      }
    } catch (error) {
      log.debug('electron shell unavailable, fallback to log', {
        fields: { error: (error as Error)?.message }
      });
    }

    log.info('playing sound (fallback)', { fields: { sound } });
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /** 更新设置 */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }
}
