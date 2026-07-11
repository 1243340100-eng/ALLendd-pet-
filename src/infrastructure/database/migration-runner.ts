/**
 * 版本化 migration 运行器。
 * 对应架构计划第 8 节"版本化 migration"和第 14 节"在没有 migration 的情况下直接修改生产数据库结构"禁止项。
 *
 * 设计：
 * - _migrations 表记录已执行的 migration
 * - 按 version 顺序执行，每个 migration 只执行一次
 * - 整体在一个事务内，失败回滚
 * - 可重复运行（幂等）
 */
import type { Database as DatabaseType } from 'better-sqlite3';
import { createLogger } from '../logging/logger';

const log = createLogger('migration');

interface MigrationFile {
  version: number;
  name: string;
  sql: string;
  /** 可选：自定义执行函数（需要条件判断时使用，优先于 sql） */
  run?: (db: DatabaseType) => void;
}

/** 检查表中是否已存在某列 */
function columnExists(db: DatabaseType, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some(r => r.name === column);
}

/** 安全添加列：如果列不存在则添加，已存在则跳过 */
function addColumnIfNotExists(db: DatabaseType, table: string, column: string, definition: string): void {
  if (columnExists(db, table, column)) {
    log.info('column already exists, skipping', {
      fields: { table, column }
    });
    return;
  }
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
  log.info('column added', {
    fields: { table, column }
  });
}

/** V1 初始 schema：创建所有核心表 */
const migrationV1: MigrationFile = {
  version: 1,
  name: 'initial_schema',
  sql: `
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  nickname TEXT NOT NULL DEFAULT '',
  preferred_name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS characters (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  pack_version TEXT NOT NULL DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 0,
  installed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS character_packs (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  version TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  validation_status TEXT NOT NULL DEFAULT 'unknown',
  installed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS user_profiles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL DEFAULT '',
  confidence REAL NOT NULL DEFAULT 1.0,
  source TEXT NOT NULL DEFAULT 'inferred',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(user_id, key)
);

CREATE TABLE IF NOT EXISTS character_relationships (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  character_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(user_id, character_id, key)
);

CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  character_id TEXT,
  scope TEXT NOT NULL CHECK (scope IN ('global','character')),
  type TEXT NOT NULL CHECK (type IN ('profile','preference','event','relationship','project')),
  content TEXT NOT NULL,
  structured_data TEXT,
  confidence REAL NOT NULL DEFAULT 0.5,
  source_message_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_memories_user_character ON memories(user_id, character_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_memories_scope ON memories(scope, type, deleted_at);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  character_id TEXT NOT NULL,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_active_at TEXT NOT NULL DEFAULT (datetime('now')),
  is_active INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  character_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
  content TEXT NOT NULL,
  memory_ids TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at);

CREATE TABLE IF NOT EXISTS reminders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  character_id TEXT NOT NULL,
  content TEXT NOT NULL,
  trigger_at TEXT NOT NULL,
  timezone TEXT NOT NULL,
  is_repeating INTEGER NOT NULL DEFAULT 0,
  recurrence_rule TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL DEFAULT 'normal',
  is_active INTEGER NOT NULL DEFAULT 1,
  next_trigger_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_reminders_next_trigger ON reminders(is_active, next_trigger_at);

CREATE TABLE IF NOT EXISTS reminder_occurrences (
  id TEXT PRIMARY KEY,
  reminder_id TEXT NOT NULL,
  scheduled_at TEXT NOT NULL,
  delivered_at TEXT,
  delivery_status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (reminder_id) REFERENCES reminders(id) ON DELETE CASCADE,
  UNIQUE(reminder_id, scheduled_at)
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  character_id TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'todo',
  due_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_tasks_user_status ON tasks(user_id, status, due_at);

CREATE TABLE IF NOT EXISTS proactive_policies (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  character_id TEXT NOT NULL,
  dnd_enabled INTEGER NOT NULL DEFAULT 1,
  dnd_start TEXT NOT NULL DEFAULT '22:00',
  dnd_end TEXT NOT NULL DEFAULT '08:00',
  max_daily_proactive INTEGER NOT NULL DEFAULT 5,
  ignore_threshold INTEGER NOT NULL DEFAULT 2,
  system_notification_enabled INTEGER NOT NULL DEFAULT 0,
  sound_enabled INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, character_id)
);

CREATE TABLE IF NOT EXISTS proactive_deliveries (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  character_id TEXT NOT NULL,
  delivery_type TEXT NOT NULL,
  delivered_at TEXT NOT NULL DEFAULT (datetime('now')),
  ignored INTEGER NOT NULL DEFAULT 0,
  daily_date TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_deliveries_date ON proactive_deliveries(user_id, character_id, delivery_type, daily_date);

CREATE TABLE IF NOT EXISTS permissions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  granted INTEGER NOT NULL DEFAULT 0,
  granted_at TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS graph_checkpoints (
  id TEXT PRIMARY KEY,
  graph_type TEXT NOT NULL,
  state_json TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  consumed_at TEXT
);

CREATE TABLE IF NOT EXISTS reflection_jobs (
  id TEXT PRIMARY KEY,
  turn_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  character_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  payload_json TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  next_retry_at TEXT,
  completed_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_reflection_status ON reflection_jobs(status, next_retry_at);

CREATE TABLE IF NOT EXISTS model_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  called_at TEXT NOT NULL DEFAULT (datetime('now')),
  model TEXT NOT NULL,
  mode TEXT NOT NULL,
  alias TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  success INTEGER NOT NULL DEFAULT 1,
  error_code TEXT,
  trace_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_model_usage_date ON model_usage(called_at);

CREATE TABLE IF NOT EXISTS skill_executions (
  id TEXT PRIMARY KEY,
  skill_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  character_id TEXT NOT NULL,
  success INTEGER NOT NULL DEFAULT 1,
  input_json TEXT,
  output_json TEXT,
  error TEXT,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS event_outbox (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  dedupe_key TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  processed_at TEXT,
  UNIQUE(dedupe_key)
);
CREATE INDEX IF NOT EXISTS idx_outbox_status ON event_outbox(status, created_at);
`
};

