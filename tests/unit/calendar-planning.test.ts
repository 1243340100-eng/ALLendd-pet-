/**
 * 跨日期日历计划测试。
 * 验证规格第三、五、六、十节相关测试项：
 *   1. "明天上午八点"在今天下午仍可创建（future_date 模式）
 *   2. 今天过去时间仍被拒绝（today 模式）
 *   4. 跨月日期
 *   5. 跨年日期
 *   6. 闰年 2 月 29 日
 *   9. 按日期创建未来草案
 *  10. 确认未来计划后状态为 scheduled
 *  16. 按日期修改指定计划
 *  17. 按任务内容搜索计划
 *  19. 修改后 PlanMemoryRetriever 返回新内容
 *  20. 不返回取消计划的过期副本
 *  21. 两个日期的 checkpoint 不互相覆盖
 *  22. user/character 数据隔离
 *  23. 月历 IPC 只返回指定月份
 *  29. 模型输出非法 target_date 被拒绝
 *
 * 运行：npx tsx tests/unit/calendar-planning.test.ts
 */
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

import { initDatabase, closeDatabase, getDatabase } from '../../src/infrastructure/database/connection';
import { settingsRepository } from '../../src/infrastructure/database/repositories/settings-repository';
import { planRepository } from '../../src/infrastructure/database/repositories/plan-repository';
import { checkpointRepository } from '../../src/infrastructure/database/repositories/checkpoint-repository';
import { runMigrations } from '../../src/infrastructure/database/migration-runner';

import { TimeService, FixedClock } from '../../src/services/TimeService';
import { planMemoryRetriever } from '../../src/services/PlanMemoryRetriever';
import { validateTargetDate, validatePlanDraftByMode } from '../../src/agent/graphs/planning/tools';

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'petdb-cal-plan-'));
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

  const userId = 'cal-plan-user';
  const characterId = 'cal-plan-roxy';

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
    getDatabase().prepare('DELETE FROM graph_checkpoints').run();
  } catch { /* ignore */ }
}

/** 固定测试时间：2026-07-11 14:00 Shanghai（UTC 06:00） */
const FIXED_TEST_DATE = new Date('2026-07-11T06:00:00.000Z');

function createFixedClock(date: Date = FIXED_TEST_DATE): FixedClock {
  return new FixedClock(date);
}

function createTimeService(clock?: FixedClock): TimeService {
  return new TimeService('Asia/Shanghai', clock ?? createFixedClock());
}

/** 创建计划并写入任务 */
function createPlan(
  scope: { userId: string; characterId: string },
  planId: string,
  date: string,
  status: 'draft' | 'scheduled' | 'active' | 'completed',
  tasks: Array<{ content: string; start_time: string; end_time: string; completed?: boolean }>
): void {
  planRepository.insert({
    id: planId,
    date,
    status,
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
      completed: t.completed ? 1 : 0,
      order_index: i
    })));
  }
}

// ===== 测试 1：未来日期允许早于当前时刻的时间 =====
function testFutureDateAllowsEarlyTime(): void {
  // 今天 2026-07-11 14:00，明天 2026-07-12 08:00 应该合法
  const todayDate = '2026-07-11';
  const result = validateTargetDate('2026-07-12', todayDate);
  check('FutureDate: validateTargetDate valid', result.valid === true);
  check('FutureDate: mode=future_date', result.mode === 'future_date');

  // future_date 模式下 08:00 不应被"早于当前时间"拒绝
  const draftResult = validatePlanDraftByMode(
    [{ content: '晨会', start_time: '08:00', end_time: '09:00' }],
    'future_date'
  );
  check('FutureDate: 08:00 task valid in future_date mode', draftResult.valid === true);
}

// ===== 测试 2：今天模式拒绝过去时间 =====
function testTodayRejectsPastTime(): void {
  // 今天 14:00，09:00 任务应该被拒绝
  const draftResult = validatePlanDraftByMode(
    [{ content: '上午会议', start_time: '09:00', end_time: '10:00' }],
    'today',
    { currentTimeHour: 14, currentTimeMinute: 0 }
  );
  check('Today: 09:00 task rejected at 14:00', draftResult.valid === false);
  check('Today: error mentions past time', /过去时间|早于当前时间/.test(draftResult.error || ''));
}

