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

/**
 * V5：PlanningGraph 重构 - 幂等增强 plans/plan_tasks 表。
 * 不修改 V4 已建表结构，只追加列、约束和触发器。
 *
 * 新增：
 * - plans.draft_version：草案版本号，每次 patch 递增
 * - plans.lock_version：乐观锁版本，防止并发覆盖
 * - plans.resolved_model：planningModel 别名解析到的实际模型 ID
 * - plans.response_model：模型 API 返回的 response.model（真实调用模型）
 * - plans.user_confirmed：用户是否明确确认发布（0/1）
 * - 部分唯一索引：同一时间只允许一个 active 计划
 * - status CHECK 触发器：只允许 draft/active/completed
 * - plan_tasks.draft_version：任务级草案版本
 *
 * 所有操作均幂等（IF NOT EXISTS / columnExists 检查）。
 */
const migrationV5: MigrationFile = {
  version: 5,
  name: 'planning_graph_constraints',
  sql: '',
  run(db: DatabaseType): void {
    // 1. plans 表追加列（幂等）
    addColumnIfNotExists(db, 'plans', 'draft_version', 'INTEGER NOT NULL DEFAULT 1');
    addColumnIfNotExists(db, 'plans', 'lock_version', 'INTEGER NOT NULL DEFAULT 0');
    addColumnIfNotExists(db, 'plans', 'resolved_model', 'TEXT');
    addColumnIfNotExists(db, 'plans', 'response_model', 'TEXT');
    addColumnIfNotExists(db, 'plans', 'user_confirmed', 'INTEGER NOT NULL DEFAULT 0');

    // 2. plan_tasks 表追加列（幂等）
    addColumnIfNotExists(db, 'plan_tasks', 'draft_version', 'INTEGER NOT NULL DEFAULT 1');

    // 3. 部分唯一索引：同一日期只允许一个 active 计划（幂等）
    // SQLite 支持 WHERE 子句的部分唯一索引，实现"同时只能有一个 active 计划"
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_plans_active_unique_per_date
      ON plans(date) WHERE status = 'active';
    `);

    // 4. status CHECK 触发器（幂等）- INSERT 时校验
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS trg_plans_status_check_insert
      BEFORE INSERT ON plans
      FOR EACH ROW
      BEGIN
        SELECT CASE
          WHEN NEW.status NOT IN ('draft', 'active', 'completed')
          THEN RAISE(ABORT, 'Invalid plan status: must be draft, active, or completed')
        END;
      END;
    `);

    // 5. status CHECK 触发器 - UPDATE 时校验
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS trg_plans_status_check_update
      BEFORE UPDATE OF status ON plans
      FOR EACH ROW
      WHEN NEW.status IS NOT NULL
      BEGIN
        SELECT CASE
          WHEN NEW.status NOT IN ('draft', 'active', 'completed')
          THEN RAISE(ABORT, 'Invalid plan status: must be draft, active, or completed')
        END;
      END;
    `);

    // 6. 并发保护触发器：更新时校验 lock_version（乐观锁）
    // 应用层读取时记录 lock_version，更新时 WHERE lock_version = ?，
    // 若不匹配则 UPDATE 影响 0 行，应用层检测并重试。
    // 此处不创建触发器，由 repository 层使用 WHERE 条件实现。

    log.info('V5 planning graph constraints applied', {
      fields: {
        addedColumns: ['draft_version', 'lock_version', 'resolved_model', 'response_model', 'user_confirmed'],
        indexes: ['idx_plans_active_unique_per_date'],
        triggers: ['trg_plans_status_check_insert', 'trg_plans_status_check_update']
      }
    });
  }
};

/**
 * V6：checkpoint 隔离 - graph_checkpoints 表添加 scope_key 列。
 * 按 userId + characterId + planningThreadId 隔离，不再全局 getActive('planning')。
 * 幂等：已存在则跳过。
 */
const migrationV6: MigrationFile = {
  version: 6,
  name: 'checkpoint_scope_isolation',
  sql: '',
  run(db: DatabaseType): void {
    addColumnIfNotExists(db, 'graph_checkpoints', 'scope_key', 'TEXT NOT NULL DEFAULT \'\'');
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_graph_checkpoints_scope
      ON graph_checkpoints(graph_type, scope_key, consumed_at);
    `);
    log.info('V6 checkpoint scope isolation applied', {
      fields: { addedColumns: ['scope_key'], indexes: ['idx_graph_checkpoints_scope'] }
    });
  }
};

/**
 * V7：跨日期日历计划 - 扩展 plans 表支持多日期、用户隔离和日历状态机。
 *
 * 新增列（幂等）：
 * - user_id：用户隔离（回填自 app_settings.user_id）
 * - character_id：角色隔离（回填自 app_settings.active_character_id）
 * - timezone：创建时使用的时区（回填 'Asia/Shanghai'）
 * - activated_at：scheduled → active 的激活时间
 * - completed_at：全部任务完成时间
 * - cancelled_at：取消时间
 *
 * 状态扩展：
 * - draft（已有）
 * - scheduled（新增：已确认的未来计划）
 * - active（已有）
 * - completed（已有）
 * - cancelled（新增）
 * - expired（新增：显式保留过期状态）
 *
 * 索引和触发器更新（幂等）：
 * - 删除旧触发器 trg_plans_status_check_insert/_update
 * - 创建新触发器支持 draft/scheduled/active/completed/cancelled/expired
 * - 删除旧唯一索引 idx_plans_active_unique_per_date
 * - 创建新唯一索引 idx_plans_live_unique_per_scope_date
 *   （按 user_id + character_id + date 隔离，只限制 draft/scheduled/active）
 *
 * 回填策略：
 * - 从 app_settings 读取 user_id 和 active_character_id
 * - 旧数据 status 保持不变（draft/active/completed）
 * - 处理旧数据冲突：同一 user_id + character_id + date 多个 live plan 时保留最新
 */
