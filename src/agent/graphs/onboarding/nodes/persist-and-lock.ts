/**
 * 节点：persist_and_lock
 * W3: 在单一事务中完成所有写入（保存-锁定-完成原子事务）。
 *
 * 事务步骤（任一失败整体回滚，停留在 review 阶段）：
 * 1. 校验 summary 和 compiledProfile
 * 2. 生成 userId（如果尚无）
 * 3. confirmAndLock：保存 profile + 锁定 + 激活（单一子事务）
 * 4. 写入 settings（onboarding_completed, user_id, active_character_id, model_mode, preferences）
 * 5. upsert users 表
 * 6. upsert proactive_policies 表
 * 7. consume checkpoint
 *
 * 幂等：
 * - 重复确认（已锁定）直接返回成功
 *
 * 输出：
 * - characterId：编译后的角色 ID
 * - persona：编译后的 persona（供后续节点使用）
 * - userId：用户 ID
 *
 * 注意：onboarding_completed=true 和 active_character_id 在本节点的同一事务中设置。
 *      save_onboarding_result 节点已被移除（W3 重构），其工作合并到本节点。
 */
import type { OnboardingStateType, OnboardingStateUpdate } from '../state';
import { characterProfileRepository } from '../../../../infrastructure/database/repositories/character-profile-repository';
import { settingsRepository } from '../../../../infrastructure/database/repositories/settings-repository';
import { checkpointRepository } from '../../../../infrastructure/database/repositories/checkpoint-repository';
import { getDatabase, transaction } from '../../../../infrastructure/database/connection';
import { buildScopeKey } from './load-checkpoint';
import { createLogger } from '../../../../infrastructure/logging/logger';

const log = createLogger('OnboardingGraph:persist_and_lock');

