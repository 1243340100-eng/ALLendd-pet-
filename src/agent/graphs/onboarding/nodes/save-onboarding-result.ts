/**
 * 节点：save_onboarding_result
 * 保存 onboarding 结果到数据库。
 * 生成 userId、characterId 和默认会话。
 */
import type { OnboardingStateType, OnboardingStateUpdate } from '../state';
import { settingsRepository } from '../../../../infrastructure/database/repositories/settings-repository';
import { sessionRepository } from '../../../../infrastructure/database/repositories/session-repository';
import { createLogger } from '../../../../infrastructure/logging/logger';

const log = createLogger('OnboardingGraph:save_onboarding_result');

/** 生成唯一 ID */
function generateId(prefix: string): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${ts}-${rand}`;
}

export async function saveOnboardingResult(
  state: OnboardingStateType
): Promise<OnboardingStateUpdate> {
  log.info('saving onboarding result');

  // 守卫：角色包校验失败、Persona 未加载或有未恢复错误时，不标记完成
  if (state.errors.length > 0 || !state.characterId || !state.persona) {
    log.warn('onboarding not completed due to unresolved errors', {
      fields: {
        errorCount: state.errors.length,
        hasCharacterId: !!state.characterId,
        hasPersona: !!state.persona,
        errors: state.errors
      }
    });
    return {
      isCompleted: false,
      currentStep: 'finish'
    };
  }

  // V8 增强：compiledProfile 必须存在且已锁定
  if (!state.compiledProfile) {
    log.warn('onboarding not completed: no compiledProfile', {
      fields: { traceId: state.traceId }
    });
    return {
      isCompleted: false,
      currentStep: 'finish',
      phase: 'error',
      errorReason: 'no-compiled-profile',
      errors: [...state.errors, 'No compiledProfile in save_onboarding_result']
    };
  }

  // 生成 userId（如果尚无）
  let userId = state.userId || settingsRepository.get('user_id') || '';
  if (!userId) {
    userId = generateId('user');
    log.info('generated new userId', { fields: { userId } });
  }

  // 确保有用户记录
  const db = settingsRepository; // 只用于触发数据库初始化
  void db;

  // 写入用户记录（users 表）
  try {
    const { getDatabase } = await import('../../../../infrastructure/database/connection');
    const database = getDatabase();
    const existing = database.prepare('SELECT id FROM users WHERE id = ?').get(userId);
    if (!existing) {
      database.prepare('INSERT INTO users (id, nickname, preferred_name) VALUES (?, ?, ?)').run(
        userId,
        state.preferences?.nickname ?? '',
        state.preferences?.preferredName ?? ''
      );
    } else {
      database.prepare('UPDATE users SET nickname = ?, preferred_name = ? WHERE id = ?').run(
        state.preferences?.nickname ?? '',
        state.preferences?.preferredName ?? '',
        userId
      );
    }
  } catch (error) {
    log.warn('failed to upsert user record', { fields: { error: (error as Error)?.message } });
  }

  // 写入设置
  settingsRepository.set('onboarding_completed', 'true');
  settingsRepository.set('user_id', userId);
  // 仅在 characterId 非空时覆盖，避免角色包加载失败时清空已有设置
  if (state.characterId) {
    settingsRepository.set('active_character_id', state.characterId);
  }
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

  // 写入主动策略到 proactive_policies 表
  if (state.proactivePolicy) {
    try {
      const { getDatabase } = await import('../../../../infrastructure/database/connection');
      const database = getDatabase();
      database.prepare(`
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
        state.characterId,
        state.proactivePolicy.dndEnabled ? 1 : 0,
        state.proactivePolicy.dndStart,
        state.proactivePolicy.dndEnd,
        state.proactivePolicy.maxDailyProactive,
        state.proactivePolicy.ignoreThreshold,
        state.proactivePolicy.systemNotificationEnabled ? 1 : 0,
        state.proactivePolicy.soundEnabled ? 1 : 0
      );
    } catch (error) {
      log.warn('failed to save proactive policy', { fields: { error: (error as Error)?.message } });
    }
  }

  log.info('onboarding result saved', {
    fields: { userId, characterId: state.characterId }
  });

  return {
    currentStep: 'activate_character',
    userId
  };
}