// ===== 测试 3：跨月日期 =====
function testCrossMonthDate(): void {
  // 今天 2026-07-31，下月 2026-08-01 应该是 future_date
  const result = validateTargetDate('2026-08-01', '2026-07-31');
  check('CrossMonth: valid', result.valid === true);
  check('CrossMonth: mode=future_date', result.mode === 'future_date');
}

// ===== 测试 4：跨年日期 =====
function testCrossYearDate(): void {
  // 今天 2026-12-31，明年 2027-01-01 应该是 future_date
  const result = validateTargetDate('2027-01-01', '2026-12-31');
  check('CrossYear: valid', result.valid === true);
  check('CrossYear: mode=future_date', result.mode === 'future_date');
}

// ===== 测试 5：闰年 2 月 29 日 =====
function testLeapYearFeb29(): void {
  // 2028 年是闰年，2 月 29 日合法
  const result = validateTargetDate('2028-02-29', '2026-07-11');
  check('LeapYear: 2028-02-29 valid', result.valid === true);
  check('LeapYear: mode=future_date', result.mode === 'future_date');

  // 2027 年不是闰年，2 月 29 日不合法
  const result2 = validateTargetDate('2027-02-29', '2026-07-11');
  check('LeapYear: 2027-02-29 invalid', result2.valid === false);
}

// ===== 测试 6：过去日期默认拒绝创建 =====
function testPastDateRejectedByDefault(): void {
  const result = validateTargetDate('2026-07-10', '2026-07-11');
  check('PastDate: rejected by default', result.valid === false);
  check('PastDate: mode=past_date', result.mode === 'past_date');
  check('PastDate: error mentions past', /过去日期/.test(result.error || ''));
}

// ===== 测试 7：过去日期 allowPast=true 允许查看 =====
function testPastDateAllowedWithAllowPast(): void {
  const result = validateTargetDate('2026-07-10', '2026-07-11', { allowPast: true });
  check('PastDateView: valid with allowPast', result.valid === true);
  check('PastDateView: mode=past_date', result.mode === 'past_date');
}

// ===== 测试 8：非法 target_date 格式被拒绝 =====
function testInvalidTargetDateRejected(): void {
  // 非 YYYY-MM-DD 格式
  check('InvalidDate: 2026-7-12 rejected', validateTargetDate('2026-7-12', '2026-07-11').valid === false);
  check('InvalidDate: 07/12/2026 rejected', validateTargetDate('07/12/2026', '2026-07-11').valid === false);
  check('InvalidDate: empty rejected', validateTargetDate('', '2026-07-11').valid === false);
  check('InvalidDate: undefined rejected', validateTargetDate(undefined, '2026-07-11').valid === false);
  // 非法月份
  check('InvalidDate: 2026-13-01 rejected', validateTargetDate('2026-13-01', '2026-07-11').valid === false);
  // 非法日
  check('InvalidDate: 2026-07-32 rejected', validateTargetDate('2026-07-32', '2026-07-11').valid === false);
}

