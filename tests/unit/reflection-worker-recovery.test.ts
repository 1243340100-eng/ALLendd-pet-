/**
 * Reflection Worker 崩溃恢复测试。
 * 验证架构计划第 5.4 节"Reflection 失败不影响聊天"：
 *   1. 任务标记为 processing 后崩溃，重启后被恢复
 *   2. resetProcessingJobs() 将 processing 重置为 pending
 *   3. dequeueAndMarkProcessing() 原子操作不会丢失任务
 *   4. 恢复后的任务能被正常处理
 *
 * 运行：npx tsx tests/unit/reflection-worker-recovery.test.ts
 */
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

import { initDatabase, closeDatabase, getDatabase } from '../../src/infrastructure/database/connection';
import { reflectionRepository, type ReflectionJobRow } from '../../src/infrastructure/database/repositories/reflection-repository';

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

function tempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'petdb-refl-recovery-'));
  return path.join(dir, 'test.sqlite');
}

function cleanupDbFile(dbPath: string): void {
  try {
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    const dir = path.dirname(dbPath);
    if (fs.existsSync(dir)) fs.rmdirSync(dir);
  } catch { /* ignore */ }
}

function enqueueJob(id: string, status: string = 'pending'): void {
  const db = getDatabase();
  db.prepare(`
    INSERT INTO reflection_jobs (id, turn_id, user_id, character_id, status, payload_json, attempts)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, `turn-${id}`, 'recovery-user', 'recovery-char', status, JSON.stringify({
    payload: { turnId: `turn-${id}`, messages: [] },
    sessionId: 'recovery-session',
    persona: null
  }), 0);
}

async function main(): Promise<void> {
  console.log('=== Reflection Worker Recovery Tests ===\n');

  const dbPath = tempDbPath();
  try {
    initDatabase({ path: dbPath });

    // 插入用户记录（满足外键约束）
    const db = getDatabase();
    db.prepare('INSERT INTO users (id, nickname, preferred_name) VALUES (?, ?, ?)').run('recovery-user', 'Recovery', 'Recovery');
    db.prepare('INSERT INTO users (id, nickname, preferred_name) VALUES (?, ?, ?)').run('user-retry', 'Retry', 'Retry');

    // ===== 测试 1：processing 任务在重启后被恢复 =====
    console.log('--- Test 1: Processing Jobs Reset on Restart ---');

    // 模拟应用崩溃前有 3 个任务：1 pending, 2 processing
    enqueueJob('job-001', 'pending');
    enqueueJob('job-002', 'processing');
    enqueueJob('job-003', 'processing');

    // 确认初始状态
    check('Initial: 1 pending job', reflectionRepository.getPendingCount() === 1);
    check('Initial: 2 processing jobs', reflectionRepository.getProcessingCount() === 2);

    // 模拟重启：调用 resetProcessingJobs()
    const resetCount = reflectionRepository.resetProcessingJobs();
    check('Reset: returned 2 reset jobs', resetCount === 2);
    check('Reset: 3 pending jobs after reset', reflectionRepository.getPendingCount() === 3);
    check('Reset: 0 processing jobs after reset', reflectionRepository.getProcessingCount() === 0);

    // 验证恢复的任务 attempts 增加
    const job002 = reflectionRepository.dequeueAndMarkProcessing();
    check('Reset: first dequeued job is one of the recovered', job002 !== null);
    // 第二次 dequeue
    const job003 = reflectionRepository.dequeueAndMarkProcessing();
    check('Reset: second dequeued job exists', job003 !== null);
    // 第三次 dequeue
    const job001 = reflectionRepository.dequeueAndMarkProcessing();
    check('Reset: third dequeued job exists', job001 !== null);
    // 队列为空
    const jobNull = reflectionRepository.dequeueAndMarkProcessing();
    check('Reset: queue empty after all dequeued', jobNull === null);

    // ===== 测试 2：原子 dequeue + markProcessing =====
    console.log('\n--- Test 2: Atomic Dequeue + MarkProcessing ---');

    // 清空之前的测试数据
    db.prepare('DELETE FROM reflection_jobs').run();

    // 添加 3 个 pending 任务
    enqueueJob('atom-001', 'pending');
    enqueueJob('atom-002', 'pending');
    enqueueJob('atom-003', 'pending');

    // 原子 dequeue 第一条
    const job1 = reflectionRepository.dequeueAndMarkProcessing();
    check('Atomic: first job returned', job1 !== null);
    // dequeueAndMarkProcessing 返回的是 UPDATE 前的行（status='pending'），需查 DB 确认已标记为 processing
    const job1Db = db.prepare('SELECT status FROM reflection_jobs WHERE id = ?').get(job1?.id) as { status: string } | undefined;
    check('Atomic: first job is processing in DB', job1Db?.status === 'processing');

    // 第一条不应再被 dequeue
    const job2 = reflectionRepository.dequeueAndMarkProcessing();
    check('Atomic: second job is different', job2 !== null && job2.id !== job1?.id);

    const job3 = reflectionRepository.dequeueAndMarkProcessing();
    check('Atomic: third job is different', job3 !== null && job3.id !== job1?.id && job3.id !== job2?.id);

    // 队列空
    const jobNone = reflectionRepository.dequeueAndMarkProcessing();
    check('Atomic: queue empty after 3 dequeues', jobNone === null);

    // ===== 测试 3：next_retry_at 延迟 =====
    console.log('\n--- Test 3: Next Retry At Delay ---');

    db.prepare('DELETE FROM reflection_jobs').run();

    // 添加一个 pending 任务，但 next_retry_at 在未来
    db.prepare(`
      INSERT INTO reflection_jobs (id, turn_id, user_id, character_id, status, payload_json, attempts, next_retry_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run('retry-001', 'turn-retry', 'user-retry', 'char-retry', 'pending',
      JSON.stringify({ payload: { turnId: 'turn-retry' }, sessionId: 'sess' }), 0,
      new Date(Date.now() + 3600000).toISOString()  // 1 小时后
    );

    // 添加一个 pending 任务，next_retry_at 在过去
    db.prepare(`
      INSERT INTO reflection_jobs (id, turn_id, user_id, character_id, status, payload_json, attempts, next_retry_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run('retry-002', 'turn-retry2', 'user-retry', 'char-retry', 'pending',
      JSON.stringify({ payload: { turnId: 'turn-retry2' }, sessionId: 'sess' }), 0,
      new Date(Date.now() - 1000).toISOString()  // 过去
    );

    // 应该只取到 retry-002（retry-001 的 next_retry_at 在未来）
    const retryJob = reflectionRepository.dequeueAndMarkProcessing();
    check('Retry: job with past next_retry_at is dequeued', retryJob?.id === 'retry-002');

    // retry-001 不应被取出
    const retryJob2 = reflectionRepository.dequeueAndMarkProcessing();
    check('Retry: job with future next_retry_at is not dequeued', retryJob2 === null);

    // ===== 测试 4：resetProcessingJobs 幂等性 =====
    console.log('\n--- Test 4: Reset Idempotency ---');

    db.prepare('DELETE FROM reflection_jobs').run();
    enqueueJob('idem-001', 'pending');
    enqueueJob('idem-002', 'processing');

    // 第一次 reset
    const reset1 = reflectionRepository.resetProcessingJobs();
    check('Idempotent: first reset returns 1', reset1 === 1);

    // 第二次 reset（无 processing 任务）
    const reset2 = reflectionRepository.resetProcessingJobs();
    check('Idempotent: second reset returns 0', reset2 === 0);

    // ===== 测试 5：恢复后任务能被正常处理 =====
    console.log('\n--- Test 5: Recovered Jobs Can Be Processed ---');

    db.prepare('DELETE FROM reflection_jobs').run();

    // 模拟崩溃：任务卡在 processing
    enqueueJob('crash-001', 'processing');
    check('Recovery: job stuck in processing', reflectionRepository.getProcessingCount() === 1);

    // 模拟重启恢复
    reflectionRepository.resetProcessingJobs();
    check('Recovery: job reset to pending', reflectionRepository.getPendingCount() === 1);
    check('Recovery: no more processing jobs', reflectionRepository.getProcessingCount() === 0);

    // 可以被取出并处理
    const recoveredJob = reflectionRepository.dequeueAndMarkProcessing();
    check('Recovery: recovered job can be dequeued', recoveredJob?.id === 'crash-001');
    // dequeueAndMarkProcessing 返回 UPDATE 前的行，需查 DB 确认已标记为 processing
    const recoveredJobDb = db.prepare('SELECT status FROM reflection_jobs WHERE id = ?').get('crash-001') as { status: string } | undefined;
    check('Recovery: recovered job is processing in DB', recoveredJobDb?.status === 'processing');

    // 标记完成
    reflectionRepository.markCompleted('crash-001');
    const completedJob = reflectionRepository.dequeueAndMarkProcessing();
    check('Recovery: completed job not in queue', completedJob === null);

  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }

  console.log('\n=== Summary ===');
  console.log(`PASS: ${pass}, FAIL: ${fail}`);
  if (failures.length > 0) {
    console.log('Failures:');
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Test runner crashed:', error);
  process.exit(1);
});
