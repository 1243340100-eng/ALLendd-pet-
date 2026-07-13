/**
 * Character Profile Repository - 角色编译配置的持久化仓库。
 *
 * 操作 characters 表的 V8 新增列：
 * - base_character_id / requirement_summary_json / persona_json
 * - personality_profile_json / config_version / is_locked
 * - completed_at / locked_at / updated_at
 *
 * 安全约束：
 * - 所有 JSON 读取后必须重新通过 Zod 校验
 * - is_locked=1 必须在确认事务中设置，不允许单独更新
 * - 启动完成条件：active character 存在 + is_locked=1 + persona/personality 校验通过
 */
import { getDatabase, transaction } from '../connection';
import {
  compiledCharacterProfileSchema,
  characterRequirementSummarySchema,
  personalityProfileSchema,
  type CharacterRequirementSummary,
  type CompiledCharacterProfile,
  type PersonalityProfile
} from '../../../services/character-onboarding/schemas';
import type { PersonaConfig } from '../../../shared/contracts/graph-state';
import { createLogger } from '../../logging/logger';

const log = createLogger('CharacterProfileRepository');

/** 数据库行结构 */
export interface CharacterProfileRow {
  id: string;
  display_name: string;
  pack_version: string;
  is_active: number;
  installed_at: string;
  base_character_id: string;
  requirement_summary_json: string | null;
  persona_json: string | null;
  personality_profile_json: string | null;
  config_version: number;
  is_locked: number;
  completed_at: string | null;
  locked_at: string | null;
  updated_at: string;
}

export interface SaveProfileInput {
  /** 角色 ID（characters.id），通常为编译生成的新 ID 或 base_character_id */
  characterId: string;
  displayName: string;
  baseCharacterId: string;
  requirementSummary: CharacterRequirementSummary;
  persona: PersonaConfig;
  personalityProfile: PersonalityProfile;
  configVersion: number;
}

