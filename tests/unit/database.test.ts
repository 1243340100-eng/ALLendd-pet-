/**
 * 阶段 2 数据层和服务测试。
 * 验证架构计划阶段 2 验收标准：
 *   1. 数据库可从空库自动初始化
 *   2. migration 可重复验证（幂等）
 *   3. 应用重启后设置、提醒和会话仍存在
 *   4. ModelGateway 能统计调用次数、Token、耗时
 *   5. 单轮第四次模型调用会被拒绝
 *
 * 运行：npx tsx tests/unit/database.test.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';

import { openDatabase, initDatabase, closeDatabase, getDatabase } from '../../src/infrastructure/database/connection';
import { runMigrations, getCurrentMigrationVersion } from '../../src/infrastructure/database/migration-runner';
import { settingsRepository } from '../../src/infrastructure/database/repositories/settings-repository';
import { reminderRepository } from '../../src/infrastructure/database/repositories/reminder-repository';
import { sessionRepository, messageRepository } from '../../src/infrastructure/database/repositories/session-repository';
import { modelUsageRepository } from '../../src/infrastructure/database/repositories/model-usage-repository';
import { memoryRepository } from '../../src/infrastructure/database/repositories/memory-repository';

import { ModelGateway, type FetchFn } from '../../src/services/ModelGateway';
import { getDefaultAppConfig } from '../../src/infrastructure/config/config-loader';
import type { SecretStore, ApiSecretConfig } from '../../src/infrastructure/secrets/secret-store';
import { ModelCallLimitExceededError } from '../../src/shared/contracts/errors';

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, condition: boolean): void {
  if (condition) {
    pass++;
    console.log(`PASS ${name}`);
  } else {
    fail++;
    failures.push(name);
    console.error(`FAIL ${name}`);
  }
}

function checkThrows(name: string, fn: () => void, ErrorCtor?: new (...args: any[]) => Error): void {
  try {
    fn();
    fail++;
    failures.push(name);
    console.error(`FAIL ${name} (expected throw, got none)`);
  } catch (e) {
    const ok = ErrorCtor ? e instanceof ErrorCtor : true;
    if (ok) {
      pass++;
      console.log(`PASS ${name}`);
    } else {
      fail++;
      failures.push(name);
      console.error(`FAIL ${name} (wrong error type: ${(e as Error)?.constructor?.name})`);
    }
  }
}

async function checkThrowsAsync(name: string, fn: () => Promise<unknown>, ErrorCtor?: new (...args: any[]) => Error): Promise<void> {
  try {
    await fn();
    fail++;
    failures.push(name);
    console.error(`FAIL ${name} (expected throw, got none)`);
  } catch (e) {
    const ok = ErrorCtor ? e instanceof ErrorCtor : true;
    if (ok) {
      pass++;
      console.log(`PASS ${name}`);
    } else {
      fail++;
      failures.push(name);
      console.error(`FAIL ${name} (wrong error type: ${(e as Error)?.constructor?.name})`);
    }
  }
}

/** 临时文件路径 */
function tempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'petdb-'));
  return path.join(dir, 'test.sqlite');
}

function cleanupDbFile(dbPath: string): void {
  try {
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    const dir = path.dirname(dbPath);
    if (fs.existsSync(dir)) fs.rmdirSync(dir);
  } catch {
    // 忽略清理失败
  }
}

/** 构造用于 ModelGateway 测试的 mock SecretStore */
function makeMockSecretStore(apiKey = 'sk-test-key'): SecretStore {
  const config: ApiSecretConfig = {
    provider: 'deepseek',
    endpoint: 'https://api.deepseek.com/v1/chat/completions',
    model: 'deepseek-chat',
    apiKey
  };
  return {
    read(): ApiSecretConfig | null { return { ...config }; },
    write(_c: ApiSecretConfig): void { /* no-op */ },
    clear(): void { /* no-op */ },
    isEncrypted(): boolean { return true; }
  };
}