// ===== 测试 9：按日期创建未来草案（planRepository 层） =====
function testCreateFutureDraftByDate(): void {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId } = setupTestEnv(dbPath);
    cleanupAll();
    const scope = { userId, characterId };

    // 为 2026-07-20 创建草案
    createPlan(scope, 'plan-future-draft-1', '2026-07-20', 'draft', [
      { content: '写报告', start_time: '09:00', end_time: '11:00' },
      { content: '健身', start_time: '15:00', end_time: '16:00' }
    ]);

    // 通过 scope + date 查询
    const found = planRepository.getDraftPlanByDate(scope, '2026-07-20');
    check('FutureDraft: found by date', found !== null);
    check('FutureDraft: correct planId', found?.id === 'plan-future-draft-1');
    check('FutureDraft: status=draft', found?.status === 'draft');
    check('FutureDraft: 2 tasks', (found?.tasks?.length ?? 0) === 2);

    // scope 隔离：另一个 scope 查不到
    const otherScope = { userId: 'other-user', characterId: 'other-roxy' };
    const notFound = planRepository.getDraftPlanByDate(otherScope, '2026-07-20');
    check('FutureDraft: other scope cannot find', notFound === null);
  } finally {
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 10：确认未来计划后状态为 scheduled =====
function testPublishFuturePlanAsScheduled(): void {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId } = setupTestEnv(dbPath);
    cleanupAll();
    const scope = { userId, characterId };

    createPlan(scope, 'plan-publish-future', '2026-07-20', 'draft', [
      { content: '任务1', start_time: '09:00', end_time: '10:00' }
    ]);

    // 标记用户确认
    planRepository.markUserConfirmed('plan-publish-future');

    // 发布为 scheduled（未来计划）
    const published = planRepository.publishPlan('plan-publish-future', 'scheduled');
    check('PublishFuture: publishPlan returns true', published === true);

    const plan = planRepository.getById('plan-publish-future');
    check('PublishFuture: status=scheduled', plan?.status === 'scheduled');
  } finally {
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 11：按任务内容搜索计划 =====
function testSearchPlansByContent(): void {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId } = setupTestEnv(dbPath);
    cleanupAll();
    const scope = { userId, characterId };

    // 创建两个计划，一个含"健身"
    createPlan(scope, 'plan-search-1', '2026-07-15', 'scheduled', [
      { content: '健身', start_time: '09:00', end_time: '10:00' }
    ]);
    createPlan(scope, 'plan-search-2', '2026-07-16', 'scheduled', [
      { content: '写代码', start_time: '09:00', end_time: '10:00' }
    ]);

    // 搜索"健身"
    const results = planRepository.searchPlans(scope, '健身');
    check('Search: found 1 plan with 健身', results.length === 1);
    check('Search: correct planId', results[0]?.id === 'plan-search-1');
    check('Search: correct date', results[0]?.date === '2026-07-15');

    // PlanMemoryRetriever 搜索
    const summaries = planMemoryRetriever.search(scope, '健身');
    check('Search: retriever returns 1 summary', summaries.length === 1);
    check('Search: summary has planId', summaries[0]?.planId === 'plan-search-1');
    check('Search: summary taskCount=1', summaries[0]?.taskCount === 1);
  } finally {
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 12：修改后 PlanMemoryRetriever 返回新内容 =====
function testRetrieverReturnsUpdatedContent(): void {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId } = setupTestEnv(dbPath);
    cleanupAll();
    const scope = { userId, characterId };

    createPlan(scope, 'plan-update-1', '2026-07-15', 'scheduled', [
      { content: '原始任务', start_time: '09:00', end_time: '10:00' }
    ]);

    // 修改前检索
    const before = planMemoryRetriever.getByDate(scope, '2026-07-15');
    check('Retriever: before update content=原始任务', before?.taskSummary[0]?.content === '原始任务');

    // patch 任务内容
    planRepository.patchTask('plan-update-1', { id: 'plan-update-1-task-1', content: '修改后的任务' });

    // 修改后检索
    const after = planMemoryRetriever.getByDate(scope, '2026-07-15');
    check('Retriever: after update content=修改后的任务', after?.taskSummary[0]?.content === '修改后的任务');
  } finally {
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 13：不返回取消计划的过期副本 =====
function testCancelledPlansNotReturned(): void {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId } = setupTestEnv(dbPath);
    cleanupAll();
    const scope = { userId, characterId };

    createPlan(scope, 'plan-cancelled-1', '2026-07-15', 'scheduled', [
      { content: '取消的任务', start_time: '09:00', end_time: '10:00' }
    ]);

    // 取消计划
    planRepository.cancelPlan('plan-cancelled-1');

    // getByDate 不应返回取消的计划
    const byDate = planMemoryRetriever.getByDate(scope, '2026-07-15');
    check('Cancelled: getByDate returns null', byDate === null);

    // search 不应返回取消的计划
    const searchResults = planMemoryRetriever.search(scope, '取消');
    check('Cancelled: search returns 0 results', searchResults.length === 0);

    // listByRange 不应返回取消的计划
    const rangeResults = planMemoryRetriever.listByRange(scope, '2026-07-01', '2026-07-31');
    check('Cancelled: listByRange returns 0 results', rangeResults.length === 0);
  } finally {
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 14：两个日期的 checkpoint 不互相覆盖 =====
function testCheckpointsNotOverwritten(): void {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId } = setupTestEnv(dbPath);
    cleanupAll();

    // 为 2026-07-15 创建 checkpoint
    const scopeKey15 = `${userId}:${characterId}:date:2026-07-15`;
    checkpointRepository.save({
      id: 'cp-15',
      graph_type: 'planning',
      scope_key: scopeKey15,
      state_json: JSON.stringify({ planningThreadId: 'date:2026-07-15', message: '7月15日草案' }),
      reason: 'awaiting_confirmation'
    });

    // 为 2026-07-16 创建 checkpoint
    const scopeKey16 = `${userId}:${characterId}:date:2026-07-16`;
    checkpointRepository.save({
      id: 'cp-16',
      graph_type: 'planning',
      scope_key: scopeKey16,
      state_json: JSON.stringify({ planningThreadId: 'date:2026-07-16', message: '7月16日草案' }),
      reason: 'awaiting_confirmation'
    });

    // 两个 checkpoint 都应该存在
    const cp15 = checkpointRepository.getActiveByScope('planning', scopeKey15);
    const cp16 = checkpointRepository.getActiveByScope('planning', scopeKey16);
    check('Checkpoint: 7/15 exists', cp15 !== null);
    check('Checkpoint: 7/16 exists', cp16 !== null);

    // 内容不互相覆盖
    const state15 = JSON.parse(cp15?.state_json || '{}');
    const state16 = JSON.parse(cp16?.state_json || '{}');
    check('Checkpoint: 7/15 message correct', state15.message === '7月15日草案');
    check('Checkpoint: 7/16 message correct', state16.message === '7月16日草案');
    check('Checkpoint: 7/15 threadId correct', state15.planningThreadId === 'date:2026-07-15');
    check('Checkpoint: 7/16 threadId correct', state16.planningThreadId === 'date:2026-07-16');
  } finally {
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 15：user/character 数据隔离 =====
function testScopeIsolation(): void {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId } = setupTestEnv(dbPath);
    cleanupAll();
    const scope1 = { userId, characterId };
    const scope2 = { userId: 'other-user', characterId: 'other-roxy' };

    // 两个 scope 各创建一个相同日期的计划
    createPlan(scope1, 'plan-iso-1', '2026-07-15', 'scheduled', [
      { content: 'scope1 任务', start_time: '09:00', end_time: '10:00' }
    ]);
    createPlan(scope2, 'plan-iso-2', '2026-07-15', 'scheduled', [
      { content: 'scope2 任务', start_time: '09:00', end_time: '10:00' }
    ]);

    // scope1 只看到自己的计划
    const plan1 = planRepository.getPlanByDate(scope1, '2026-07-15');
    check('ScopeIso: scope1 sees own plan', plan1?.id === 'plan-iso-1');

    // scope2 只看到自己的计划
    const plan2 = planRepository.getPlanByDate(scope2, '2026-07-15');
    check('ScopeIso: scope2 sees own plan', plan2?.id === 'plan-iso-2');

    // 月视图也隔离
    const month1 = planRepository.getPlansForMonth(scope1, 2026, 7);
    const month2 = planRepository.getPlansForMonth(scope2, 2026, 7);
    check('ScopeIso: scope1 month has 1 plan', month1.length === 1);
    check('ScopeIso: scope2 month has 1 plan', month2.length === 1);
    check('ScopeIso: scope1 month correct id', month1[0]?.id === 'plan-iso-1');
    check('ScopeIso: scope2 month correct id', month2[0]?.id === 'plan-iso-2');
  } finally {
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 16：月历只返回指定月份的数据 =====
function testMonthOnlyReturnsSpecifiedMonth(): void {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId } = setupTestEnv(dbPath);
    cleanupAll();
    const scope = { userId, characterId };

    // 创建 7 月、8 月、6 月的计划
    createPlan(scope, 'plan-jun', '2026-06-20', 'completed', [
      { content: '6月任务', start_time: '09:00', end_time: '10:00' }
    ]);
    createPlan(scope, 'plan-jul', '2026-07-15', 'scheduled', [
      { content: '7月任务', start_time: '09:00', end_time: '10:00' }
    ]);
    createPlan(scope, 'plan-aug', '2026-08-15', 'scheduled', [
      { content: '8月任务', start_time: '09:00', end_time: '10:00' }
    ]);

    // 查询 7 月：应该只返回 7 月的计划
    const julyResults = planRepository.getPlansForMonth(scope, 2026, 7);
    check('MonthOnly: july returns 1 plan', julyResults.length === 1);
    check('MonthOnly: july correct date', julyResults[0]?.date === '2026-07-15');

    // 查询 8 月
    const augResults = planRepository.getPlansForMonth(scope, 2026, 8);
    check('MonthOnly: august returns 1 plan', augResults.length === 1);
    check('MonthOnly: august correct date', augResults[0]?.date === '2026-08-15');

    // 查询 6 月
    const junResults = planRepository.getPlansForMonth(scope, 2026, 6);
    check('MonthOnly: june returns 1 plan', junResults.length === 1);
    check('MonthOnly: june correct date', junResults[0]?.date === '2026-06-20');

    // 通过 PlanMemoryRetriever.getMonthSummary 验证
    const summary = planMemoryRetriever.getMonthSummary(scope, 2026, 7);
    check('MonthOnly: retriever july returns 1 day', summary.length === 1);
    check('MonthOnly: retriever july date correct', summary[0]?.date === '2026-07-15');
    check('MonthOnly: retriever july taskCount=1', summary[0]?.taskCount === 1);
  } finally {
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 17：按日期范围查询计划 =====
function testListPlansByRange(): void {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId } = setupTestEnv(dbPath);
    cleanupAll();
    const scope = { userId, characterId };

    createPlan(scope, 'plan-r1', '2026-07-10', 'completed', [
      { content: '任务', start_time: '09:00', end_time: '10:00' }
    ]);
    createPlan(scope, 'plan-r2', '2026-07-15', 'scheduled', [
      { content: '任务', start_time: '09:00', end_time: '10:00' }
    ]);
    createPlan(scope, 'plan-r3', '2026-07-20', 'scheduled', [
      { content: '任务', start_time: '09:00', end_time: '10:00' }
    ]);

    // 范围 7/12 - 7/18：只返回 plan-r2
    const range1 = planRepository.listPlansByRange(scope, '2026-07-12', '2026-07-18');
    check('Range: 7/12-7/18 returns 1 plan', range1.length === 1);
    check('Range: correct planId', range1[0]?.id === 'plan-r2');

    // 范围 7/01 - 7/31：返回 3 个
    const range2 = planRepository.listPlansByRange(scope, '2026-07-01', '2026-07-31');
    check('Range: 7/01-7/31 returns 3 plans', range2.length === 3);

    // 通过 retriever 验证
    const summaries = planMemoryRetriever.listByRange(scope, '2026-07-12', '2026-07-18');
    check('Range: retriever returns 1 summary', summaries.length === 1);
    check('Range: retriever correct planId', summaries[0]?.planId === 'plan-r2');
  } finally {
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 18：同一日期只允许一个 live plan（draft/scheduled/active） =====
function testUniqueLivePlanPerDate(): void {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId } = setupTestEnv(dbPath);
    cleanupAll();
    const scope = { userId, characterId };

    // 创建 draft 计划
    createPlan(scope, 'plan-unique-1', '2026-07-15', 'draft', [
      { content: '任务', start_time: '09:00', end_time: '10:00' }
    ]);

    // 尝试在同一天创建第二个 draft 计划：应该被数据库约束拒绝
    let secondInsertFailed = false;
    try {
      createPlan(scope, 'plan-unique-2', '2026-07-15', 'draft', [
        { content: '任务2', start_time: '11:00', end_time: '12:00' }
      ]);
    } catch (e) {
      secondInsertFailed = true;
    }
    check('UniqueLive: second draft on same date rejected', secondInsertFailed === true);

    // cancelled 状态允许同一天再创建（live plan 已经不存在）
    planRepository.cancelPlan('plan-unique-1');
    let thirdInsertOk = true;
    try {
      createPlan(scope, 'plan-unique-3', '2026-07-15', 'draft', [
        { content: '任务3', start_time: '13:00', end_time: '14:00' }
      ]);
    } catch (e) {
      thirdInsertOk = false;
    }
    check('UniqueLive: new plan after cancel allowed', thirdInsertOk === true);
  } finally {
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 19：最后任务完成后计划进入 completed =====
function testCompletePlanWhenAllTasksDone(): void {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId } = setupTestEnv(dbPath);
    cleanupAll();
    const scope = { userId, characterId };

    createPlan(scope, 'plan-complete', '2026-07-15', 'active', [
      { content: '任务1', start_time: '09:00', end_time: '10:00' },
      { content: '任务2', start_time: '11:00', end_time: '12:00' }
    ]);

    // 检查初始状态：未全部完成
    check('Complete: not all completed initially', planRepository.areAllTasksCompleted('plan-complete') === false);

    // 完成第一个任务
    planRepository.toggleTaskCompletion('plan-complete-task-1', true);
    check('Complete: not all completed after 1st task', planRepository.areAllTasksCompleted('plan-complete') === false);

    // 完成第二个任务
    planRepository.toggleTaskCompletion('plan-complete-task-2', true);
    check('Complete: all completed after 2nd task', planRepository.areAllTasksCompleted('plan-complete') === true);

    // 调用 completePlan
    const completed = planRepository.completePlan('plan-complete');
    check('Complete: completePlan returns true', completed === true);
    check('Complete: status=completed', planRepository.getById('plan-complete')?.status === 'completed');
  } finally {
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 20：getTodayActivePlan 返回今天的 active 计划 =====
function testGetTodayActivePlan(): void {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId } = setupTestEnv(dbPath);
    cleanupAll();
    const scope = { userId, characterId };

    // 创建今天的 active 计划
    createPlan(scope, 'plan-today-active', '2026-07-11', 'active', [
      { content: '今天的任务', start_time: '15:00', end_time: '16:00' }
    ]);
    // 创建明天的 scheduled 计划（不应被返回）
    createPlan(scope, 'plan-tomorrow-scheduled', '2026-07-12', 'scheduled', [
      { content: '明天的任务', start_time: '09:00', end_time: '10:00' }
    ]);

    const todayPlan = planRepository.getTodayActivePlan(scope, '2026-07-11');
    check('TodayActive: found', todayPlan !== null);
    check('TodayActive: correct planId', todayPlan?.id === 'plan-today-active');
    check('TodayActive: status=active', todayPlan?.status === 'active');

    // 7/12 不应返回 active 计划（scheduled 不是 active）
    const tomorrowActive = planRepository.getTodayActivePlan(scope, '2026-07-12');
    check('TodayActive: tomorrow no active plan', tomorrowActive === null);
  } finally {
    cleanupDbFile(dbPath);
  }
}

async function main(): Promise<void> {
  console.log('=== 跨日期日历计划测试 ===\n');

  testFutureDateAllowsEarlyTime();
  testTodayRejectsPastTime();
  testCrossMonthDate();
  testCrossYearDate();
  testLeapYearFeb29();
  testPastDateRejectedByDefault();
  testPastDateAllowedWithAllowPast();
  testInvalidTargetDateRejected();
  testCreateFutureDraftByDate();
  testPublishFuturePlanAsScheduled();
  testSearchPlansByContent();
  testRetrieverReturnsUpdatedContent();
  testCancelledPlansNotReturned();
  testCheckpointsNotOverwritten();
  testScopeIsolation();
  testMonthOnlyReturnsSpecifiedMonth();
  testListPlansByRange();
  testUniqueLivePlanPerDate();
  testCompletePlanWhenAllTasksDone();
  testGetTodayActivePlan();

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
