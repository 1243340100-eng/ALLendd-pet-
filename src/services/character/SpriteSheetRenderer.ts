/**
 * SpriteSheetRenderer：精灵图渲染器适配器。
 * 对应架构计划第 1 节 CharacterRenderer → SpriteSheetRenderer。
 *
 * 职责：
 * - 封装精灵图渲染所需的资源（atlas + metadata）
 * - 校验精灵图配置
 * - 加载失败时委托 PlaceholderRenderer
 *
 * V1 复用现有 renderer.js 的精灵图渲染逻辑，
 * 本类负责 Main 进程侧的资源管理和降级判断。
 */
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { createLogger } from '../../infrastructure/logging/logger';
import type { CharacterRenderer } from './CharacterRenderer';
import type { RendererType } from './CharacterRenderer';

const log = createLogger('SpriteSheetRenderer');

/** 精灵图元数据 schema */
export const spritesheetMetadataSchema = z.object({
  atlas: z.string().optional(),
  cellWidth: z.number().int().positive(),
  cellHeight: z.number().int().positive(),
  sheetWidth: z.number().int().positive(),
  sheetHeight: z.number().int().positive(),
  maxRow: z.number().int().positive().optional(),
  maxFramesPerRow: z.number().int().positive().optional(),
  fallbackState: z.string().min(1),
  rows: z.record(z.string(), z.object({
    row: z.number().int().min(0),
    frames: z.number().int().min(1).max(64),
    fps: z.number().positive().max(60)
  }))
});

export type SpritesheetMetadata = z.infer<typeof spritesheetMetadataSchema>;

export interface SpriteSheetConfig {
  /** atlas 文件相对路径（来自 manifest） */
  atlasPath: string;
  /** metadata 文件相对路径（来自 manifest） */
  metadataPath: string;
  /** 角色包根目录 */
  packRoot: string;
}

export interface LoadedSpriteSheet {
  metadata: SpritesheetMetadata;
  /** atlas 文件的绝对路径 */
  atlasFullPath: string;
  /** 是否有效（atlas 文件存在且 metadata 通过校验） */
  valid: boolean;
  /** 校验失败原因 */
  errors: string[];
}

/**
 * 精灵图渲染器适配器。
 */
export class SpriteSheetRenderer {
  private config: SpriteSheetConfig;
  private loaded: LoadedSpriteSheet | null = null;

  constructor(config: SpriteSheetConfig) {
    this.config = config;
  }

  /** 加载并校验精灵图资源 */
  load(): LoadedSpriteSheet {
    const errors: string[] = [];
    const atlasFullPath = path.resolve(this.config.packRoot, this.config.atlasPath);
    const metadataFullPath = path.resolve(this.config.packRoot, this.config.metadataPath);

    // 路径穿越检查（使用 path.relative 避免 startsWith 前缀绕过）
    const packRoot = path.resolve(this.config.packRoot);
    const atlasRelative = path.relative(packRoot, atlasFullPath);
    const metadataRelative = path.relative(packRoot, metadataFullPath);
    if (atlasRelative.startsWith('..') || path.isAbsolute(atlasRelative) ||
        metadataRelative.startsWith('..') || path.isAbsolute(metadataRelative)) {
      errors.push('Resource path escapes pack directory');
    }

    // atlas 文件存在
    if (!fs.existsSync(atlasFullPath)) {
      errors.push(`Atlas file not found: ${this.config.atlasPath}`);
    }

    // metadata 文件存在且合法
    let metadata: SpritesheetMetadata | null = null;
    if (fs.existsSync(metadataFullPath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(metadataFullPath, 'utf8'));
        const result = spritesheetMetadataSchema.safeParse(raw);
        if (result.success) {
          metadata = result.data;
        } else {
          errors.push(...result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
        }
      } catch (e) {
        errors.push(`Metadata parse failed: ${(e as Error).message}`);
      }
    } else {
      errors.push(`Metadata file not found: ${this.config.metadataPath}`);
    }

    // 校验 sheet 尺寸能被 cell 整除
    if (metadata) {
      if (metadata.sheetWidth % metadata.cellWidth !== 0) {
        errors.push(`sheetWidth (${metadata.sheetWidth}) not divisible by cellWidth (${metadata.cellWidth})`);
      }
      if (metadata.sheetHeight % metadata.cellHeight !== 0) {
        errors.push(`sheetHeight (${metadata.sheetHeight}) not divisible by cellHeight (${metadata.cellHeight})`);
      }
    }

    const valid = errors.length === 0 && metadata !== null;
    this.loaded = {
      metadata: metadata as SpritesheetMetadata,
      atlasFullPath,
      valid,
      errors
    };

    if (valid) {
      log.info('spritesheet loaded', {
        fields: {
          cellSize: `${metadata!.cellWidth}x${metadata!.cellHeight}`,
          sheetSize: `${metadata!.sheetWidth}x${metadata!.sheetHeight}`,
          rowCount: Object.keys(metadata!.rows).length
        }
      });
    } else {
      log.warn('spritesheet load failed', { fields: { errors } });
    }

    return this.loaded;
  }

  /** 是否已加载且有效 */
  isValid(): boolean {
    return this.loaded?.valid ?? false;
  }

  /** 获取已加载的元数据 */
  getMetadata(): SpritesheetMetadata | null {
    return this.loaded?.metadata ?? null;
  }

  /**
   * 根据状态名查找动画行。
   * 不存在时回退到 fallbackState。
   */
  resolveRow(state: string): { row: number; frames: number; fps: number } | null {
    if (!this.loaded?.metadata) return null;
    const rows = this.loaded.metadata.rows;
    if (state in rows) return rows[state];
    const fallback = this.loaded.metadata.fallbackState;
    return rows[fallback] ?? null;
  }

  /**
   * 降级到 PlaceholderRenderer。
   * 返回新的渲染器类型。
   */
  degradeToPlaceholder(): RendererType {
    log.warn('degrading spritesheet to placeholder');
    return 'placeholder';
  }
}