/** 构造 mock fetch：返回成功的 DeepSeek 兼容响应 */
function makeMockFetch(opts?: {
  content?: string;
  inputTokens?: number;
  outputTokens?: number;
  modelName?: string;
  status?: number;
}): FetchFn {
  const content = opts?.content ?? '你好，我是洛琪希。';
  const inputTokens = opts?.inputTokens ?? 120;
  const outputTokens = opts?.outputTokens ?? 30;
  const modelName = opts?.modelName ?? 'deepseek-chat';
  const status = opts?.status ?? 200;
  return async (): Promise<Response> => {
    const body = {
      id: 'chatcmpl-mock',
      model: modelName,
      choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: inputTokens, completion_tokens: outputTokens, total_tokens: inputTokens + outputTokens }
    };
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' }
    });
  };
}

// ===== 测试 1：数据库可从空库自动初始化 =====
function testAutoInitFromEmpty(): void {
  const dbPath = tempDbPath();
  try {
    const db = openDatabase({ path: dbPath });
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all() as Array<{ name: string }>;
    const tableNames = tables.map((t) => t.name);

    // 关键表都应存在
    check('AutoInit: app_settings table exists', tableNames.includes('app_settings'));
    check('AutoInit: memories table exists', tableNames.includes('memories'));
    check('AutoInit: reminders table exists', tableNames.includes('reminders'));
    check('AutoInit: sessions table exists', tableNames.includes('sessions'));
    check('AutoInit: model_usage table exists', tableNames.includes('model_usage'));
    check('AutoInit: reminder_occurrences table exists', tableNames.includes('reminder_occurrences'));
    check('AutoInit: event_outbox table exists', tableNames.includes('event_outbox'));
    check('AutoInit: reflection_jobs table exists', tableNames.includes('reflection_jobs'));
    check('AutoInit: _migrations tracking table exists', tableNames.includes('_migrations'));

    const version = getCurrentMigrationVersion(db);
    check('AutoInit: migration version is 5 after init', version === 5);

    db.close();
  } finally {
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 2：migration 幂等（重复执行不报错） =====
function testMigrationIdempotency(): void {
  const dbPath = tempDbPath();
  try {
    const db = openDatabase({ path: dbPath });

    // 再次执行 migrations 不应抛错
    let secondRunOk = true;
    try {
      const result = runMigrations(db);
      check('Migration: re-run returns applied=0', result.applied === 0);
      check('Migration: re-run keeps version=5', result.currentVersion === 5);
    } catch (e) {
      secondRunOk = false;
      console.error('Migration re-run threw:', (e as Error)?.message);
    }
    check('Migration: re-run does not throw', secondRunOk);

    // 第三次也应通过
    let thirdRunOk = true;
    try {
      runMigrations(db);
    } catch (e) {
      thirdRunOk = false;
    }
    check('Migration: third run also safe', thirdRunOk);

    db.close();
  } finally {
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 3：重启后设置/提醒/会话仍存在 =====
function testPersistenceAfterReopen(): void {
  const dbPath = tempDbPath();
  try {
    // 首次打开，写入数据
    {
      const db = openDatabase({ path: dbPath });
      // 插入一个用户（外键依赖）
      db.prepare('INSERT INTO users (id, nickname) VALUES (?, ?)').run('user-1', 'TestUser');
      db.close();
    }
    // 用单例初始化，让 repositories 能访问
    {
      initDatabase({ path: dbPath });

      // 写设置
      settingsRepository.set('theme', 'dark');
      settingsRepository.set('language', 'zh-CN');
      check('Persistence: settings written', settingsRepository.get('theme') === 'dark');

      // 写提醒
      const now = new Date();
      const future = new Date(now.getTime() + 60_000).toISOString();
      reminderRepository.insert({
        id: 'rem-1',
        user_id: 'user-1',
        character_id: 'char-roxy',
        content: '喝水提醒',
        trigger_at: future,
        timezone: 'Asia/Shanghai',
        is_repeating: 0,
        recurrence_rule: '',
        priority: 'normal',
        is_active: 1,
        next_trigger_at: future
      });
      check('Persistence: reminder written', reminderRepository.getById('rem-1') !== null);

      // 写会话和消息
      sessionRepository.insert({
        id: 'sess-1',
        user_id: 'user-1',
        character_id: 'char-roxy'
      });
      messageRepository.insert({
        id: 'msg-1',
        session_id: 'sess-1',
        user_id: 'user-1',
        character_id: 'char-roxy',
        role: 'user',
        content: '你好',
        memory_ids: null
      });
      check('Persistence: session written', sessionRepository.getById('sess-1') !== null);
      check('Persistence: message written', messageRepository.getBySession('sess-1').length === 1);

      closeDatabase();
    }
    // 关闭后重新打开，数据应仍在
    {
      initDatabase({ path: dbPath });

      check('Persistence: settings survive reopen', settingsRepository.get('theme') === 'dark');
      check('Persistence: all settings survive', Object.keys(settingsRepository.getAll()).length >= 2);

      const rem = reminderRepository.getById('rem-1');
      check('Persistence: reminder survives reopen', rem !== null && rem.content === '喝水提醒');

      const sess = sessionRepository.getById('sess-1');
      check('Persistence: session survives reopen', sess !== null && sess.is_active === 1);

      const msgs = messageRepository.getBySession('sess-1');
      check('Persistence: message survives reopen', msgs.length === 1 && msgs[0].content === '你好');

      closeDatabase();
    }
  } finally {
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 4：记忆角色隔离 =====
function testMemoryCharacterIsolation(): void {
  const dbPath = tempDbPath();
  try {
    initDatabase({ path: dbPath });
    const db = getDatabase();
    db.prepare('INSERT INTO users (id) VALUES (?)').run('user-iso');

    // global 记忆：character_id 必须为 null
    memoryRepository.insert({
      id: 'mem-global-1',
      user_id: 'user-iso',
      character_id: null,
      scope: 'global',
      type: 'preference',
      content: '用户喜欢简洁回复',
      structured_data: null,
      confidence: 0.9,
      source_message_id: null
    });
    check('Isolation: global memory with null character_id OK', memoryRepository.getById('mem-global-1') !== null);

    // global 记忆带 character_id 应抛错
    checkThrows('Isolation: global memory with character_id rejected', () => {
      memoryRepository.insert({
        id: 'mem-global-bad',
        user_id: 'user-iso',
        character_id: 'char-roxy',
        scope: 'global',
        type: 'preference',
        content: 'should fail',
        structured_data: null,
        confidence: 0.5,
        source_message_id: null
      });
    });

    // character 记忆必须有 character_id
    memoryRepository.insert({
      id: 'mem-char-1',
      user_id: 'user-iso',
      character_id: 'char-roxy',
      scope: 'character',
      type: 'relationship',
      content: '洛琪希与用户关系亲密',
      structured_data: null,
      confidence: 0.7,
      source_message_id: null
    });
    check('Isolation: character memory with character_id OK', memoryRepository.getById('mem-char-1') !== null);

    checkThrows('Isolation: character memory without character_id rejected', () => {
      memoryRepository.insert({
        id: 'mem-char-bad',
        user_id: 'user-iso',
        character_id: null,
        scope: 'character',
        type: 'event',
        content: 'should fail',
        structured_data: null,
        confidence: 0.5,
        source_message_id: null
      });
    });

    // 检索应返回 global + character 记忆
    const list = memoryRepository.listForCharacter('user-iso', 'char-roxy');
    check('Isolation: listForCharacter returns global + character memories', list.length === 2);

    // 其他角色不应看到 char-roxy 的角色记忆
    const otherList = memoryRepository.listForCharacter('user-iso', 'char-other');
    check('Isolation: other character cannot see char-roxy memories',
      otherList.length === 1 && otherList[0].scope === 'global');

    closeDatabase();
  } finally {
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 5：提醒触发去重（原子） =====
function testReminderOccurrenceDedup(): void {
  const dbPath = tempDbPath();
  try {
    initDatabase({ path: dbPath });
    const db = getDatabase();
    db.prepare('INSERT INTO users (id) VALUES (?)').run('user-dedup');

    const future = new Date(Date.now() + 60_000).toISOString();
    reminderRepository.insert({
      id: 'rem-dedup',
      user_id: 'user-dedup',
      character_id: 'char-roxy',
      content: '定时提醒',
      trigger_at: future,
      timezone: 'Asia/Shanghai',
      is_repeating: 0,
      recurrence_rule: '',
      priority: 'normal',
      is_active: 1,
      next_trigger_at: future
    });

    const slot = '2026-07-10T10:00:00.000Z';
    // 两阶段投递：先 pending（占位+dedup），再 delivered（确认）
    const p1 = reminderRepository.markOccurrencePending('rem-dedup', slot);
    check('Dedup: first pending inserts', p1.inserted === true);
    check('Dedup: pending not yet delivered', reminderRepository.hasOccurrenceBeenDelivered('rem-dedup', slot) === false);

    const p2 = reminderRepository.markOccurrencePending('rem-dedup', slot);
    check('Dedup: second pending does NOT insert', p2.inserted === false);

    reminderRepository.markOccurrenceDelivered('rem-dedup', slot);
    check('Dedup: delivered after confirm', reminderRepository.hasOccurrenceBeenDelivered('rem-dedup', slot));

    const p3 = reminderRepository.markOccurrencePending('rem-dedup', slot);
    check('Dedup: pending after delivered does NOT insert', p3.inserted === false);
    check('Dedup: still only one occurrence', reminderRepository.hasOccurrenceBeenDelivered('rem-dedup', slot));

    closeDatabase();
  } finally {
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 6：ModelGateway 统计调用次数、Token、耗时 =====
async function testModelGatewayStats(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    initDatabase({ path: dbPath });
    const db = getDatabase();
    db.prepare('INSERT INTO users (id) VALUES (?)').run('user-gw');

    const config = getDefaultAppConfig();
    const secretStore = makeMockSecretStore('sk-gw-test');
    const fetchFn = makeMockFetch({
      content: '这是模型回复。',
      inputTokens: 150,
      outputTokens: 40,
      modelName: 'deepseek-chat'
    });

    const gateway = new ModelGateway({ config, secretStore, fetchFn, db });
    gateway.beginTurn('turn-stats-1');

    const result = await gateway.invoke({
      messages: [{ role: 'user', content: '你好' }],
      mode: 'balanced',
      traceId: 'trace-stats-1'
    });

    check('ModelGateway: invoke succeeds', result.success === true);
    check('ModelGateway: content matches', result.content === '这是模型回复。');
    check('ModelGateway: inputTokens recorded', result.inputTokens === 150);
    check('ModelGateway: outputTokens recorded', result.outputTokens === 40);
    check('ModelGateway: durationMs positive', result.durationMs >= 0);
    check('ModelGateway: model name returned', result.model === 'deepseek-chat');

    // 数据库中应有用量记录
    const summary = modelUsageRepository.getTodaySummary();
    check('ModelGateway: usage persisted to DB', summary.totalCalls >= 1);
    check('ModelGateway: token totals persisted',
      summary.totalInputTokens >= 150 && summary.totalOutputTokens >= 40);

    gateway.endTurn();
    check('ModelGateway: turnCallCount is 1 after single call', gateway.getTurnCallCount() === 1);

    closeDatabase();
  } finally {
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 7：单轮第四次调用被拒绝 =====
async function testModelCallLimit(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    initDatabase({ path: dbPath });
    const db = getDatabase();
    db.prepare('INSERT INTO users (id) VALUES (?)').run('user-limit');

    const config = getDefaultAppConfig();
    // maxModelCallsPerTurn 默认是 3
    check('ModelLimit: config maxModelCallsPerTurn is 3',
      config.costBudget.maxModelCallsPerTurn === 3);

    const secretStore = makeMockSecretStore();
    const fetchFn = makeMockFetch();
    const gateway = new ModelGateway({ config, secretStore, fetchFn, db });
    gateway.beginTurn('turn-limit-1');

    // 前三次应成功
    const r1 = await gateway.invoke({ messages: [{ role: 'user', content: 'q1' }], mode: 'low_cost' });
    check('ModelLimit: 1st call succeeds', r1.success === true);

    const r2 = await gateway.invoke({ messages: [{ role: 'user', content: 'q2' }], mode: 'low_cost' });
    check('ModelLimit: 2nd call succeeds', r2.success === true);

    const r3 = await gateway.invoke({ messages: [{ role: 'user', content: 'q3' }], mode: 'low_cost' });
    check('ModelLimit: 3rd call succeeds', r3.success === true);

    check('ModelLimit: turnCallCount is 3', gateway.getTurnCallCount() === 3);

    // 第四次应抛 ModelCallLimitExceededError
    await checkThrowsAsync(
      'ModelLimit: 4th call throws ModelCallLimitExceededError',
      () => gateway.invoke({ messages: [{ role: 'user', content: 'q4' }], mode: 'low_cost' }),
      ModelCallLimitExceededError
    );

    // beginTurn 后应重置计数，可以继续调用
    gateway.beginTurn('turn-limit-2');
    const r5 = await gateway.invoke({ messages: [{ role: 'user', content: 'q5' }], mode: 'low_cost' });
    check('ModelLimit: new turn resets count, call succeeds', r5.success === true);
    check('ModelLimit: new turn count is 1', gateway.getTurnCallCount() === 1);

    gateway.endTurn();
    closeDatabase();
  } finally {
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 8：无 API Key 时返回失败结果 =====
async function testModelGatewayNoApiKey(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    initDatabase({ path: dbPath });
    const db = getDatabase();
    db.prepare('INSERT INTO users (id) VALUES (?)').run('user-nokey');

    const config = getDefaultAppConfig();
    const secretStore: SecretStore = {
      read(): ApiSecretConfig | null { return null; },
      write(): void { /* no-op */ },
      clear(): void { /* no-op */ },
      isEncrypted(): boolean { return false; }
    };
    const gateway = new ModelGateway({ config, secretStore, fetchFn: makeMockFetch(), db });
    gateway.beginTurn('turn-nokey');

    const result = await gateway.invoke({
      messages: [{ role: 'user', content: 'hi' }],
      mode: 'balanced'
    });
    check('NoKey: returns failure result', result.success === false);
    check('NoKey: errorCode is model_unavailable', result.errorCode === 'model_unavailable');

    gateway.endTurn();
    closeDatabase();
  } finally {
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 9：event_outbox 去重 =====
function testEventOutboxDedup(): void {
  const dbPath = tempDbPath();
  try {
    initDatabase({ path: dbPath });
    const db = getDatabase();

    const insertOccurrence = db.prepare(`
      INSERT INTO event_outbox (id, event_type, payload_json, dedupe_key, status)
      VALUES (?, ?, ?, ?, 'pending')
    `);

    insertOccurrence.run('evt-out-1', 'reminder_due', '{"r":"1"}', 'dedup-key-A');
    // 相同 dedupe_key 插入应失败
    let threw = false;
    try {
      insertOccurrence.run('evt-out-2', 'reminder_due', '{"r":"2"}', 'dedup-key-A');
    } catch {
      threw = true;
    }
    check('Outbox: duplicate dedupe_key rejected by UNIQUE constraint', threw);

    // 不同 dedupe_key 可以插入
    let okInsert = true;
    try {
      insertOccurrence.run('evt-out-3', 'reminder_due', '{"r":"3"}', 'dedup-key-B');
    } catch {
      okInsert = false;
    }
    check('Outbox: different dedupe_key accepted', okInsert);

    closeDatabase();
  } finally {
    cleanupDbFile(dbPath);
  }
}

// ===== 主入口 =====
async function main(): Promise<void> {
  console.log('=== Stage 2 Database & Services Tests ===\n');

  console.log('--- 1. Auto Init from Empty ---');
  testAutoInitFromEmpty();

  console.log('\n--- 2. Migration Idempotency ---');
  testMigrationIdempotency();

  console.log('\n--- 3. Persistence After Reopen ---');
  testPersistenceAfterReopen();

  console.log('\n--- 4. Memory Character Isolation ---');
  testMemoryCharacterIsolation();

  console.log('\n--- 5. Reminder Occurrence Dedup ---');
  testReminderOccurrenceDedup();

  console.log('\n--- 6. ModelGateway Stats ---');
  await testModelGatewayStats();

  console.log('\n--- 7. Model Call Limit (4th rejected) ---');
  await testModelCallLimit();

  console.log('\n--- 8. ModelGateway No API Key ---');
  await testModelGatewayNoApiKey();

  console.log('\n--- 9. Event Outbox Dedup ---');
  testEventOutboxDedup();

  console.log(`\n=== Results: ${pass} passed, ${fail} failed ===`);
  if (fail > 0) {
    console.error('Failed tests:');
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('Test runner crashed:', e);
  process.exit(1);
});
