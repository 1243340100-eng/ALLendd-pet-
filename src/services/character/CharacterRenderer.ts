/**
 * CharacterRenderer：统一角色渲染接口。
 * 对应架构计划第 1 节系统分层中的 CharacterRenderer。
 *
 * 职责：
 * - 抽象渲染器类型（SpriteSheet / Live2D / Placeholder）
 * - 统一暴露 setState / setMotion / setScale / showBubble / hide / show
 * - Graph 和服务通过此接口控制渲染，不直接操作 DOM 或 IPC
 *
 * 设计：
 * - Renderer 实现运行在 Electron Renderer 进程，通过 IPC 接收指令
 * - 本接口在 Main 进程侧，将渲染指令转发给 Renderer
 * - 切换渲染器不影响 Graph 调用方式
 */
import { createLogger } from '../../infrastructure/logging/logger';

const log = createLogger('CharacterRenderer');

/** 渲染器类型 */
export type RendererType = 'spritesheet' | 'live2d' | 'placeholder';

/** 渲染状态 */
export type RenderState =
  | 'idle'
  | 'waving'
  | 'waiting'
  | 'jumping'
  | 'running'
  | 'running-left'
  | 'running-right'
  | 'failed'
  | 'review';

/** 渲染指令：Main → Renderer 的 IPC 消息 */
export interface RenderCommand {
  type: 'set-state' | 'set-motion' | 'set-scale' | 'show-bubble' | 'hide-bubble' | 'show' | 'hide' | 'set-sprite-sheet';
  state?: RenderState;
  motion?: string;
  scale?: number;
  text?: string;
  durationMs?: number;
  spriteSheetUrl?: string;
  usePlaceholder?: boolean;
}

/** 发送渲染指令到 Renderer 的回调 */
export type SendCommandFn = (channel: string, payload: unknown) => void;

/** CharacterRenderer 配置 */
export interface CharacterRendererOptions {
  /** 初始渲染器类型 */
  type: RendererType;
  /** 发送 IPC 指令的函数 */
  sendCommand: SendCommandFn;
  /** 精灵图 URL（spritesheet 类型用） */
  spriteSheetUrl?: string;
  /** 是否使用占位角色（spritesheet 失败时为 true） */
  usePlaceholder?: boolean;
}

/**
 * 统一角色渲染器。
 * 包装不同渲染器类型，提供统一接口。
 */
export class CharacterRenderer {
  private type: RendererType;
  private send: SendCommandFn;
  private spriteSheetUrl: string;
  private usePlaceholder: boolean;
  private currentState: RenderState = 'idle';

  constructor(options: CharacterRendererOptions) {
    this.type = options.type;
    this.send = options.sendCommand;
    this.spriteSheetUrl = options.spriteSheetUrl ?? '';
    this.usePlaceholder = options.usePlaceholder ?? false;
  }

  /** 当前渲染器类型 */
  getType(): RendererType {
    return this.type;
  }

  /** 当前状态 */
  getCurrentState(): RenderState {
    return this.currentState;
  }

  /** 是否使用占位角色 */
  isPlaceholder(): boolean {
    return this.type === 'placeholder' || this.usePlaceholder;
  }

  /** 切换渲染器类型 */
  switchType(type: RendererType, options?: { spriteSheetUrl?: string }): void {
    log.info('switching renderer', {
      fields: { from: this.type, to: type }
    });
    this.type = type;
    if (options?.spriteSheetUrl !== undefined) {
      this.spriteSheetUrl = options.spriteSheetUrl;
    }
    this.usePlaceholder = type === 'placeholder';
    this.applySpriteSheet();
  }

  /** 应用当前精灵图配置到 Renderer */
  applySpriteSheet(): void {
    this.send('set-sprite-sheet', {
      type: 'set-sprite-sheet',
      spriteSheetUrl: this.spriteSheetUrl,
      usePlaceholder: this.usePlaceholder
    } as RenderCommand);
  }

  /** 设置渲染状态 */
  setState(state: RenderState): void {
    if (state === this.currentState) return;
    this.currentState = state;
    this.send('set-state', { type: 'set-state', state } as RenderCommand);
  }

  /** 设置自定义动作 */
  setMotion(motion: string): void {
    this.send('set-motion', { type: 'set-motion', motion } as RenderCommand);
  }

  /** 设置缩放 */
  setScale(scale: number): void {
    const clamped = Math.max(0.2, Math.min(3, scale));
    this.send('set-scale', { type: 'set-scale', scale: clamped } as RenderCommand);
  }

  /** 显示气泡消息 */
  showBubble(text: string, durationMs?: number): void {
    this.send('show-bubble', {
      type: 'show-bubble',
      text,
      durationMs: durationMs ?? 0
    } as RenderCommand);
  }

  /** 隐藏气泡 */
  hideBubble(): void {
    this.send('hide-bubble', { type: 'hide-bubble' } as RenderCommand);
  }

  /** 显示角色 */
  show(): void {
    this.send('show', { type: 'show' } as RenderCommand);
  }

  /** 隐藏角色 */
  hide(): void {
    this.send('hide', { type: 'hide' } as RenderCommand);
  }
}
