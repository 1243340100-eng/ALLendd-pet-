/**
 * 旧 JSON 数据到 SQLite 的迁移器。
 * 对应架构计划"升级不覆盖用户数据"要求。
 *
 * 读取旧版 pet-data.json 和 api-config.json，将记忆、好感度、用户档案、
 * API 配置（非密钥部分）迁移到新架构的 SQLite 数据库。
 *
 * 特性：
 * - 幂等：通过 app_settings 中的 migration.legacy_json.completed 标记，只执行一次
 * - 安全：迁移失败不阻断启动，只记录警告
 * - 保留旧文件：迁移后不删除原始 JSON，只标记完成
 */
import * as fs from 'fs';
import * as path from 'path';
import { getDatabase } from '../database/connection';
import { settingsRepository } from '../database/repositories/settings-repository';
import { memoryRepository } from '../database/repositories/memory-repository';
import { createLogger } from '../logging/logger';

const log = createLogger('LegacyJsonMigrator');

const MIGRATION_FLAG_KEY = 'migration.legacy_json.completed';
const DEFAULT_USER_ID = 'default-user';
const DEFAULT_CHARACTER_ID = 'default-roxy';

/** 旧版 pet-data.json 的结构（仅需要迁移的字段） */
interface LegacyPetData {
  profile?: {
    userName?: string;
    preferredName?: string;
    notes?: unknown[];
  };
  memory?: {
    user?: LegacyMemoryEntry[];
    longTerm?: LegacyMemoryEntry[];
    shortTerm?: LegacyMemoryEntry[];
  };
  affection?: {
    score?: number;
    level?: string;
    events?: unknown[];
  };
  chat?: {
    sessions?: unknown[];
    lastSessionId?: string;
  };
}

interface LegacyMemoryEntry {
  id?: string;
  content?: string;
  source?: string;
  importance?: number;
  createdAt?: string;
  updatedAt?: string;
  tags?: string[];
  // user 类型特有
  category?: string;
  key?: string;
  value?: string;
  confidence?: number;
  pinned?: boolean;
  sourceMessage?: string;
  // shortTerm 特有
  expiresAt?: string;
  topic?: string;
  profileCandidate?: boolean;
}

/** 旧版 api-config.json 的结构 */
interface LegacyApiConfig {
  provider?: string;
  endpoint?: string;
  model?: string;
  apiKey?: string;
}

/**
 * 执行旧 JSON → SQLite 迁移。
 * 在 initNewArchitecture 之后、首次使用前调用。
 * 返回迁移统计信息。
 */
export function migrateLegacyJsonData(userDataDir: string): {
  migrated: boolean;
  memoriesMigrated: number;
  settingsMigrated: number;
} {
  const result = { migrated: false, memoriesMigrated: 0, settingsMigrated: 0 };

  // 1. 检查是否已迁移
  if (settingsRepository.get(MIGRATION_FLAG_KEY) === 'true') {
    log.info('legacy json migration already completed, skipping');
    return result;
  }

  const petDataPath = path.join(userDataDir, 'pet-data.json');
  const apiConfigPath = path.join(userDataDir, 'api-config.json');

  // 2. 检查旧文件是否存在
  if (!fs.existsSync(petDataPath) && !fs.existsSync(apiConfigPath)) {
    // 没有旧数据需要迁移，直接标记完成
    settingsRepository.set(MIGRATION_FLAG_KEY, 'true');
    log.info('no legacy json files found, marking migration complete');
    result.migrated = true;
    return result;
  }

  log.info('starting legacy json migration', {
    fields: { userDataDir, hasPetData: fs.existsSync(petDataPath), hasApiConfig: fs.existsSync(apiConfigPath) }
  });

  try {
    const db = getDatabase();

    // 3. 确保有默认用户记录
    ensureDefaultUser(db);

    // 4. 迁移 pet-data.json
    if (fs.existsSync(petDataPath)) {
      const raw = fs.readFileSync(petDataPath, 'utf8');
      const petData: LegacyPetData = JSON.parse(raw);
      migrateProfile(petData, result);
      migrateMemories(petData, result);
      migrateAffection(petData, result);
    }

    // 5. 迁移 api-config.json（仅非密钥部分）
    if (fs.existsSync(apiConfigPath)) {
      const raw = fs.readFileSync(apiConfigPath, 'utf8');
      const apiConfig: LegacyApiConfig = JSON.parse(raw);
      migrateApiConfig(apiConfig, result);
    }

    // 6. 标记完成
    settingsRepository.set(MIGRATION_FLAG_KEY, 'true');
    result.migrated = true;
    log.info('legacy json migration complete', {
      fields: {
        memoriesMigrated: result.memoriesMigrated,
        settingsMigrated: result.settingsMigrated
      }
    });
  } catch (error) {
    // 迁移失败不阻断启动，下次启动会重试
    log.error('legacy json migration failed, will retry on next launch', {
      fields: { error: (error as Error)?.message }
    });
  }

  return result;
}

/** 确保默认用户记录存在 */
function ensureDefaultUser(db: ReturnType<typeof getDatabase>): void {
  const existing = db.prepare('SELECT id FROM users WHERE id = ?').get(DEFAULT_USER_ID);
  if (!existing) {
    db.prepare('INSERT INTO users (id, nickname, preferred_name) VALUES (?, ?, ?)').run(
      DEFAULT_USER_ID,
      '',
      ''
    );
  }
}

