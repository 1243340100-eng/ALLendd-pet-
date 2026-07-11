/**
 * SQLite 数据库连接管理。
 * 对应架构计划第 8 节"推荐使用 SQLite 和版本化 migration"。
 *
 * 设计：
 * - 单例连接，WAL 模式提升并发读
 * - 启用时自动初始化空库
 * - 迁移前自动备份（升级不覆盖用户数据）
 * - 迁移在初始化后执行
 */
import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import { existsSync, copyFileSync, statSync, readdirSync, unlinkSync } from 'fs';
import { join, dirname, basename } from 'path';
import { runMigrations } from './migration-runner';
import { getCurrentMigrationVersion } from './migration-runner';
import { createLogger } from '../logging/logger';

const log = createLogger('database');

let dbInstance: DatabaseType | null = null;

export interface DatabaseOptions {
  /** 数据库文件路径。':memory:' 用于测试 */
  path: string;
  /** 是否启用 WAL（测试可关闭） */
  wal?: boolean;
  /** 迁移前是否自动备份（默认 true，':memory:' 路径自动跳过） */
  backupBeforeMigration?: boolean;
  /** 保留的最大备份数量（默认 3） */
  maxBackups?: number;
}

/** 迁移前备份数据库文件 */
function backupDatabaseIfNeeded(options: DatabaseOptions): void {
  const dbPath = options.path;
  if (dbPath === ':memory:' || options.backupBeforeMigration === false) {
    return;
  }
  if (!existsSync(dbPath)) {
    return; // 新建数据库，无需备份
  }

  const stat = statSync(dbPath);
  if (stat.size === 0) {
    return; // 空文件，无需备份
  }

  const dir = dirname(dbPath);
  const name = basename(dbPath);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = join(dir, `${name}.backup-${timestamp}`);

  try {
    copyFileSync(dbPath, backupPath);
    log.info('database backed up before migration', { fields: { backupPath } });

    // 清理超出 maxBackups 的旧备份
    const maxBackups = options.maxBackups ?? 3;
    const backups = readdirSync(dir)
      .filter(f => f.startsWith(`${name}.backup-`))
      .sort()
      .reverse();
    for (const old of backups.slice(maxBackups)) {
      try {
        unlinkSync(join(dir, old));
        log.debug('old backup removed', { fields: { file: old } });
      } catch {
        // 忽略删除失败
      }
    }
  } catch (error) {
    log.warn('database backup failed, continuing with migration', {
      fields: { error: (error as Error)?.message }
    });
  }
}

/** 打开/创建数据库，执行迁移，返回连接 */
export function openDatabase(options: DatabaseOptions): DatabaseType {
  const dbPath = options.path;
  log.info('opening database', { fields: { path: dbPath } });

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // 检查是否需要迁移（全新数据库无 _migrations 表，返回 0 表示需要全量迁移，无需备份）
  let currentVersion = 0;
  try {
    const tableExists = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='_migrations'"
    ).get() as { name: string } | undefined;
    if (tableExists) {
      currentVersion = getCurrentMigrationVersion(db);
    }
  } catch {
    // 忽略：全新数据库
  }

  const latestVersion = 1; // 与 migration-runner 的 ALL_MIGRATIONS 一致
  if (currentVersion > 0 && currentVersion < latestVersion) {
    // 需要升级：先备份
    backupDatabaseIfNeeded(options);
  }

  runMigrations(db);

  log.info('database ready');
  return db;
}

/** 获取单例连接 */
export function getDatabase(): DatabaseType {
  if (!dbInstance) {
    throw new Error('Database not initialized. Call openDatabase first.');
  }
  return dbInstance;
}

/** 初始化全局单例 */
export function initDatabase(options: DatabaseOptions): DatabaseType {
  if (dbInstance) {
    return dbInstance;
  }
  dbInstance = openDatabase(options);
  return dbInstance;
}

/** 关闭连接（主要用于测试和关闭） */
export function closeDatabase(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
    log.info('database closed');
  }
}

/** 事务包装：全部成功才提交，任一失败回滚 */
export function transaction<T>(fn: () => T): T {
  const db = getDatabase();
  return db.transaction(fn)();
}

