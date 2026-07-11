/**
 * NotificationAdapter：系统通知适配器。
 * 对应架构计划第 5.3 节系统通知和声音。
 *
 * 系统通知和声音分别设置。
 */
import { createLogger } from '../../infrastructure/logging/logger';

const log = createLogger('NotificationAdapter');

/** 通知适配器接口 */
export interface NotificationAdapter {
  /**
   * 显示系统通知。
   * @returns true 表示通知成功显示；false 表示不支持、构造失败或 show 抛错。
   * 返回 false 时调用方应回退到 pet_bubble 并等待 Renderer ACK。
   */
  showNotification(title: string, body: string): Promise<boolean>;
  /** 是否启用系统通知 */
  isNotificationEnabled(): boolean;
  /** 是否启用声音 */
  isSoundEnabled(): boolean;
}

/**
 * 默认通知适配器。
 * V1 使用 Electron 的 Notification API。
 * 测试时可注入 mock。
 */
export class DefaultNotificationAdapter implements NotificationAdapter {
  private notificationEnabled: boolean;
  private soundEnabled: boolean;

  constructor(notificationEnabled = false, soundEnabled = false) {
    this.notificationEnabled = notificationEnabled;
    this.soundEnabled = soundEnabled;
  }

  async showNotification(title: string, body: string): Promise<boolean> {
    if (!this.notificationEnabled) {
      log.debug('notification disabled, skipping', { fields: { title } });
      return false;
    }

    // 尝试使用 Electron Notification API；非 Electron 环境（测试）返回 false
    try {
      const { Notification } = require('electron');
      if (!Notification?.isSupported?.()) {
        log.warn('notification not supported by platform', { fields: { title } });
        return false;
      }
      const notification = new Notification({ title, body, silent: !this.soundEnabled });
      notification.show();
      log.info('notification shown', { fields: { title, body: body.slice(0, 50) } });
      return true;
    } catch (error) {
      log.warn('notification show failed', {
        fields: { title, error: (error as Error)?.message }
      });
      return false;
    }
  }

  isNotificationEnabled(): boolean {
    return this.notificationEnabled;
  }

  isSoundEnabled(): boolean {
    return this.soundEnabled;
  }

  /** 更新设置 */
  updateSettings(notificationEnabled: boolean, soundEnabled: boolean): void {
    this.notificationEnabled = notificationEnabled;
    this.soundEnabled = soundEnabled;
  }
}