export const characterProfileRepository = {
  /**
   * 保存编译后的角色 Profile（未锁定状态）。
   * 用于 review 阶段保存草案，等待用户确认。
   *
   * W3: 如果记录已锁定（is_locked=1），禁止覆盖（避免重复确认时重置锁定状态）。
   * 已锁定记录直接返回，不修改任何字段。
   */
  saveUnlocked(input: SaveProfileInput): void {
    const db = getDatabase();
    // W3: 检查是否已锁定，已锁定则不覆盖（避免重置 is_locked=0）
    const existing = db.prepare('SELECT is_locked FROM characters WHERE id = ?').get(input.characterId) as { is_locked: number } | undefined;
    if (existing && existing.is_locked === 1) {
      log.warn('saveUnlocked skipped: character already locked', {
        fields: { characterId: input.characterId }
      });
      return;
    }
    db.prepare(`
      INSERT INTO characters (
        id, display_name, pack_version, is_active,
        base_character_id, requirement_summary_json, persona_json, personality_profile_json,
        config_version, is_locked, completed_at, locked_at, updated_at
      ) VALUES (
        @id, @display_name, @pack_version, 0,
        @base_character_id, @requirement_summary_json, @persona_json, @personality_profile_json,
        @config_version, 0, datetime('now'), NULL, datetime('now')
      )
      ON CONFLICT(id) DO UPDATE SET
        display_name = excluded.display_name,
        base_character_id = excluded.base_character_id,
        requirement_summary_json = excluded.requirement_summary_json,
        persona_json = excluded.persona_json,
        personality_profile_json = excluded.personality_profile_json,
        config_version = excluded.config_version,
        is_locked = 0,
        completed_at = datetime('now'),
        locked_at = NULL,
        updated_at = datetime('now')
      WHERE is_locked = 0
    `).run({
      id: input.characterId,
      display_name: input.displayName,
      pack_version: '',
      base_character_id: input.baseCharacterId,
      requirement_summary_json: JSON.stringify(input.requirementSummary),
      persona_json: JSON.stringify(input.persona),
      personality_profile_json: JSON.stringify(input.personalityProfile),
      config_version: input.configVersion
    });
    log.info('unlocked character profile saved', {
      fields: { characterId: input.characterId, configVersion: input.configVersion }
    });
  },

  /**
   * W3: 在单一事务中完成保存 + 锁定 + 激活。
   * 合并 saveUnlocked + lockAndActivate，确保原子性。
   * B2: 任一步失败必须 throw（而非返回 {ok:false}），以触发 better-sqlite3 事务回滚。
   */
  confirmAndLock(input: SaveProfileInput): { ok: boolean; reason?: string } {
    return transaction(() => {
      const db = getDatabase();

      // 1. 检查是否已锁定（幂等）
      const existing = db.prepare('SELECT is_locked FROM characters WHERE id = ?').get(input.characterId) as { is_locked: number } | undefined;
      if (existing && existing.is_locked === 1) {
        log.info('confirmAndLock: character already locked, idempotent success', {
          fields: { characterId: input.characterId }
        });
        return { ok: true, reason: 'already-locked' };
      }

      // 2. 保存未锁定的 profile（INSERT 或 UPDATE，不重置已锁定记录）
      db.prepare(`
        INSERT INTO characters (
          id, display_name, pack_version, is_active,
          base_character_id, requirement_summary_json, persona_json, personality_profile_json,
          config_version, is_locked, completed_at, locked_at, updated_at
        ) VALUES (
          @id, @display_name, @pack_version, 0,
          @base_character_id, @requirement_summary_json, @persona_json, @personality_profile_json,
          @config_version, 0, datetime('now'), NULL, datetime('now')
        )
        ON CONFLICT(id) DO UPDATE SET
          display_name = excluded.display_name,
          base_character_id = excluded.base_character_id,
          requirement_summary_json = excluded.requirement_summary_json,
          persona_json = excluded.persona_json,
          personality_profile_json = excluded.personality_profile_json,
          config_version = excluded.config_version,
          is_locked = 0,
          completed_at = datetime('now'),
          locked_at = NULL,
          updated_at = datetime('now')
        WHERE is_locked = 0
      `).run({
        id: input.characterId,
        display_name: input.displayName,
        pack_version: '',
        base_character_id: input.baseCharacterId,
        requirement_summary_json: JSON.stringify(input.requirementSummary),
        persona_json: JSON.stringify(input.persona),
        personality_profile_json: JSON.stringify(input.personalityProfile),
        config_version: input.configVersion
      });

      // 3. 校验角色存在且未锁定
      const row = db.prepare(
        'SELECT id, is_locked, persona_json, personality_profile_json, base_character_id, config_version FROM characters WHERE id = ?'
      ).get(input.characterId) as
        | { id: string; is_locked: number; persona_json: string | null; personality_profile_json: string | null; base_character_id: string; config_version: number }
        | undefined;

      // B2: 失败必须 throw 以触发事务回滚
      if (!row) {
        throw new Error('confirmAndLock: character-not-found after save');
      }
      if (row.is_locked === 1) {
        return { ok: true, reason: 'already-locked' };
      }
      if (!row.persona_json || !row.personality_profile_json) {
        throw new Error('confirmAndLock: missing-compiled-profile');
      }

      // 4. 重新解析并校验 JSON
      try {
        const personaRaw = JSON.parse(row.persona_json);
        const personalityRaw = JSON.parse(row.personality_profile_json);
        const compiledLike = compiledCharacterProfileSchema.safeParse({
          persona: personaRaw,
          personalityProfile: personalityRaw,
          baseCharacterId: row.base_character_id,
          configVersion: row.config_version,
          sourceRevision: 0,
          compiledAt: ''
        });
        if (!compiledLike.success) {
          log.warn('confirmAndLock compiled profile schema mismatch', {
            fields: {
              characterId: input.characterId,
              issues: compiledLike.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)
            }
          });
          throw new Error('confirmAndLock: compiled-profile-schema-mismatch');
        }
      } catch (e) {
        if (e instanceof Error && e.message.startsWith('confirmAndLock:')) throw e;
        throw new Error('confirmAndLock: compiled-profile-json-invalid');
      }

      // 5. 锁定 + 激活
      db.prepare(`
        UPDATE characters
        SET is_locked = 1, locked_at = datetime('now'), updated_at = datetime('now')
        WHERE id = ? AND is_locked = 0
      `).run(input.characterId);

      // 6. 取消其它角色的 active 状态
      db.prepare(`
        UPDATE characters SET is_active = 0, updated_at = datetime('now') WHERE id != ?
      `).run(input.characterId);

      // 7. 设置当前角色为 active
      db.prepare(`
        UPDATE characters SET is_active = 1, updated_at = datetime('now') WHERE id = ?
      `).run(input.characterId);

      log.info('confirmAndLock: profile saved, locked and activated', {
        fields: { characterId: input.characterId }
      });
      return { ok: true };
    });
  },
  lockAndActivate(characterId: string): { ok: boolean; reason?: string } {
    return transaction(() => {
      const db = getDatabase();
      // 1. 校验角色存在且未锁定（同时读取校验所需字段）
      const row = db.prepare(
        'SELECT id, is_locked, persona_json, personality_profile_json, base_character_id, config_version FROM characters WHERE id = ?'
      ).get(characterId) as
        | { id: string; is_locked: number; persona_json: string | null; personality_profile_json: string | null; base_character_id: string; config_version: number }
        | undefined;

      if (!row) {
        return { ok: false, reason: 'character-not-found' };
      }
      if (row.is_locked === 1) {
        // 幂等：已锁定直接返回成功（重复确认不重复写入）
        return { ok: true, reason: 'already-locked' };
      }
      if (!row.persona_json || !row.personality_profile_json) {
        return { ok: false, reason: 'missing-compiled-profile' };
      }

      // 2. 重新解析并校验 JSON（防御性）
      let persona: PersonaConfig;
      let personalityProfile: PersonalityProfile;
      try {
        const personaRaw = JSON.parse(row.persona_json);
        const personalityRaw = JSON.parse(row.personality_profile_json);
        // 通过 CompiledCharacterProfile schema 间接校验 persona/personality 结构
        // 使用数据库中的实际值，不用空占位（schema 要求 baseCharacterId min(1)、configVersion min(1)）
        const compiledLike = compiledCharacterProfileSchema.safeParse({
          persona: personaRaw,
          personalityProfile: personalityRaw,
          baseCharacterId: row.base_character_id,
          configVersion: row.config_version,
          sourceRevision: 0,
          compiledAt: ''
        });
        if (!compiledLike.success) {
          log.warn('lockAndActivate compiled profile schema mismatch', {
            fields: {
              characterId,
              issues: compiledLike.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)
            }
          });
          return { ok: false, reason: 'compiled-profile-schema-mismatch' };
        }
        persona = personaRaw;
        personalityProfile = personalityRaw;
      } catch (e) {
        return { ok: false, reason: 'compiled-profile-json-invalid' };
      }
      void persona;
      void personalityProfile;

      // 3. 锁定 + 激活（在同一事务内）
      db.prepare(`
        UPDATE characters
        SET is_locked = 1, locked_at = datetime('now'), updated_at = datetime('now')
        WHERE id = ? AND is_locked = 0
      `).run(characterId);

      // 4. 取消其它角色的 active 状态
      db.prepare(`
        UPDATE characters SET is_active = 0, updated_at = datetime('now') WHERE id != ?
      `).run(characterId);

      // 5. 设置当前角色为 active
      db.prepare(`
        UPDATE characters SET is_active = 1, updated_at = datetime('now') WHERE id = ?
      `).run(characterId);

      log.info('character profile locked and activated', {
        fields: { characterId }
      });
      return { ok: true };
    });
  },

  /**
   * 取消锁定（用户在 review 阶段返回修改时调用）。
   * 不删除角色记录，仅解除锁定状态，便于审计。
   */
  unlock(characterId: string): void {
    getDatabase().prepare(`
      UPDATE characters
      SET is_locked = 0, locked_at = NULL, updated_at = datetime('now')
      WHERE id = ?
    `).run(characterId);
    log.info('character profile unlocked', { fields: { characterId } });
  },

  /**
   * 获取已锁定且 active 的角色 Profile。
   * 启动完成条件：active character 存在 + is_locked=1 + persona/personality 校验通过。
   */
  getActiveLockedProfile(): CompiledCharacterProfile | null {
    const row = getDatabase().prepare(`
      SELECT * FROM characters
      WHERE is_active = 1 AND is_locked = 1
      LIMIT 1
    `).get() as CharacterProfileRow | undefined;

    if (!row) return null;
    return this.parseAndValidate(row);
  },

  /** 按 ID 获取角色 Profile */
  getById(characterId: string): CompiledCharacterProfile | null {
    const row = getDatabase().prepare(
      'SELECT * FROM characters WHERE id = ?'
    ).get(characterId) as CharacterProfileRow | undefined;
    if (!row) return null;
    return this.parseAndValidate(row);
  },

  /** 获取未锁定的最新角色（review 阶段或异常恢复用） */
  getLatestUnlocked(): CharacterProfileRow | null {
    const row = getDatabase().prepare(`
      SELECT * FROM characters
      WHERE is_locked = 0 AND persona_json IS NOT NULL
      ORDER BY updated_at DESC
      LIMIT 1
    `).get() as CharacterProfileRow | undefined;
    return row ?? null;
  },

  /** 是否存在任何已锁定的角色 */
  hasLockedCharacter(): boolean {
    const row = getDatabase().prepare(
      'SELECT 1 FROM characters WHERE is_locked = 1 LIMIT 1'
    ).get() as { '1': number } | undefined;
    return !!row;
  },

  /** 解析 JSON 并通过 Zod 校验 */
  parseAndValidate(row: CharacterProfileRow): CompiledCharacterProfile | null {
    return parseAndValidateRow(row);
  }
};