/** 生成唯一 ID */
function generateId(prefix: string): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${ts}-${rand}`;
}

export async function persistAndLock(
  state: OnboardingStateType
): Promise<OnboardingStateUpdate> {
  log.info('persisting and locking profile (atomic)', { fields: { traceId: state.traceId } });

  if (!state.compiledProfile) {
    log.error('no compiledProfile present', { fields: { traceId: state.traceId } });
    return {
      currentStep: 'review',
      phase: 'error',
      errorReason: 'no-compiled-profile',
      errors: [...state.errors, 'No compiledProfile present in persist_and_lock']
    };
  }

  if (!state.summary) {
    log.error('no summary present', { fields: { traceId: state.traceId } });
    return {
      currentStep: 'review',
      phase: 'error',
      errorReason: 'no-summary',
      errors: [...state.errors, 'No summary present in persist_and_lock']
    };
  }

  const profile = state.compiledProfile;

  // 生成 userId（如果尚无）
  let userId = state.userId || settingsRepository.get('user_id') || '';
  if (!userId) {
    userId = generateId('user');
    log.info('generated new userId', { fields: { userId } });
  }

  try {
    // W3+B2: 单一事务完成所有写入，任一步失败必须 throw 以触发回滚
    const lockResult = transaction(() => {
      // 1. confirmAndLock：保存 profile + 锁定 + 激活（B2: 失败时 throw，不再返回 {ok:false}）
      const result = characterProfileRepository.confirmAndLock({
        characterId: profile.persona.characterId,
        displayName: profile.persona.characterName,
        baseCharacterId: profile.baseCharacterId,
        requirementSummary: state.summary!,
        persona: profile.persona,
        personalityProfile: profile.personalityProfile,
        configVersion: profile.configVersion
      });
      // confirmAndLock 现在只在成功时返回 {ok:true}，失败会 throw
      if (!result.ok) {
        throw new Error(`confirmAndLock returned !ok: ${result.reason ?? 'unknown'}`);
      }

      const db = getDatabase();

      // 2. upsert users 表（B2: 不吞掉错误，失败时 throw 触发回滚）
      const existing = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
      if (!existing) {
        db.prepare('INSERT INTO users (id, nickname, preferred_name) VALUES (?, ?, ?)').run(
          userId,
          state.preferences?.nickname ?? '',
          state.preferences?.preferredName ?? ''
        );
      } else {
        db.prepare('UPDATE users SET nickname = ?, preferred_name = ? WHERE id = ?').run(
          state.preferences?.nickname ?? '',
          state.preferences?.preferredName ?? '',
          userId
        );
      }

      // 3. 写入 settings（B2: 不吞掉错误）
      settingsRepository.set('onboarding_completed', 'true');
      settingsRepository.set('user_id', userId);
      settingsRepository.set('active_character_id', profile.persona.characterId);
      settingsRepository.set('model_mode', state.modelMode);

      if (state.preferences) {
        settingsRepository.set('user_nickname', state.preferences.nickname);
        settingsRepository.set('user_preferred_name', state.preferences.preferredName);
        settingsRepository.set('reply_length', state.preferences.replyLength);
        settingsRepository.set('proactive_level', state.preferences.proactiveLevel);
        settingsRepository.set('dnd_start', state.preferences.dndStart);
        settingsRepository.set('dnd_end', state.preferences.dndEnd);
        settingsRepository.set('dnd_enabled', String(state.preferences.dndEnabled));
        settingsRepository.set('system_notification_enabled', String(state.preferences.systemNotificationEnabled));
        settingsRepository.set('sound_enabled', String(state.preferences.soundEnabled));
        settingsRepository.set('weather_city', state.preferences.weatherCity);
        settingsRepository.set('weather_enabled', String(state.preferences.weatherEnabled));
        settingsRepository.set('weather_authorized', String(state.preferences.weatherEnabled));
        settingsRepository.set('memory_enabled', String(state.preferences.memoryEnabled));
      }

      // 4. 写入主动策略到 proactive_policies 表（B2: 不吞掉错误，失败时 throw）
      if (state.proactivePolicy) {
        db.prepare(`
          INSERT INTO proactive_policies (id, user_id, character_id, dnd_enabled, dnd_start, dnd_end, max_daily_proactive, ignore_threshold, system_notification_enabled, sound_enabled)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(user_id, character_id) DO UPDATE SET
            dnd_enabled = excluded.dnd_enabled,
            dnd_start = excluded.dnd_start,
            dnd_end = excluded.dnd_end,
            max_daily_proactive = excluded.max_daily_proactive,
            ignore_threshold = excluded.ignore_threshold,
            system_notification_enabled = excluded.system_notification_enabled,
            sound_enabled = excluded.sound_enabled,
            updated_at = datetime('now')
        `).run(
          generateId('policy'),
          userId,
          profile.persona.characterId,
          state.proactivePolicy.dndEnabled ? 1 : 0,
          state.proactivePolicy.dndStart,
          state.proactivePolicy.dndEnd,
          state.proactivePolicy.maxDailyProactive,
          state.proactivePolicy.ignoreThreshold,
          state.proactivePolicy.systemNotificationEnabled ? 1 : 0,
          state.proactivePolicy.soundEnabled ? 1 : 0
        );
      }

      // 5. 消费 checkpoint（B2: 不吞掉错误，失败时 throw 触发整体回滚）
      const scopeKey = buildScopeKey(state);
      const checkpoint = checkpointRepository.getActiveByScope('onboarding', scopeKey);
      if (checkpoint) {
        checkpointRepository.consume(checkpoint.id);
        log.info('checkpoint consumed in atomic transaction', { fields: { scopeKey, id: checkpoint.id } });
      }

      return { ok: true, reason: result.reason };
    });

    log.info('profile persisted and locked atomically', {
      fields: {
        characterId: profile.persona.characterId,
        userId,
        reason: lockResult.reason ?? 'freshly-locked',
        traceId: state.traceId
      }
    });

    return {
      currentStep: 'activate_character',
      characterId: profile.persona.characterId,
      persona: profile.persona,
      userId,
      phase: 'locked'
    };
  } catch (e) {
    // B2: 事务回滚后返回 review/error 状态
    log.error('persist_and_lock threw (transaction rolled back)', {
      fields: { error: (e as Error)?.message, traceId: state.traceId }
    });
    return {
      currentStep: 'review',
      phase: 'error',
      errorReason: 'persist-threw',
      errors: [...state.errors, `Persist and lock threw: ${(e as Error)?.message}`]
    };
  }
}
