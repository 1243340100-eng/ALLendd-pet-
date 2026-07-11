/**
 * AppEventBus：统一事件总线。
 * 对应架构计划第 4 节"AppEvent → GraphDispatcher"。
 *
 * 所有入口（IPC、Scheduler、系统事件）先转换成 AppEvent，
 * 再通过 EventBus 分发给 GraphDispatcher。
 *
 * 设计：
 * - 发布订阅模式
 * - 支持同步和异步订阅者
 * - 不依赖 Electron，可独立测试
 */
import type { AppEvent } from '../shared/contracts/app-event';
import { createLogger } from '../infrastructure/logging/logger';

const log = createLogger('AppEventBus');

export type EventHandler = (event: AppEvent) => void | Promise<void>;

export class AppEventBus {
  private handlers = new Map<string, Set<EventHandler>>();
  private wildcardHandlers = new Set<EventHandler>();
  private eventHistory: AppEvent[] = [];
  private readonly maxHistorySize: number;

  constructor(maxHistorySize = 100) {
    this.maxHistorySize = maxHistorySize;
  }

  /** 订阅特定类型事件 */
  on(eventType: string, handler: EventHandler): void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
    }
    this.handlers.get(eventType)!.add(handler);
    log.debug('handler registered', { fields: { eventType } });
  }

  /** 订阅所有事件（通配） */
  onAny(handler: EventHandler): void {
    this.wildcardHandlers.add(handler);
  }

  /** 取消订阅 */
  off(eventType: string, handler: EventHandler): void {
    this.handlers.get(eventType)?.delete(handler);
  }

  /** 发布事件 */
  async publish(event: AppEvent): Promise<void> {
    log.info('event published', {
      fields: {
        eventId: event.eventId,
        type: event.type,
        source: event.source,
        userId: event.userId
      }
    });

    // 记录历史（用于调试和重放）
    this.eventHistory.push(event);
    if (this.eventHistory.length > this.maxHistorySize) {
      this.eventHistory.shift();
    }

    // 分发给特定类型订阅者
    const typeHandlers = this.handlers.get(event.type);
    if (typeHandlers) {
      for (const handler of typeHandlers) {
        try {
          await handler(event);
        } catch (error) {
          log.error('event handler threw', {
            fields: {
              eventType: event.type,
              eventId: event.eventId,
              error: (error as Error)?.message
            }
          });
        }
      }
    }

    // 分发给通配订阅者
    for (const handler of this.wildcardHandlers) {
      try {
        await handler(event);
      } catch (error) {
        log.error('wildcard handler threw', {
          fields: {
            eventType: event.type,
            eventId: event.eventId,
            error: (error as Error)?.message
          }
        });
      }
    }
  }

  /** 获取最近的事件历史（用于调试） */
  getHistory(): AppEvent[] {
    return [...this.eventHistory];
  }

  /** 清空历史 */
  clearHistory(): void {
    this.eventHistory = [];
  }
}
