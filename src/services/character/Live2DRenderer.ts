/**
 * Live2DRenderer：Live2D 渲染器接口（空实现）。
 * 对应架构计划第 1 节 CharacterRenderer → Live2DRenderer 接口。
 *
 * V1 不要求完整实现 Live2D。
 * 仅定义接口和空实现，为未来扩展预留。
 */
import { createLogger } from '../../infrastructure/logging/logger';

const log = createLogger('Live2DRenderer');

/** Live2D 模型配置 */
export interface Live2DModelConfig {
  modelPath: string;
  textures: string[];
  motions?: Record<string, Array<{ file: string; sound?: string }>>;
  expressions?: Record<string, string>;
  physics?: string;
}

/**
 * Live2D 渲染器接口。
 * V1 只提供空实现，不加载实际 Live2D 模型。
 */
export class Live2DRenderer {
  private available = false;
  private modelConfig: Live2DModelConfig | null = null;

  constructor() {
    log.info('Live2DRenderer initialized (stub, V1 not implemented)');
  }

  /**
   * 尝试加载 Live2D 模型。
   * V1 始终返回 false（不可用）。
   */
  loadModel(config: Live2DModelConfig): boolean {
    log.info('Live2D loadModel called (stub)', {
      fields: { modelPath: config.modelPath }
    });
    this.modelConfig = config;
    // V1 不实际加载，标记为不可用
    this.available = false;
    return this.available;
  }

  /** Live2D 是否可用 */
  isAvailable(): boolean {
    return this.available;
  }

  /** 设置动作 */
  setMotion(_motion: string): void {
    log.debug('Live2D setMotion (stub, no-op)');
  }

  /** 设置表情 */
  setExpression(_expression: string): void {
    log.debug('Live2D setExpression (stub, no-op)');
  }

  /** 降级到 SpriteSheet */
  degradeToSpriteSheet(): 'spritesheet' {
    log.warn('Live2D not available, degrading to spritesheet');
    return 'spritesheet';
  }
}