/** 迁移用户档案 → app_settings */
function migrateProfile(petData: LegacyPetData, result: { settingsMigrated: number }): void {
  const profile = petData.profile;
  if (!profile) return;

  if (profile.userName) {
    // 不覆盖已有的设置（用户可能已通过 onboarding 配置）
    if (!settingsRepository.get('user_nickname')) {
      settingsRepository.set('user_nickname', profile.userName);
      result.settingsMigrated++;
    }
  }

  if (profile.preferredName) {
    if (!settingsRepository.get('user_preferred_name')) {
      settingsRepository.set('user_preferred_name', profile.preferredName);
      result.settingsMigrated++;
    }
  }
}

/** 迁移记忆 → memories 表 */
function migrateMemories(petData: LegacyPetData, result: { memoriesMigrated: number }): void {
  const memory = petData.memory;
  if (!memory) return;

  let count = 0;

  // user 记忆 → global scope
  if (Array.isArray(memory.user)) {
    for (const entry of memory.user) {
      if (migrateSingleMemory(entry, 'global', 'profile', count)) {
        count++;
      }
    }
  }

  // longTerm 记忆 → 主要是 character scope（事件/偏好）
  if (Array.isArray(memory.longTerm)) {
    for (const entry of memory.longTerm) {
      const type = inferMemoryType(entry);
      if (migrateSingleMemory(entry, 'character', type, count)) {
        count++;
      }
    }
  }

  // shortTerm 记忆 → 只迁移非过期的、有 profileCandidate 标记的
  if (Array.isArray(memory.shortTerm)) {
    for (const entry of memory.shortTerm) {
      // 跳过已过期的短期记忆
      if (entry.expiresAt) {
        const expiresAt = new Date(entry.expiresAt).getTime();
        if (Number.isFinite(expiresAt) && expiresAt < Date.now()) {
          continue;
        }
      }
      // 只迁移标记为 profileCandidate 的短期记忆
      if (!entry.profileCandidate) continue;

      const type = inferMemoryType(entry);
      if (migrateSingleMemory(entry, 'global', type, count)) {
        count++;
      }
    }
  }

  result.memoriesMigrated = count;
}

/**
 * 迁移单条记忆。跳过无内容或 ID 冲突的条目。
 * 返回 true 表示成功插入。
 */
function migrateSingleMemory(
  entry: LegacyMemoryEntry,
  scope: 'global' | 'character',
  type: string,
  index: number
): boolean {
  const content = String(entry.content || '').trim();
  if (!content) return false;

  const id = entry.id || `legacy-mem-${index}-${Date.now()}`;
  // 检查是否已存在（避免重复迁移）
  if (memoryRepository.getById(id)) return false;

  try {
    memoryRepository.insert({
      id,
      user_id: DEFAULT_USER_ID,
      character_id: scope === 'global' ? null : DEFAULT_CHARACTER_ID,
      scope,
      type: type as 'profile' | 'preference' | 'event' | 'relationship' | 'project',
      content,
      structured_data: entry.value ? JSON.stringify({ key: entry.key, value: entry.value }) : null,
      confidence: Number.isFinite(Number(entry.confidence ?? entry.importance))
        ? Number(entry.confidence ?? entry.importance)
        : 0.5,
      source_message_id: entry.sourceMessage ?? null
    });
    return true;
  } catch (error) {
    log.warn('failed to migrate memory entry', {
      fields: { id, error: (error as Error)?.message }
    });
    return false;
  }
}

/** 根据旧记忆的 category/tag 推断新记忆类型 */
function inferMemoryType(entry: LegacyMemoryEntry): string {
  const category = String(entry.category || '').toLowerCase();
  const tags = Array.isArray(entry.tags) ? entry.tags.map((t) => String(t).toLowerCase()) : [];

  if (category.includes('偏好') || category.includes('preference') || tags.includes('preference')) {
    return 'preference';
  }
  if (category.includes('事件') || category.includes('event') || tags.includes('event')) {
    return 'event';
  }
  if (category.includes('关系') || category.includes('relationship') || tags.includes('relationship')) {
    return 'relationship';
  }
  if (category.includes('项目') || category.includes('project') || tags.includes('project')) {
    return 'project';
  }

  return 'event';
}

/** 迁移好感度 → app_settings */
function migrateAffection(petData: LegacyPetData, result: { settingsMigrated: number }): void {
  const affection = petData.affection;
  if (!affection) return;

  if (Number.isFinite(Number(affection.score))) {
    const score = Math.max(0, Math.min(100, Math.round(Number(affection.score))));
    if (!settingsRepository.get('affection_score')) {
      settingsRepository.set('affection_score', String(score));
      result.settingsMigrated++;
    }
  }

  if (affection.level && !settingsRepository.get('affection_level')) {
    settingsRepository.set('affection_level', affection.level);
    result.settingsMigrated++;
  }
}

/** 迁移 API 配置（非密钥部分）→ app_settings */
function migrateApiConfig(apiConfig: LegacyApiConfig, result: { settingsMigrated: number }): void {
  // API Key 仍由旧 safeStorage 管理（SecretStore adapter 读取），不迁移到 SQLite

  if (apiConfig.provider && !settingsRepository.get('api_provider')) {
    settingsRepository.set('api_provider', apiConfig.provider);
    result.settingsMigrated++;
  }

  if (apiConfig.endpoint && !settingsRepository.get('api_endpoint')) {
    settingsRepository.set('api_endpoint', apiConfig.endpoint);
    result.settingsMigrated++;
  }

  if (apiConfig.model && !settingsRepository.get('api_model')) {
    settingsRepository.set('api_model', apiConfig.model);
    result.settingsMigrated++;
  }
}
