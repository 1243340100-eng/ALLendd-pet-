/**
 * 旧 JSON 数据迁移测试。
 * 对应 P1-5：旧 JSON 数据到 SQLite 迁移。
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { initDatabase, closeDatabase } from '../../src/infrastructure/database/connection';
import { settingsRepository } from '../../src/infrastructure/database/repositories/settings-repository';
import { memoryRepository } from '../../src/infrastructure/database/repositories/memory-repository';
import { migrateLegacyJsonData } from '../../src/infrastructure/migration/legacy-json-migrator';

function check(name: string, condition: boolean): void {
  if (condition) {
    console.log(`PASS ${name}`);
  } else {
    console.log(`FAIL ${name}`);
    process.exitCode = 1;
  }
}

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pet-migration-'));
}

function writeJson(filePath: string, data: unknown): void {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function createTempDb(): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petdb-migration-'));
  return path.join(tempDir, 'test.sqlite');
}

function cleanupDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // 忽略清理失败
  }
}

function runTest(name: string, fn: () => void): void {
  try {
    fn();
  } catch (error) {
    console.log(`FAIL ${name}: ${(error as Error)?.message || error}`);
    process.exitCode = 1;
  }
}

runTest('Migration: no legacy files → marks complete, no data', () => {
  const userDataDir = createTempDir();
  const dbPath = createTempDb();
  initDatabase({ path: dbPath });

  try {
    const result = migrateLegacyJsonData(userDataDir);
    check('NoFiles: migrated=true', result.migrated === true);
    check('NoFiles: 0 memories', result.memoriesMigrated === 0);
    check('NoFiles: marked complete', settingsRepository.get('migration.legacy_json.completed') === 'true');
  } finally {
    closeDatabase();
    cleanupDir(userDataDir);
    cleanupDir(path.dirname(dbPath));
  }
});

runTest('Migration: idempotent (second run skips)', () => {
  const userDataDir = createTempDir();
  const dbPath = createTempDb();
  initDatabase({ path: dbPath });

  try {
    // 第一次迁移（无文件）
    migrateLegacyJsonData(userDataDir);

    // 写入旧数据文件
    writeJson(path.join(userDataDir, 'pet-data.json'), {
      profile: { userName: '测试用户' },
      memory: { user: [{ id: 'mem-1', content: '测试记忆' }] }
    });

    // 第二次迁移应跳过
    const result = migrateLegacyJsonData(userDataDir);
    check('Idempotent: migrated=false', result.migrated === false);
    check('Idempotent: 0 memories (skipped)', result.memoriesMigrated === 0);
  } finally {
    closeDatabase();
    cleanupDir(userDataDir);
    cleanupDir(path.dirname(dbPath));
  }
});

runTest('Migration: migrates profile and memories', () => {
  const userDataDir = createTempDir();
  const dbPath = createTempDb();
  initDatabase({ path: dbPath });

  try {
    // 写入旧 pet-data.json
    writeJson(path.join(userDataDir, 'pet-data.json'), {
      profile: {
        userName: '老用户',
        preferredName: '老用户昵称'
      },
      memory: {
        user: [
          { id: 'legacy-u1', content: '用户喜欢咖啡', confidence: 0.9 }
        ],
        longTerm: [
          { id: 'legacy-l1', content: '用户养了一只猫', tags: ['event'] }
        ],
        shortTerm: []
      },
      affection: {
        score: 75,
        level: 'close'
      }
    });

    const result = migrateLegacyJsonData(userDataDir);
    check('ProfileMem: migrated=true', result.migrated === true);
    check('ProfileMem: 2 memories migrated', result.memoriesMigrated === 2);
    check('ProfileMem: settings migrated > 0', result.settingsMigrated > 0);

    // 验证设置
    check('ProfileMem: nickname migrated', settingsRepository.get('user_nickname') === '老用户');
    check('ProfileMem: preferred name migrated', settingsRepository.get('user_preferred_name') === '老用户昵称');
    check('ProfileMem: affection score', settingsRepository.get('affection_score') === '75');
    check('ProfileMem: affection level', settingsRepository.get('affection_level') === 'close');

    // 验证记忆
    const mem1 = memoryRepository.getById('legacy-u1');
    check('ProfileMem: user memory exists', mem1 !== null);
    check('ProfileMem: user memory is global', mem1?.scope === 'global');
    check('ProfileMem: user memory content', mem1?.content === '用户喜欢咖啡');

    const mem2 = memoryRepository.getById('legacy-l1');
    check('ProfileMem: longTerm memory exists', mem2 !== null);
    check('ProfileMem: longTerm memory is character', mem2?.scope === 'character');
    check('ProfileMem: longTerm memory type is event', mem2?.type === 'event');
  } finally {
    closeDatabase();
    cleanupDir(userDataDir);
    cleanupDir(path.dirname(dbPath));
  }
});

runTest('Migration: migrates API config (non-secret)', () => {
  const userDataDir = createTempDir();
  const dbPath = createTempDb();
  initDatabase({ path: dbPath });

  try {
    writeJson(path.join(userDataDir, 'api-config.json'), {
      provider: 'openai',
      endpoint: 'https://api.openai.com/v1/chat/completions',
      model: 'gpt-4o',
      apiKey: 'sk-secret-key'
    });

    const result = migrateLegacyJsonData(userDataDir);
    check('ApiConfig: migrated=true', result.migrated === true);

    // 非密钥部分迁移到 app_settings
    check('ApiConfig: provider', settingsRepository.get('api_provider') === 'openai');
    check('ApiConfig: endpoint', settingsRepository.get('api_endpoint') === 'https://api.openai.com/v1/chat/completions');
    check('ApiConfig: model', settingsRepository.get('api_model') === 'gpt-4o');

    // API Key 不应出现在 app_settings（仍由 safeStorage 管理）
    check('ApiConfig: api key not in settings', settingsRepository.get('api_key') === null);
  } finally {
    closeDatabase();
    cleanupDir(userDataDir);
    cleanupDir(path.dirname(dbPath));
  }
});

runTest('Migration: does not overwrite existing settings', () => {
  const userDataDir = createTempDir();
  const dbPath = createTempDb();
  initDatabase({ path: dbPath });

  try {
    // 预设已有设置（模拟用户已通过 onboarding 配置）
    settingsRepository.set('user_nickname', '新名字');
    settingsRepository.set('affection_score', '30');

    writeJson(path.join(userDataDir, 'pet-data.json'), {
      profile: { userName: '旧名字' },
      affection: { score: 80 }
    });

    migrateLegacyJsonData(userDataDir);

    // 不应覆盖已有值
    check('NoOverwrite: nickname preserved', settingsRepository.get('user_nickname') === '新名字');
    check('NoOverwrite: affection preserved', settingsRepository.get('affection_score') === '30');
  } finally {
    closeDatabase();
    cleanupDir(userDataDir);
    cleanupDir(path.dirname(dbPath));
  }
});

runTest('Migration: skips expired shortTerm memories', () => {
  const userDataDir = createTempDir();
  const dbPath = createTempDb();
  initDatabase({ path: dbPath });

  try {
    writeJson(path.join(userDataDir, 'pet-data.json'), {
      memory: {
        shortTerm: [
          {
            id: 'st-expired',
            content: '已过期的记忆',
            expiresAt: '2020-01-01T00:00:00.000Z',
            profileCandidate: true
          },
          {
            id: 'st-valid',
            content: '有效的候选记忆',
            expiresAt: '2099-12-31T00:00:00.000Z',
            profileCandidate: true
          },
          {
            id: 'st-no-candidate',
            content: '非候选记忆',
            profileCandidate: false
          }
        ]
      }
    });

    const result = migrateLegacyJsonData(userDataDir);
    check('ShortTerm: migrated=true', result.migrated === true);
    check('ShortTerm: only 1 memory migrated', result.memoriesMigrated === 1);

    check('ShortTerm: expired not migrated', memoryRepository.getById('st-expired') === null);
    check('ShortTerm: valid migrated', memoryRepository.getById('st-valid') !== null);
    check('ShortTerm: non-candidate not migrated', memoryRepository.getById('st-no-candidate') === null);
  } finally {
    closeDatabase();
    cleanupDir(userDataDir);
    cleanupDir(path.dirname(dbPath));
  }
});

runTest('Migration: does not delete original JSON files', () => {
  const userDataDir = createTempDir();
  const dbPath = createTempDb();
  initDatabase({ path: dbPath });

  const petDataPath = path.join(userDataDir, 'pet-data.json');
  const apiConfigPath = path.join(userDataDir, 'api-config.json');

  try {
    writeJson(petDataPath, { profile: { userName: '保留测试' } });
    writeJson(apiConfigPath, { provider: 'deepseek' });

    migrateLegacyJsonData(userDataDir);

    check('NoDelete: pet-data.json preserved', fs.existsSync(petDataPath) === true);
    check('NoDelete: api-config.json preserved', fs.existsSync(apiConfigPath) === true);
  } finally {
    closeDatabase();
    cleanupDir(userDataDir);
    cleanupDir(path.dirname(dbPath));
  }
});

console.log('\n=== 测试结果 ===');