/** 解析 JSON 并通过 Zod 校验（模块级函数） */
function parseAndValidateRow(row: CharacterProfileRow): CompiledCharacterProfile | null {
  if (!row.persona_json || !row.personality_profile_json || !row.requirement_summary_json) {
    return null;
  }
  try {
    const personaRaw = JSON.parse(row.persona_json);
    const personalityRaw = JSON.parse(row.personality_profile_json);
    const summaryRaw = JSON.parse(row.requirement_summary_json);

    const summaryResult = characterRequirementSummarySchema.safeParse(summaryRaw);
    if (!summaryResult.success) {
      log.warn('requirement summary schema mismatch, continuing with default sourceRevision', {
        fields: {
          characterId: row.id,
          issues: summaryResult.error.issues.length,
          firstIssue: summaryResult.error.issues[0]?.message ?? 'unknown'
        }
      });
    }

    const personalityResult = personalityProfileSchema.safeParse(personalityRaw);
    if (!personalityResult.success) {
      log.warn('personality profile schema mismatch', {
        fields: { characterId: row.id, issues: personalityResult.error.issues.length }
      });
      return null;
    }

    const compiled = compiledCharacterProfileSchema.safeParse({
      persona: personaRaw,
      personalityProfile: personalityRaw,
      baseCharacterId: row.base_character_id,
      configVersion: row.config_version,
      sourceRevision: summaryResult.success ? summaryResult.data.sourceRevision : 0,
      compiledAt: row.locked_at ?? row.updated_at
    });

    if (!compiled.success) {
      log.warn('compiled profile schema mismatch', {
        fields: { characterId: row.id, issues: compiled.error.issues.length }
      });
      return null;
    }

    return compiled.data;
  } catch (e) {
    log.warn('failed to parse character profile json', {
      fields: { characterId: row.id, error: (e as Error)?.message }
    });
    return null;
  }
}