/** V2：为 memories 表添加精确到秒的时间字段和来源角色字段 */
const migrationV2: MigrationFile = {
  version: 2,
  name: 'memory_time_precision',
  sql: '',
  run(db: DatabaseType): void {
    addColumnIfNotExists(db, 'memories', 'source_occurred_at', 'TEXT');
    addColumnIfNotExists(db, 'memories', 'write_timezone', 'TEXT');
    addColumnIfNotExists(db, 'memories', 'source_role', "TEXT NOT NULL DEFAULT 'user'");
  }
};

/** V3：清理可能被错误存入的姓名类记忆，并以 users.preferred_name 为权威来源重新写入 */
const migrationV3: MigrationFile = {
  version: 3,
  name: 'cleanup_wrong_name_memories',
  sql: `
-- 软删除与 users.preferred_name 冲突的 profile 类型记忆中包含"叫"或"名字"的记忆
UPDATE memories SET deleted_at = datetime('now')
WHERE deleted_at IS NULL
  AND type = 'profile'
  AND (content LIKE '%叫%' OR content LIKE '%名字%' OR content LIKE '%姓名%')
  AND scope = 'global';

-- 将 users 表的 preferred_name 作为权威记忆插入（如果 preferred_name 非空且不存在重复）
INSERT INTO memories (id, user_id, character_id, scope, type, content, structured_data, confidence, source_message_id, source_role)
SELECT 'mem-profile-preferred-name', u.id, NULL, 'global', 'profile',
       '用户偏好称呼：' || u.preferred_name, NULL, 1.0, NULL, 'user'
FROM users u
WHERE u.preferred_name IS NOT NULL AND u.preferred_name != ''
  AND NOT EXISTS (
    SELECT 1 FROM memories m WHERE m.user_id = u.id AND m.content = '用户偏好称呼：' || u.preferred_name AND m.deleted_at IS NULL
  );
`
};

/** V4：计划任务功能 - plans 和 plan_tasks 表 */
const migrationV4: MigrationFile = {
  version: 4,
  name: 'planning_tables',
  sql: `
CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_plans_status ON plans(status);
CREATE INDEX IF NOT EXISTS idx_plans_date ON plans(date);

CREATE TABLE IF NOT EXISTS plan_tasks (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL,
  content TEXT NOT NULL,
  start_time TEXT,
  end_time TEXT,
  completed INTEGER DEFAULT 0,
  order_index INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_plan_tasks_plan_id ON plan_tasks(plan_id);
`
};

/** 所有已注册的 migration，按 version 升序 */
const ALL_MIGRATIONS: MigrationFile[] = [migrationV1, migrationV2, migrationV3, migrationV4];

/** 执行所有待执行的 migration */
export function runMigrations(db: DatabaseType): { applied: number; currentVersion: number } {
  // 创建 migration 跟踪表
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      executed_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const appliedVersions = new Set(
    db.prepare('SELECT version FROM _migrations').all().map((r: any) => r.version as number)
  );

  let applied = 0;
  const applyMigration = db.transaction(() => {
    for (const migration of ALL_MIGRATIONS) {
      if (appliedVersions.has(migration.version)) continue;
      log.info('applying migration', {
        fields: { version: migration.version, name: migration.name }
      });
      if (migration.run) {
        migration.run(db);
      } else {
        db.exec(migration.sql);
      }
      db.prepare('INSERT INTO _migrations (version, name) VALUES (?, ?)').run(
        migration.version,
        migration.name
      );
      applied++;
    }
  });

  applyMigration();

  const currentVersion = ALL_MIGRATIONS.length > 0
    ? ALL_MIGRATIONS[ALL_MIGRATIONS.length - 1].version
    : 0;

  if (applied > 0) {
    log.info('migrations complete', { fields: { applied, currentVersion } });
  } else {
    log.info('database already at latest version', { fields: { currentVersion } });
  }

  return { applied, currentVersion };
}

/** 获取当前 migration 版本 */
export function getCurrentMigrationVersion(db: DatabaseType): number {
  const row = db.prepare('SELECT MAX(version) as v FROM _migrations').get() as any;
  return row?.v ?? 0;
}
