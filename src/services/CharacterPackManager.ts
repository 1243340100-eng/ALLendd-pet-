/**
 * CharacterPackManager：角色包管理。
 * 对应架构计划第 2.5 节和第 9 节。
 *
 * 职责：
 * - 加载角色包
 * - 校验 manifest 版本和必需资源
 * - 加载 persona、Prompt、动作映射和渲染资源
 * - 保存当前激活角色
 * - 角色包损坏时回退到上一个可用版本
 * - 为多角色切换预留接口
 *
 * V1 只有一个角色，所有配置仍必须带 characterId。
 */
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { createLogger } from '../infrastructure/logging/logger';
import { CharacterPackInvalidError } from '../shared/contracts/errors';
import type { PersonaConfig } from '../shared/contracts/graph-state';

const log = createLogger('CharacterPackManager');

/** manifest schema */
export const manifestSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  persona: z.string().min(1),
  prompt: z.string().min(1),
  motionMap: z.string().min(1),
  renderers: z.object({
    default: z.string(),
    spritesheet: z.object({
      atlas: z.string(),
      metadata: z.string()
    }),
    live2d: z.null().or(z.string()).optional()
  })
});

export type CharacterManifest = z.infer<typeof manifestSchema>;

export interface LoadedCharacterPack {
  manifest: CharacterManifest;
  persona: PersonaConfig;
  prompt: string;
  motionMap: unknown;
  packPath: string;
}

export class CharacterPackManager {
  private activePack: LoadedCharacterPack | null = null;
  private previousPack: LoadedCharacterPack | null = null;

  /**
   * 加载并校验角色包。
   * 失败时回退到上一个可用版本。
   */
  load(packPath: string): LoadedCharacterPack {
    log.info('loading character pack', { fields: { path: packPath } });

    try {
      const pack = this.loadAndValidate(packPath);
      this.previousPack = this.activePack;
      this.activePack = pack;
      log.info('character pack activated', {
        fields: { id: pack.manifest.id, version: pack.manifest.version }
      });
      return pack;
    } catch (error) {
      log.error('character pack load failed', {
        fields: { path: packPath, error: (error as Error)?.message }
      });
      if (this.activePack) {
        log.warn('falling back to previous valid character pack');
        return this.activePack;
      }
      throw error;
    }
  }

  /** 加载并校验角色包 */
  private loadAndValidate(packPath: string): LoadedCharacterPack {
    if (!fs.existsSync(packPath)) {
      throw new CharacterPackInvalidError(packPath, ['Pack path does not exist']);
    }

    const manifestPath = path.join(packPath, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      throw new CharacterPackInvalidError(packPath, ['manifest.json not found']);
    }

    const manifestRaw = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const manifestResult = manifestSchema.safeParse(manifestRaw);
    if (!manifestResult.success) {
      throw new CharacterPackInvalidError(
        packPath,
        manifestResult.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)
      );
    }
    const manifest = manifestResult.data;

    // 校验必需资源存在
    const requiredFiles = [
      manifest.persona,
      manifest.prompt,
      manifest.motionMap,
      manifest.renderers.spritesheet.atlas,
      manifest.renderers.spritesheet.metadata
    ];
    for (const file of requiredFiles) {
      const fullPath = path.join(packPath, file);
      if (!fs.existsSync(fullPath)) {
        throw new CharacterPackInvalidError(manifest.id, [`Required resource missing: ${file}`]);
      }
    }

    // 防止 manifest 指向包目录之外（路径穿越）
    // 使用 path.relative 而非 startsWith，避免前缀绕过（如 C:\packs\foo 通过 C:\packs\foobarsecret 的检查）
    const resolvedPackRoot = path.resolve(packPath);
    for (const file of requiredFiles) {
      const resolved = path.resolve(packPath, file);
      const relative = path.relative(resolvedPackRoot, resolved);
      if (relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new CharacterPackInvalidError(manifest.id, [`Resource path escapes pack directory: ${file}`]);
      }
    }

    const persona = this.loadPersona(path.join(packPath, manifest.persona), manifest.id);
    const prompt = fs.readFileSync(path.join(packPath, manifest.prompt), 'utf8');
    const motionMap = JSON.parse(
      fs.readFileSync(path.join(packPath, manifest.motionMap), 'utf8')
    );

    return { manifest, persona, prompt, motionMap, packPath };
  }

  private loadPersona(personaPath: string, characterId: string): PersonaConfig {
    const raw = JSON.parse(fs.readFileSync(personaPath, 'utf8'));
    return {
      characterId,
      characterName: raw.characterName ?? raw.displayName ?? characterId,
      corePrompt: raw.corePrompt ?? '',
      speakingStyle: raw.speakingStyle ?? [],
      relationshipBoundary: raw.relationshipBoundary ?? [],
      forbiddenDrift: raw.forbiddenDrift ?? [],
      commonTone: raw.commonTone ?? [],
      sampleDialogues: raw.sampleDialogues ?? [],
      userPetName: raw.userPetName,
      defaultLanguage: raw.defaultLanguage,
      memoryGuidance: raw.memoryGuidance,
      reminderGuidance: raw.reminderGuidance
    };
  }

  /** 获取当前激活角色 */
  getActivePack(): LoadedCharacterPack | null {
    return this.activePack;
  }

  /** 获取当前角色 ID */
  getActiveCharacterId(): string | null {
    return this.activePack?.manifest.id ?? null;
  }
}
