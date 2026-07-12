/**
 * CalendarActivationService 测试。
 * 验证规格第七节"每日自动激活"和第十节相关测试项：
 *   12. 到达日期后 scheduled 原子变 active
 *   13. 应用当天中途启动能够补激活
 *   14. 重复启动不会重复激活或重复通知
 *   15. 23:59 → 00:00 跨日（FixedClock 模拟）
 *   28. API 失败不影响当天计划展示（本测试验证激活服务不调用模型）
 *
 * 运行：npx tsx tests/unit/calendar-activation.test.ts
 */
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

import { initDatabase, closeDatabase, getDatabase } from '../../src/infrastructure/database/connection';
import { settingsRepository } from '../../src/infrastructure/database/repositories/settings-repository';
import { planRepository } from '../../src/infrastructure/database/repositories/plan-repository';
import { eventOutboxRepository } from '../../src/infrastructure/database/repositories/event-outbox-repository';
import { runMigrations } from '../../src/infrastructure/database/migration-runner';

import { TimeService, FixedClock } from '../../src/services/TimeService';
import { CalendarActivationService } from '../../src/services/CalendarActivationService';

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'petdb-cal-act-'));
  return path.join(dir, 'test.sqlite');
}

function cleanupDbFile(dbPath: string): void {
  try {
    closeDatabase();
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    const dir = path.dirname(dbPath);
    if (fs.existsSync(dir)) fs.rmdirSync(dir);
  } catch { /* ignore */ }
}

function setupTestEnv(dbPath: string): { userId: string; characterId: string } {
  initDatabase({ path: dbPath });
  runMigrations(getDatabase());

  const userId = 'cal-user';
  const characterId = 'cal-roxy';

  settingsRepository.set('onboarding_completed', 'true');
  settingsRepository.set('user_id', userId);
  settingsRepository.set('active_character_id', characterId);

  try {
    getDatabase().prepare('INSERT INTO users (id, nickname, preferred_name) VALUES (?, ?, ?)').run(
      userId, '测试用户', '测试'
    );
  } catch { /* may already exist */ }

  return { userId, characterId };
}

function cleanupAll(): void {
  try {
    getDatabase().prepare('DELETE FROM plan_tasks').run();
    getDatabase().prepare('DELETE FROM plans').run();
    getDatabase().prepare('DELETE FROM event_outbox').run();
  } catch { /* ignore */ }
}

/** 创建 scheduled 计划 */
function createScheduledPlan(scope: { userId: string; characterId: string }, date: string, planId: string, tasks: Array<{ content: string; start_time: string; end_time: string }>): void {
  planRepository.insert({
    id: planId,
    date,
    status: 'scheduled',
    user_id: scope.userId,
    character_id: scope.characterId,
    timezone: 'Asia/Shanghai'
  });
  if (tasks.length > 0) {
    planRepository.insertTasks(tasks.map((t, i) => ({
      id: `${planId}-task-${i + 1}`,
      plan_id: planId,
      content: t.content,
      start_time: t.start_time,
      end_time: t.end_time,
      completed: 0,
      order_index: i
    })));
  }
}