const migrationV7: MigrationFile = {
  version: 7,
  name: 'calendar_planning_extensions',
  sql: '',
  run(db: DatabaseType): void {
    // 1. 添加新列（幂等）
    addColumnIfNotExists(db, 'plans', 'user_id', "TEXT NOT NULL DEFAULT ''");
    addColumnIfNotExists(db, 'plans', 'character_id', "TEXT NOT NULL DEFAULT ''");
    addColumnIfNotExists(db, 'plans', 'timezone', "TEXT NOT NULL DEFAULT 'Asia/Shanghai'");
    addColumnIfNotExists(db, 'plans', 'activated_at', 'TEXT');
    addColumnIfNotExists(db, 'plans', 'completed_at', 'TEXT');
    addColumnIfNotExists(db, 'plans', 'cancelled_at', 'TEXT');

    // 2. 回填旧数据的 user_id 和 character_id
    const userRow = db.prepare("SELECT value FROM app_settings WHERE key = 'user_id'").get() as { value: string } | undefined;
    const charRow = db.prepare("SELECT value FROM app_settings WHERE key = 'active_character_id'").get() as { value: string } | undefined;
    const defaultUserId = userRow?.value || 'default-user';
    const defaultCharId = charRow?.value || 'default-character';

    db.prepare("UPDATE plans SET user_id = ? WHERE user_id = '' OR user_id IS NULL").run(defaultUserId);
    db.prepare("UPDATE plans SET character_id = ? WHERE character_id = '' OR character_id IS NULL").run(defaultCharId);

    // 3. 处理旧数据冲突：同一 user_id + character_id + date 多个 live plan
    // 保留 updated_at 最新的，其他标记为 cancelled
    const conflicts = db.prepare(`
      SELECT user_id, character_id, date, COUNT(*) as cnt
      FROM plans
      WHERE status IN ('draft', 'active')
      GROUP BY user_id, character_id, date
      HAVING cnt > 1
    `).all() as Array<{ user_id: string; character_id: string; date: string; cnt: number }>;

    for (const conflict of conflicts) {
      // 保留最新的（updated_at 最大），其他标记为 cancelled
      const duplicates = db.prepare(`
        SELECT id FROM plans
        WHERE user_id = ? AND character_id = ? AND date = ? AND status IN ('draft', 'active')
        ORDER BY updated_at DESC
      `).all(conflict.user_id, conflict.character_id, conflict.date) as Array<{ id: string }>;

      // 跳过第一个（最新的），其余标记为 cancelled
      for (let i = 1; i < duplicates.length; i++) {
        db.prepare(
          "UPDATE plans SET status = 'cancelled', cancelled_at = datetime('now') WHERE id = ?"
        ).run(duplicates[i].id);
      }
    }

    // 4. 删除旧触发器，创建新触发器（支持 scheduled/cancelled/expired）
    db.exec('DROP TRIGGER IF EXISTS trg_plans_status_check_insert;');
    db.exec('DROP TRIGGER IF EXISTS trg_plans_status_check_update;');
    db.exec(`
      CREATE TRIGGER trg_plans_status_check_insert
      BEFORE INSERT ON plans
      FOR EACH ROW
      BEGIN
        SELECT CASE
          WHEN NEW.status NOT IN ('draft', 'scheduled', 'active', 'completed', 'cancelled', 'expired')
          THEN RAISE(ABORT, 'Invalid plan status: must be draft, scheduled, active, completed, cancelled, or expired')
        END;
      END;
    `);
    db.exec(`
      CREATE TRIGGER trg_plans_status_check_update
      BEFORE UPDATE OF status ON plans
      FOR EACH ROW
      WHEN NEW.status IS NOT NULL
      BEGIN
        SELECT CASE
          WHEN NEW.status NOT IN ('draft', 'scheduled', 'active', 'completed', 'cancelled', 'expired')
          THEN RAISE(ABORT, 'Invalid plan status: must be draft, scheduled, active, completed, cancelled, or expired')
        END;
      END;
    `);

    // 5. 删除旧唯一索引，创建新唯一索引（按 user_id + character_id + date 隔离）
    db.exec('DROP INDEX IF EXISTS idx_plans_active_unique_per_date;');
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_plans_live_unique_per_scope_date
      ON plans(user_id, character_id, date) WHERE status IN ('draft', 'scheduled', 'active');
    `);

    // 6. 添加日历查询索引（幂等）
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_plans_scope_date
      ON plans(user_id, character_id, date, status);
    `);

    log.info('V7 calendar planning extensions applied', {
      fields: {
        addedColumns: ['user_id', 'character_id', 'timezone', 'activated_at', 'completed_at', 'cancelled_at'],
        newStatuses: ['scheduled', 'cancelled', 'expired'],
        indexes: ['idx_plans_live_unique_per_scope_date', 'idx_plans_scope_date'],
        triggers: ['trg_plans_status_check_insert', 'trg_plans_status_check_update'],
        conflictsResolved: conflicts.length,
        defaultUserId,
        defaultCharId
      }
    });
  }
};

/** 所有已注册的 migration，按 version 升序 */
const ALL_MIGRATIONS: MigrationFile[] = [migrationV1, migrationV2, migrationV3, migrationV4, migrationV5, migrationV6, migrationV7];

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
