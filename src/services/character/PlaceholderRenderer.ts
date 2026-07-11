/**
 * PlaceholderRenderer：占位角色渲染器。
 * 对应架构计划第 1 节 CharacterRenderer → PlaceholderRenderer。
 * 对应阶段 3 验收："SpriteSheet 失败时显示占位角色"。
 *
 * 职责：
 * - 在精灵图加载失败或角色包损坏时显示占位角色
 * - 提供 CSS 动画占位（SVG/CSS 绘制）
 * - 不依赖任何外部资源
 */
import { createLogger } from '../../infrastructure/logging/logger';
import type { SendCommandFn, RenderState } from './CharacterRenderer';

const log = createLogger('PlaceholderRenderer');

/** 占位角色状态 → CSS 动画名映射 */
const PLACEHOLDER_STATE_MAP: Record<RenderState, string> = {
  idle: 'placeholder-idle',
  waving: 'placeholder-waving',
  waiting: 'placeholder-waiting',
  jumping: 'placeholder-jumping',
  running: 'placeholder-running',
  'running-left': 'placeholder-running-left',
  'running-right': 'placeholder-running-right',
  failed: 'placeholder-failed',
  review: 'placeholder-review'
};

export interface PlaceholderRendererOptions {
  sendCommand: SendCommandFn;
}

/**
 * 占位角色渲染器。
 * 通过 IPC 通知 Renderer 使用占位 SVG。
 */
export class PlaceholderRenderer {
  private send: SendCommandFn;
  private currentState: RenderState = 'idle';

  constructor(options: PlaceholderRendererOptions) {
    this.send = options.sendCommand;
  }

  /** 应用占位角色 */
  apply(): void {
    log.info('applying placeholder renderer');
    this.send('set-sprite-sheet', {
      type: 'set-sprite-sheet',
      spriteSheetUrl: '',
      usePlaceholder: true
    });
  }

  /** 设置状态（映射为 CSS 动画名） */
  setState(state: RenderState): void {
    if (state === this.currentState) return;
    this.currentState = state;
    const animationName = PLACEHOLDER_STATE_MAP[state] ?? PLACEHOLDER_STATE_MAP.idle;
    this.send('set-state', {
      type: 'set-state',
      state,
      motion: animationName
    });
    log.debug('placeholder state set', { fields: { state, animationName } });
  }

  /** 显示气泡 */
  showBubble(text: string, durationMs?: number): void {
    this.send('show-bubble', {
      type: 'show-bubble',
      text,
      durationMs: durationMs ?? 0
    });
  }

  /** 隐藏气泡 */
  hideBubble(): void {
    this.send('hide-bubble', { type: 'hide-bubble' });
  }
}