// ===== 测试 1：到达日期后 scheduled 原子变 active =====
function testScheduledTransitionsToActive(): void {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId } = setupTestEnv(dbPath);
    cleanupAll();
    const scope = { userId, characterId };

    // 固定时间：2026-07-15 08:00 Shanghai
    const clock = new FixedClock(new Date('2026-07-15T00:00:00.000Z')); // UTC 00:00 = Shanghai 08:00
    const timeService = new TimeService('Asia/Shanghai', clock);
    const service = new CalendarActivationService(timeService);

    // 创建今天的 scheduled 计划
    createScheduledPlan(scope, '2026-07-15', 'plan-act-1', [
      { content: '开会', start_time: '09:00', end_time: '10:00' },
      { content: '写代码', start_time: '11:00', end_time: '12:00' }
    ]);

    const result = service.activateTodayPlans(scope);

    check('Activate: activatedPlans.length=1', result.activatedPlans.length === 1);
    check('Activate: todayDate=2026-07-15', result.todayDate === '2026-07-15');
    check('Activate: skippedCount=0', result.skippedCount === 0);

    // 验证数据库中状态已变为 active
    const plan = planRepository.getById('plan-act-1');
    check('Activate: status=active', plan?.status === 'active');
    check('Activate: activated_at not null', !!plan?.activated_at);

    // 验证 event_outbox 写入事件
    const pending = eventOutboxRepository.getPending();
    const dailyPlanEvent = pending.find(e => e.event_type === 'daily_plan_due' && e.dedupe_key === 'daily_plan:plan-act-1:2026-07-15');
    check('Activate: event_outbox has daily_plan_due', !!dailyPlanEvent);
  } finally {
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 2：重复启动不会重复激活或重复通知（幂等） =====
function testIdempotentActivation(): void {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId } = setupTestEnv(dbPath);
    cleanupAll();
    const scope = { userId, characterId };

    const clock = new FixedClock(new Date('2026-07-15T00:00:00.000Z'));
    const timeService = new TimeService('Asia/Shanghai', clock);
    const service = new CalendarActivationService(timeService);

    createScheduledPlan(scope, '2026-07-15', 'plan-idem-1', [
      { content: '任务A', start_time: '09:00', end_time: '10:00' }
    ]);

    // 第一次激活
    const result1 = service.activateTodayPlans(scope);
    check('Idempotent: first activation activatedPlans.length=1', result1.activatedPlans.length === 1);

    // 第二次激活（应跳过：getScheduledPlansForDate 只查 status='scheduled' 的计划，
    // 第一次激活后状态变为 active，第二次查不到，返回空）
    const result2 = service.activateTodayPlans(scope);
    check('Idempotent: second activation activatedPlans.length=0', result2.activatedPlans.length === 0);
    check('Idempotent: second activation skippedCount=0', result2.skippedCount === 0);

    // 验证 event_outbox 只有一条事件（dedupe_key 保证幂等）
    const pending = eventOutboxRepository.getPending();
    const events = pending.filter(e => e.dedupe_key === 'daily_plan:plan-idem-1:2026-07-15');
    check('Idempotent: only one event in outbox', events.length === 1);

    // 验证计划状态仍然是 active（没有重复转换）
    check('Idempotent: plan still active', planRepository.getById('plan-idem-1')?.status === 'active');
  } finally {
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 3：应用当天中途启动能够补激活 =====
function testMiddayStartupActivation(): void {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId } = setupTestEnv(dbPath);
    cleanupAll();
    const scope = { userId, characterId };

    // 固定时间：2026-07-15 14:30 Shanghai（下午中途启动）
    const clock = new FixedClock(new Date('2026-07-15T06:30:00.000Z')); // UTC 06:30 = Shanghai 14:30
    const timeService = new TimeService('Asia/Shanghai', clock);
    const service = new CalendarActivationService(timeService);

    createScheduledPlan(scope, '2026-07-15', 'plan-midday-1', [
      { content: '上午任务', start_time: '09:00', end_time: '10:00' },
      { content: '下午任务', start_time: '15:00', end_time: '16:00' }
    ]);

    const result = service.activateTodayPlans(scope);

    check('Midday: activatedPlans.length=1', result.activatedPlans.length === 1);
    // 即使上午任务时间已过去，计划仍应激活（规格第三节：display_or_activation 模式不允许静默删除）
    const plan = planRepository.getById('plan-midday-1');
    check('Midday: status=active', plan?.status === 'active');
    // 验证任务没有被删除
    const tasks = planRepository.getTasksByPlanId('plan-midday-1');
    check('Midday: tasks preserved (length=2)', tasks.length === 2);
  } finally {
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 4：23:59 → 00:00 跨日激活 =====
function testCrossDayActivation(): void {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId } = setupTestEnv(dbPath);
    cleanupAll();
    const scope = { userId, characterId };

    // 初始时间：2026-07-15 23:58 Shanghai
    const clock = new FixedClock(new Date('2026-07-15T15:58:00.000Z')); // UTC 15:58 = Shanghai 23:58
    const timeService = new TimeService('Asia/Shanghai', clock);
    const service = new CalendarActivationService(timeService);

    // 创建 7/15 和 7/16 的 scheduled 计划
    createScheduledPlan(scope, '2026-07-15', 'plan-day1', [
      { content: '7月15日任务', start_time: '10:00', end_time: '11:00' }
    ]);
    createScheduledPlan(scope, '2026-07-16', 'plan-day2', [
      { content: '7月16日任务', start_time: '09:00', end_time: '10:00' }
    ]);

    // 7/15 23:58 激活：应该只激活 7/15 的计划
    const result1 = service.activateTodayPlans(scope);
    check('CrossDay: 7/15 activation activates 1 plan', result1.activatedPlans.length === 1);
    check('CrossDay: 7/15 activation todayDate=2026-07-15', result1.todayDate === '2026-07-15');
    check('CrossDay: plan-day1 is active', planRepository.getById('plan-day1')?.status === 'active');
    check('CrossDay: plan-day2 still scheduled', planRepository.getById('plan-day2')?.status === 'scheduled');

    // 检测跨日：此时 lastCheckedDate 是 7/15，但还没到 7/16
    check('CrossDay: no cross-day detected yet', service.hasDateChanged() === false);

    // 推进时钟到 7/16 00:01 Shanghai（通过 timeService.setClock 重新注入时钟）
    const nextDayClock = new FixedClock(new Date('2026-07-15T16:01:00.000Z')); // UTC 16:01 = Shanghai 7/16 00:01
    timeService.setClock(nextDayClock);
    check('CrossDay: cross-day detected', service.hasDateChanged() === true);

    // 再次激活，应该激活 7/16 的计划
    const result2 = service.activateTodayPlans(scope);
    check('CrossDay: 7/16 activation activates 1 plan', result2.activatedPlans.length === 1);
    check('CrossDay: 7/16 activation todayDate=2026-07-16', result2.todayDate === '2026-07-16');
    check('CrossDay: plan-day2 is active', planRepository.getById('plan-day2')?.status === 'active');
  } finally {
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 5：API 失败不影响当天计划展示（激活服务不调用模型） =====
function testActivationDoesNotCallModel(): void {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId } = setupTestEnv(dbPath);
    cleanupAll();
    const scope = { userId, characterId };

    const clock = new FixedClock(new Date('2026-07-15T00:00:00.000Z'));
    const timeService = new TimeService('Asia/Shanghai', clock);
    const service = new CalendarActivationService(timeService);

    createScheduledPlan(scope, '2026-07-15', 'plan-no-api', [
      { content: '不需要 API 的任务', start_time: '10:00', end_time: '11:00' }
    ]);

    // 激活服务直接操作数据库，不依赖 API
    const result = service.activateTodayPlans(scope);

    check('NoApi: activatedPlans.length=1', result.activatedPlans.length === 1);
    check('NoApi: plan is active', planRepository.getById('plan-no-api')?.status === 'active');
    // 验证任务仍然存在并可读
    const tasks = planRepository.getTasksByPlanId('plan-no-api');
    check('NoApi: task content readable', tasks.length === 1 && tasks[0].content === '不需要 API 的任务');
  } finally {
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 6：没有 scheduled 计历时返回空结果 =====
function testNoScheduledPlansReturnsEmpty(): void {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId } = setupTestEnv(dbPath);
    cleanupAll();
    const scope = { userId, characterId };

    const clock = new FixedClock(new Date('2026-07-15T00:00:00.000Z'));
    const timeService = new TimeService('Asia/Shanghai', clock);
    const service = new CalendarActivationService(timeService);

    // 不创建任何计划
    const result = service.activateTodayPlans(scope);

    check('Empty: activatedPlans.length=0', result.activatedPlans.length === 0);
    check('Empty: skippedCount=0', result.skippedCount === 0);
    check('Empty: todayDate=2026-07-15', result.todayDate === '2026-07-15');
  } finally {
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 7：scope 隔离 — 不同用户/角色的计划不互相激活 =====
function testScopeIsolation(): void {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId } = setupTestEnv(dbPath);
    cleanupAll();
    const scope1 = { userId, characterId };
    const scope2 = { userId: 'other-user', characterId: 'other-roxy' };

    const clock = new FixedClock(new Date('2026-07-15T00:00:00.000Z'));
    const timeService = new TimeService('Asia/Shanghai', clock);
    const service = new CalendarActivationService(timeService);

    createScheduledPlan(scope1, '2026-07-15', 'plan-scope1', [
      { content: 'scope1 任务', start_time: '10:00', end_time: '11:00' }
    ]);
    createScheduledPlan(scope2, '2026-07-15', 'plan-scope2', [
      { content: 'scope2 任务', start_time: '10:00', end_time: '11:00' }
    ]);

    // 只激活 scope1
    const result1 = service.activateTodayPlans(scope1);
    check('ScopeIso: scope1 activates 1 plan', result1.activatedPlans.length === 1);
    check('ScopeIso: scope1 plan is active', planRepository.getById('plan-scope1')?.status === 'active');
    check('ScopeIso: scope2 plan still scheduled', planRepository.getById('plan-scope2')?.status === 'scheduled');

    // 激活 scope2
    const result2 = service.activateTodayPlans(scope2);
    check('ScopeIso: scope2 activates 1 plan', result2.activatedPlans.length === 1);
    check('ScopeIso: scope2 plan is active', planRepository.getById('plan-scope2')?.status === 'active');
  } finally {
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 8： cancelled 计划不会被激活 =====
function testCancelledPlansNotActivated(): void {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId } = setupTestEnv(dbPath);
    cleanupAll();
    const scope = { userId, characterId };

    const clock = new FixedClock(new Date('2026-07-15T00:00:00.000Z'));
    const timeService = new TimeService('Asia/Shanghai', clock);
    const service = new CalendarActivationService(timeService);

    // 创建 scheduled 计划
    createScheduledPlan(scope, '2026-07-15', 'plan-cancelled', [
      { content: '取消的任务', start_time: '10:00', end_time: '11:00' }
    ]);

    // 取消计划
    const cancelled = planRepository.cancelPlan('plan-cancelled');
    check('Cancelled: cancelPlan returns true', cancelled === true);
    check('Cancelled: status=cancelled', planRepository.getById('plan-cancelled')?.status === 'cancelled');

    // 激活今天计划：cancelled 计划不应被激活
    const result = service.activateTodayPlans(scope);
    check('Cancelled: activatedPlans.length=0', result.activatedPlans.length === 0);
    check('Cancelled: plan still cancelled', planRepository.getById('plan-cancelled')?.status === 'cancelled');
  } finally {
    cleanupDbFile(dbPath);
  }
}

async function main(): Promise<void> {
  console.log('=== CalendarActivationService 测试 ===\n');

  testScheduledTransitionsToActive();
  testIdempotentActivation();
  testMiddayStartupActivation();
  testCrossDayActivation();
  testActivationDoesNotCallModel();
  testNoScheduledPlansReturnsEmpty();
  testScopeIsolation();
  testCancelledPlansNotActivated();

  console.log(`\n=== 结果：${pass} 通过 / ${fail} 失败 ===`);
  if (failures.length > 0) {
    console.error('失败用例：');
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('测试运行失败：', e);
  process.exit(1);
});
