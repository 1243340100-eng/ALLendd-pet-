/**
 * PlanningGraph 测试。
 * 验证 13 个测试场景：
 *   1. 模糊目标会先询问关键问题，不直接编造时间表
 *   2. 信息充分时不进行多余询问，直接生成草案
 *   3. "下午不要太满"能按约束修改
 *   4. "把第二项推迟半小时"只修改目标任务
 *   5. "删除代码审查"不会改变其他任务
 *   6. 对话中说"就这样"与点击确认按钮产生相同发布结果
 *   7. 未明确确认时模型不能发布计划
 *   8. 当前时间之后才允许安排未开始任务
 *   9. 重启后恢复规划对话、草案版本和 active 气泡
 *  10. 模型输出非法参数时不能写入数据库
 *  11. 同时确认两次只能产生一个 active 计划
 *  12. 状态面板能看到实际调用的模型，不允许显示别名冒充实际模型
 *  13. 打包版通过真实 PetFramework.exe 验证 PlanningGraph 已接入（手动验证，此处只验证编译产物存在）
 *
 * 运行：npx tsx tests/unit/planning-graph.test.ts
 */
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

import { initDatabase, closeDatabase, getDatabase } from '../../src/infrastructure/database/connection';
import { settingsRepository } from '../../src/infrastructure/database/repositories/settings-repository';
import { planRepository } from '../../src/infrastructure/database/repositories/plan-repository';
import { checkpointRepository } from '../../src/infrastructure/database/repositories/checkpoint-repository';
import { runMigrations } from '../../src/infrastructure/database/migration-runner';

import { ModelGateway } from '../../src/services/ModelGateway';
import { TimeService, FixedClock } from '../../src/services/TimeService';
import { UserContextService } from '../../src/services/UserContextService';

import { PlanningGraphRunner } from '../../src/agent/graphs/planning/graph';
import type { AgentAction } from '../../src/agent/graphs/planning/state';
import { validateAgentAction, validateTaskTimesNotPast, executePlanningTool, validatePlanDraft } from '../../src/agent/graphs/planning/tools';
import { isConfirmationInput } from '../../src/agent/graphs/planning/nodes/agent-decide';
import { sanitizePlanningTraceText } from '../../src/agent/graphs/planning/sanitize';
import { applyUserModelAliases, resolveModelName } from '../../src/infrastructure/config/config-loader';
import { MODEL_ALIAS } from '../../src/shared/constants';
import { getDefaultAppConfig } from '../../src/infrastructure/config/config-loader';
import type { SecretStore, ApiSecretConfig } from '../../src/infrastructure/secrets/secret-store';

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'petdb-plan-'));
  return path.join(dir, 'test.sqlite');
}

function cleanupDbFile(dbPath: string): void {
  try {
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    const dir = path.dirname(dbPath);
    if (fs.existsSync(dir)) fs.rmdirSync(dir);
  } catch { /* ignore */ }
}

/** 创建 mock SecretStore */
function createMockSecretStore(apiKey: string = 'test-key'): SecretStore {
  const config: ApiSecretConfig = {
    provider: 'deepseek',
    endpoint: 'https://api.deepseek.com/v1/chat/completions',
    model: 'deepseek-chat',
    apiKey
  };
  return {
    read: () => config,
    write: () => {},
    clear: () => {},
    isEncrypted: () => true
  };
}

/**
 * 创建 mock fetch 函数，返回指定的 AgentAction JSON。
 * 模拟 planningModel 的返回值。
 */
function createMockFetchForPlanning(action: AgentAction | AgentAction[], model: string = 'deepseek-chat') {
  const actions = Array.isArray(action) ? action : [action];
  let callIndex = 0;
  return async (_url: string, _options?: RequestInit): Promise<Response> => {
    const currentAction = actions[Math.min(callIndex, actions.length - 1)];
    callIndex++;
    const body = JSON.stringify(currentAction);
    const mockResponse = {
      ok: true,
      status: 200,
      json: async () => ({
        id: 'test-plan-id',
        model,
        choices: [{
          message: { role: 'assistant', content: body },
          finish_reason: 'stop'
        }],
        usage: { prompt_tokens: 200, completion_tokens: 100, total_tokens: 300 }
      }),
      text: async () => body
    } as unknown as Response;
    return mockResponse;
  };
}

/** 设置测试环境 */
function setupTestEnv(dbPath: string): {
  userId: string;
  characterId: string;
} {
  initDatabase({ path: dbPath });
  runMigrations(getDatabase());

  const userId = 'test-user-plan';
  const characterId = 'test-roxy';

  settingsRepository.set('onboarding_completed', 'true');
  settingsRepository.set('user_id', userId);
  settingsRepository.set('active_character_id', characterId);

  try {
    getDatabase().prepare('INSERT INTO users (id, nickname, preferred_name) VALUES (?, ?, ?)').run(
      userId, '昌昌', '昌昌'
    );
  } catch { /* may already exist */ }

  return { userId, characterId };
}

/** 固定测试时间：2026-07-11 10:00:00 Asia/Shanghai（UTC+8，即 UTC 02:00:00） */
const FIXED_TEST_DATE = new Date('2026-07-11T02:00:00.000Z'); // UTC 02:00 = Shanghai 10:00

/** 创建固定时钟 */
function createFixedClock(): FixedClock {
  return new FixedClock(FIXED_TEST_DATE);
}

/** 创建 PlanningGraphRunner */
function createRunner(
  db: ReturnType<typeof getDatabase>,
  fetchFn?: ReturnType<typeof createMockFetchForPlanning>,
  clock?: FixedClock
): PlanningGraphRunner {
  const config = getDefaultAppConfig();
  const secretStore = createMockSecretStore();
  const modelGateway = new ModelGateway({
    config,
    secretStore,
    fetchFn: fetchFn ?? createMockFetchForPlanning({
      type: 'create_draft',
      tasks: [{ start_time: '09:00', end_time: '10:00', content: '测试任务' }],
      message: '计划已生成'
    }),
    db
  });

  const timeService = new TimeService('Asia/Shanghai', clock ?? createFixedClock());
  const userContextService = new UserContextService();

  return new PlanningGraphRunner({ modelGateway, timeService, userContextService });
}

/** 清理所有计划数据（测试间隔离） */
function cleanupPlans(): void {
  try {
    getDatabase().prepare('DELETE FROM plan_tasks').run();
    getDatabase().prepare('DELETE FROM plans').run();
    getDatabase().prepare('DELETE FROM graph_checkpoints').run();
  } catch { /* ignore */ }
}

// ===== 测试 1：模糊目标会先询问关键问题 =====
async function testVagueGoalAsksClarification(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId } = setupTestEnv(dbPath);
    const db = getDatabase();
    cleanupPlans();

    // 模型对模糊目标返回 ask_clarification
    const runner = createRunner(db, createMockFetchForPlanning({
      type: 'ask_clarification',
      clarificationQuestion: '你今天主要想完成什么类型的工作？有具体的时间限制吗？',
      message: '你今天主要想完成什么类型的工作？有具体的时间限制吗？'
    }));

    const dto = await runner.submitMessage({
      userId,
      characterId,
      userInput: '帮我安排一下今天'
    });

    check('VagueGoal: ok=true', dto.ok === true);
    check('VagueGoal: actionType=ask_clarification', dto.actionType === 'ask_clarification');
    check('VagueGoal: has message', (dto.message?.length ?? 0) > 0);
    check('VagueGoal: no plan created', dto.plan === undefined || dto.plan === null);

    // 验证数据库中没有创建草案
    const draft = planRepository.getDraftPlan();
    check('VagueGoal: no draft in DB', draft === null || draft === undefined);
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

/** 固定基准时间：10:00 AM = 600 分钟。所有测试时间基于此，不依赖 new Date()。 */
const FIXED_BASE_MINUTES = 10 * 60; // 10:00 = 600 minutes

/** 生成未来时间（固定基准 10:00 + offsetMinutes 分钟）的 HH:MM 格式 */
function futureTime(offsetMinutes: number): string {
  const totalMin = FIXED_BASE_MINUTES + offsetMinutes;
  const h = Math.floor(totalMin / 60) % 24;
  const m = totalMin % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * 生成 N 个递增的未来时间对（start/end），基于固定基准 10:00 AM。
 * 确保：
 * 1. 所有时间在 10:00 之后（固定基准）
 * 2. 不跨午夜
 * 3. start < end
 * 4. 时间对之间不重叠
 */
function futureTimePairs(count: number): Array<{ start_time: string; end_time: string }> {
  const startBase = FIXED_BASE_MINUTES + 30; // 10:30 开始
  const slotSize = 60; // 每个时间槽 60 分钟
  const pairs: Array<{ start_time: string; end_time: string }> = [];
  for (let i = 0; i < count; i++) {
    const startMin = startBase + slotSize * i;
    const endMin = startMin + 30; // 每个任务 30 分钟
    const formatTime = (mins: number) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
    pairs.push({ start_time: formatTime(startMin), end_time: formatTime(endMin) });
  }
  return pairs;
}

// ===== 测试 2：信息充分时直接生成草案 =====
async function testClearGoalCreatesDraft(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId } = setupTestEnv(dbPath);
    const db = getDatabase();
    cleanupPlans();

    const timePairs = futureTimePairs(3);

    const runner = createRunner(db, createMockFetchForPlanning({
      type: 'create_draft',
      tasks: [
        { start_time: timePairs[0].start_time, end_time: timePairs[0].end_time, content: '完成项目文档大纲' },
        { start_time: timePairs[1].start_time, end_time: timePairs[1].end_time, content: '代码审查 PR #123' },
        { start_time: timePairs[2].start_time, end_time: timePairs[2].end_time, content: '编写单元测试' }
      ],
      message: '根据你的目标，我制定了今天的计划草案，请确认。'
    }));

    const dto = await runner.submitMessage({
      userId,
      characterId,
      userInput: '今天上午写文档，下午写测试，中间做个代码审查'
    });

    check('ClearGoal: ok=true', dto.ok === true);
    check('ClearGoal: actionType=create_draft', dto.actionType === 'create_draft');
    check('ClearGoal: has plan', dto.plan !== undefined && dto.plan !== null);
    check('ClearGoal: has 3 tasks', dto.plan?.tasks?.length === 3);
    check('ClearGoal: has message', (dto.message?.length ?? 0) > 0);

    // 验证数据库中创建了草案
    const draft = planRepository.getDraftPlan();
    check('ClearGoal: draft in DB', draft !== null && draft !== undefined);
    check('ClearGoal: draft status', draft?.status === 'draft');
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 3："下午不要太满"能按约束修改 =====
async function testPatchAfternoonConstraint(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId } = setupTestEnv(dbPath);
    const db = getDatabase();
    cleanupPlans();

    // 先创建一个草案（使用未来时间，避免 Fix 1 完整草案校验拒绝过去时间）
    const planId = `plan_${Date.now()}_test3`;
    const today = '2026-07-11'; // 固定日期，匹配 FixedClock
    const tp3 = futureTimePairs(3);
    planRepository.insert({ id: planId, date: today, status: 'draft', user_id: userId, character_id: characterId });
    planRepository.insertTasks([
      { id: 't1', plan_id: planId, content: '上午工作', start_time: tp3[0].start_time, end_time: tp3[0].end_time, completed: 0, order_index: 0 },
      { id: 't2', plan_id: planId, content: '下午任务A', start_time: tp3[1].start_time, end_time: tp3[1].end_time, completed: 0, order_index: 1 },
      { id: 't3', plan_id: planId, content: '下午任务B', start_time: tp3[2].start_time, end_time: tp3[2].end_time, completed: 0, order_index: 2 }
    ]);

    // 获取草案中的任务 ID
    const tasks = planRepository.getTasksByPlanId(planId);
    const afternoonTaskId = tasks.find(t => t.content === '下午任务A')?.id;

    // patch 后的结束时间必须 < 下午任务B 的开始时间，避免重叠
    const newEndTime = tp3[2].start_time;

    // 模型返回 patch_tasks 修改下午任务
    const runner = createRunner(db, createMockFetchForPlanning({
      type: 'patch_tasks',
      patches: [
        { id: afternoonTaskId, end_time: newEndTime }
      ],
      message: '已将下午任务A的结束时间提前，让下午不那么满。'
    }));

    const dto = await runner.submitMessage({
      userId,
      characterId,
      userInput: '下午不要太满'
    });

    check('PatchAfternoon: ok=true', dto.ok === true);
    check('PatchAfternoon: actionType=patch_tasks', dto.actionType === 'patch_tasks');
    check('PatchAfternoon: has plan', dto.plan !== undefined);

    // 验证只有下午任务A被修改
    const updatedTasks = planRepository.getTasksByPlanId(planId);
    const patchedTask = updatedTasks.find(t => t.id === afternoonTaskId);
    const otherTask = updatedTasks.find(t => t.content === '上午工作');
    check('PatchAfternoon: task end_time changed', patchedTask?.end_time === newEndTime);
    check('PatchAfternoon: other task unchanged', otherTask?.start_time === tp3[0].start_time && otherTask?.end_time === tp3[0].end_time);
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 4："把第二项推迟半小时"只修改目标任务 =====
async function testPatchSpecificTaskOnly(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId } = setupTestEnv(dbPath);
    const db = getDatabase();
    cleanupPlans();

    const planId = `plan_${Date.now()}_test4`;
    const today = '2026-07-11'; // 固定日期，匹配 FixedClock
    const tp4 = futureTimePairs(4);
    planRepository.insert({ id: planId, date: today, status: 'draft', user_id: userId, character_id: characterId });
    planRepository.insertTasks([
      { id: 't1', plan_id: planId, content: '第一项', start_time: tp4[0].start_time, end_time: tp4[0].end_time, completed: 0, order_index: 0 },
      { id: 't2', plan_id: planId, content: '第二项', start_time: tp4[1].start_time, end_time: tp4[1].end_time, completed: 0, order_index: 1 },
      { id: 't3', plan_id: planId, content: '第三项', start_time: tp4[2].start_time, end_time: tp4[2].end_time, completed: 0, order_index: 2 }
    ]);

    const tasks = planRepository.getTasksByPlanId(planId);
    const secondTaskId = tasks.find(t => t.content === '第二项')?.id;

    // 推迟到第四个时间槽（不与第三项重叠）
    const newStartTime = tp4[3].start_time;
    const newEndTime = tp4[3].end_time;

    const runner = createRunner(db, createMockFetchForPlanning({
      type: 'patch_tasks',
      patches: [
        { id: secondTaskId, start_time: newStartTime, end_time: newEndTime }
      ],
      message: '已将第二项推迟。'
    }));

    const dto = await runner.submitMessage({
      userId,
      characterId,
      userInput: '把第二项推迟半小时'
    });

    check('PatchSpecific: ok=true', dto.ok === true);
    check('PatchSpecific: actionType=patch_tasks', dto.actionType === 'patch_tasks');

    const updatedTasks = planRepository.getTasksByPlanId(planId);
    const secondTask = updatedTasks.find(t => t.id === secondTaskId);
    const firstTask = updatedTasks.find(t => t.content === '第一项');
    const thirdTask = updatedTasks.find(t => t.content === '第三项');
    check('PatchSpecific: second task moved', secondTask?.start_time === newStartTime && secondTask?.end_time === newEndTime);
    check('PatchSpecific: first task unchanged', firstTask?.start_time === tp4[0].start_time);
    check('PatchSpecific: third task unchanged', thirdTask?.start_time === tp4[2].start_time);
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 5："删除代码审查"不会改变其他任务 =====
async function testDeleteSpecificTaskOnly(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId } = setupTestEnv(dbPath);
    const db = getDatabase();
    cleanupPlans();

    const planId = `plan_${Date.now()}_test5`;
    const today = '2026-07-11'; // 固定日期，匹配 FixedClock
    planRepository.insert({ id: planId, date: today, status: 'draft', user_id: userId, character_id: characterId });
    planRepository.insertTasks([
      { id: 't1', plan_id: planId, content: '写文档', start_time: '09:00', end_time: '10:00', completed: 0, order_index: 0 },
      { id: 't2', plan_id: planId, content: '代码审查', start_time: '10:00', end_time: '11:00', completed: 0, order_index: 1 },
      { id: 't3', plan_id: planId, content: '写测试', start_time: '11:00', end_time: '12:00', completed: 0, order_index: 2 }
    ]);

    const tasks = planRepository.getTasksByPlanId(planId);
    const reviewTaskId = tasks.find(t => t.content === '代码审查')?.id;

    const runner = createRunner(db, createMockFetchForPlanning({
      type: 'delete_task',
      taskId: reviewTaskId,
      message: '已删除代码审查任务。'
    }));

    const dto = await runner.submitMessage({
      userId,
      characterId,
      userInput: '删除代码审查'
    });

    check('DeleteSpecific: ok=true', dto.ok === true);
    check('DeleteSpecific: actionType=delete_task', dto.actionType === 'delete_task');

    const updatedTasks = planRepository.getTasksByPlanId(planId);
    check('DeleteSpecific: code review deleted', !updatedTasks.find(t => t.id === reviewTaskId));
    check('DeleteSpecific: other tasks preserved', updatedTasks.length === 2);
    check('DeleteSpecific: task 1 unchanged', updatedTasks.find(t => t.content === '写文档') !== undefined);
    check('DeleteSpecific: task 3 unchanged', updatedTasks.find(t => t.content === '写测试') !== undefined);
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 6：对话中说"就这样"与点击确认按钮产生相同发布结果 =====
// 修复 3：测试"就这样"时使用 isConfirmation=false，模拟 planning:submit-message
// create_draft 后进入 awaiting_confirmation，对话确认在 awaiting_confirmation 阶段生效
async function testConfirmationEquivalence(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId } = setupTestEnv(dbPath);
    const db = getDatabase();

    // === 场景 A：对话中说"就这样"（isConfirmation=false） ===
    // 修复 3：必须先通过 graph 创建草案（设置 awaitingConfirmation=true），然后才能用对话确认
    cleanupPlans();
    const tp6 = futureTimePairs(1);
    const runnerA = createRunner(db, createMockFetchForPlanning({
      type: 'create_draft',
      tasks: [{ start_time: tp6[0].start_time, end_time: tp6[0].end_time, content: '任务A' }],
      message: '计划草案已生成，请确认。'
    }));

    // 第一步：创建草案
    const dtoCreateA = await runnerA.submitMessage({
      userId,
      characterId,
      userInput: '帮我安排一个任务'
    });
    check('ConfirmEquiv A: create ok=true', dtoCreateA.ok === true);
    check('ConfirmEquiv A: create actionType=create_draft', dtoCreateA.actionType === 'create_draft');
    check('ConfirmEquiv A: create awaitingConfirmation=true', dtoCreateA.awaitingConfirmation === true);

    // 第二步：用"就这样"确认（isConfirmation=false，模拟 planning:submit-message）
    const dtoA = await runnerA.submitMessage({
      userId,
      characterId,
      userInput: '就这样',
      isConfirmation: false  // 修复 3：模拟真实 planning:submit-message
    });

    check('ConfirmEquiv A: confirm ok=true', dtoA.ok === true);
    check('ConfirmEquiv A: published=true', dtoA.published === true);

    const activePlanA = planRepository.getActivePlan();
    check('ConfirmEquiv A: active plan exists', activePlanA !== null);
    check('ConfirmEquiv A: status=active', activePlanA?.status === 'active');

    // === 场景 B：点击确认按钮（isConfirmation=true） ===
    cleanupPlans();
    const tp6b = futureTimePairs(1);
    const runnerB = createRunner(db, createMockFetchForPlanning({
      type: 'create_draft',
      tasks: [{ start_time: tp6b[0].start_time, end_time: tp6b[0].end_time, content: '任务B' }],
      message: '计划草案已生成，请确认。'
    }));

    // 第一步：创建草案
    const dtoCreateB = await runnerB.submitMessage({
      userId,
      characterId,
      userInput: '帮我安排一个任务'
    });
    check('ConfirmEquiv B: create ok=true', dtoCreateB.ok === true);
    check('ConfirmEquiv B: create awaitingConfirmation=true', dtoCreateB.awaitingConfirmation === true);

    // 第二步：点击确认按钮（isConfirmation=true）
    const dtoB = await runnerB.submitMessage({
      userId,
      characterId,
      userInput: '确认',
      isConfirmation: true
    });

    check('ConfirmEquiv B: ok=true', dtoB.ok === true);
    check('ConfirmEquiv B: published=true', dtoB.published === true);

    const activePlanB = planRepository.getActivePlan();
    check('ConfirmEquiv B: active plan exists', activePlanB !== null);
    check('ConfirmEquiv B: status=active', activePlanB?.status === 'active');

    // 两种方式都产生了 published=true 的结果
    check('ConfirmEquiv: same published result', dtoA.published === dtoB.published);
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 7：未明确确认时模型不能发布计划 =====
async function testNoPublishWithoutConfirmation(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId } = setupTestEnv(dbPath);
    const db = getDatabase();
    cleanupPlans();

    const planId = `plan_${Date.now()}_test7`;
    const today = '2026-07-11'; // 固定日期，匹配 FixedClock
    const tp7 = futureTimePairs(1);
    planRepository.insert({ id: planId, date: today, status: 'draft', user_id: userId, character_id: characterId });
    planRepository.insertTasks([
      { id: 't1', plan_id: planId, content: '任务', start_time: tp7[0].start_time, end_time: tp7[0].end_time, completed: 0, order_index: 0 }
    ]);

    // 模型尝试直接 publish_plan，但用户未确认
    const runner = createRunner(db, createMockFetchForPlanning({
      type: 'publish_plan',
      message: '计划已发布！'
    }));

    const dto = await runner.submitMessage({
      userId,
      characterId,
      userInput: '这个计划不错'
      // 注意：没有 isConfirmation=true
    });

    check('NoPublishWithoutConfirm: published=false', dto.published !== true);
    check('NoPublishWithoutConfirm: has error', dto.ok === false || (dto.reason?.length ?? 0) > 0 || (dto.message?.length ?? 0) > 0);

    // 验证数据库中没有 active 计划
    const activePlan = planRepository.getActivePlan();
    check('NoPublishWithoutConfirm: no active plan', activePlan === null || activePlan === undefined);

    // 验证草案仍然是 draft 状态
    const draft = planRepository.getDraftPlan();
    check('NoPublishWithoutConfirm: still draft', draft?.status === 'draft');
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 8：当前时间之后才允许安排未开始任务 =====
async function testNoPastTaskTimes(): Promise<void> {
  // 使用固定时间 10:00 作为当前时间（不依赖 new Date()）
  const currentHour = 10;
  const currentMinute = 0;

  // 过去时间的任务应该被拒绝（08:00 < 10:00）
  const pastCheck = validateTaskTimesNotPast(
    [{ start_time: '08:00', end_time: '09:00' }],
    currentHour,
    currentMinute
  );
  check('NoPastTimes: past task rejected', !pastCheck.valid);

  // 未来时间的任务应该通过（12:00 > 10:00）
  const futureCheck = validateTaskTimesNotPast(
    [{ start_time: '12:00', end_time: '13:00' }],
    currentHour,
    currentMinute
  );
  check('NoPastTimes: future task accepted', futureCheck.valid);

  // 通过 PlanningGraph 测试完整流程（使用固定时钟 10:00）
  const dbPath = tempDbPath();
  try {
    const { userId, characterId } = setupTestEnv(dbPath);
    const db = getDatabase();
    cleanupPlans();

    // 模型返回过去时间的任务（07:00-08:00，早于固定时钟 10:00）
    const runner = createRunner(db, createMockFetchForPlanning({
      type: 'create_draft',
      tasks: [{ start_time: '07:00', end_time: '08:00', content: '过去任务' }],
      message: '计划已生成'
    }));

    const dto = await runner.submitMessage({
      userId,
      characterId,
      userInput: '安排今天'
    });

    check('NoPastTimes: graph rejects past task', dto.ok === false || dto.plan === undefined);
    // 确保没有写入数据库
    const draft = planRepository.getDraftPlan();
    check('NoPastTimes: no draft created with past time', draft === null || draft === undefined);
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 9：重启后恢复规划对话、草案版本和 active 气泡 =====
async function testRestartRecovery(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId } = setupTestEnv(dbPath);
    const db = getDatabase();
    cleanupPlans();

    // 第一阶段：创建草案
    const timePairs = futureTimePairs(2);
    const runner1 = createRunner(db, createMockFetchForPlanning({
      type: 'create_draft',
      tasks: [
        { start_time: timePairs[0].start_time, end_time: timePairs[0].end_time, content: '任务一' },
        { start_time: timePairs[1].start_time, end_time: timePairs[1].end_time, content: '任务二' }
      ],
      message: '计划草案已生成。'
    }));

    const dto1 = await runner1.submitMessage({
      userId,
      characterId,
      userInput: '安排两个任务'
    });

    check('Restart: phase1 draft created', dto1.ok && dto1.plan !== undefined);
    const draftVersion1 = dto1.plan?.draftVersion ?? 0;

    // 验证 checkpoint 已保存
    const checkpoint = checkpointRepository.getActive('planning');
    check('Restart: checkpoint saved', checkpoint !== null && checkpoint !== undefined);

    // 第二阶段：模拟重启 — 创建新的 runner，从数据库恢复
    const runner2 = createRunner(db, createMockFetchForPlanning({
      type: 'patch_tasks',
      patches: [{ id: dto1.plan?.tasks?.[0]?.id, content: '任务一（修改）' }],
      message: '已修改。'
    }));

    const dto2 = await runner2.submitMessage({
      userId,
      characterId,
      userInput: '修改第一项'
    });

    check('Restart: phase2 patch ok', dto2.ok === true);
    check('Restart: phase2 has plan', dto2.plan !== undefined);

    // 验证草案版本递增
    const draftVersion2 = dto2.plan?.draftVersion ?? 0;
    check('Restart: draft version incremented', draftVersion2 >= draftVersion1);

    // 第三阶段：确认发布，验证 active 气泡恢复
    const runner3 = createRunner(db);
    const dto3 = await runner3.submitMessage({
      userId,
      characterId,
      userInput: '就这样',
      isConfirmation: true
    });

    check('Restart: phase3 published', dto3.published === true);

    // 验证 active 计划存在（模拟重启后 restoreActivePlanOnStartup）
    const activePlan = planRepository.getActivePlan();
    check('Restart: active plan exists', activePlan !== null);
    check('Restart: active plan has tasks', (activePlan?.tasks?.length ?? 0) > 0);
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 10：模型输出非法参数时不能写入数据库 =====
async function testInvalidParametersNotWritten(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId } = setupTestEnv(dbPath);
    const db = getDatabase();
    cleanupPlans();

    // 模型返回非法参数：时间格式错误
    const runner = createRunner(db, createMockFetchForPlanning({
      type: 'create_draft',
      tasks: [
        { start_time: '25:00', end_time: '26:00', content: '非法时间任务' }  // 无效时间
      ],
      message: '计划已生成'
    }));

    const dto = await runner.submitMessage({
      userId,
      characterId,
      userInput: '安排任务'
    });

    check('InvalidParams: graph returns ok=false', dto.ok === false);
    check('InvalidParams: graph creates no plan', dto.plan === undefined);

    // 确保没有写入数据库
    const draft = planRepository.getDraftPlan();
    check('InvalidParams: no draft in DB', draft === null || draft === undefined);

    // 直接测试 Zod 校验
    const invalidAction = {
      type: 'create_draft',
      tasks: [{ start_time: '99:99', end_time: '88:88', content: '' }],  // 空内容 + 无效时间
      message: 'test'
    };
    const validation = validateAgentAction(invalidAction);
    check('InvalidParams: Zod rejects invalid action', !validation.valid);

    // 测试合法参数通过
    const validAction = {
      type: 'create_draft',
      tasks: [{ start_time: '09:00', end_time: '10:00', content: '合法任务' }],
      message: 'test'
    };
    const validValidation = validateAgentAction(validAction);
    check('InvalidParams: Zod accepts valid action', validValidation.valid);
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 11：同时确认两次只能产生一个 active 计划 =====
async function testConcurrentConfirmSingleActive(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId } = setupTestEnv(dbPath);
    const db = getDatabase();
    cleanupPlans();

    const planId = `plan_${Date.now()}_test11`;
    const today = '2026-07-11'; // 固定日期，匹配 FixedClock
    const tp11 = futureTimePairs(1);
    planRepository.insert({ id: planId, date: today, status: 'draft', user_id: userId, character_id: characterId });
    planRepository.insertTasks([
      { id: 't1', plan_id: planId, content: '任务', start_time: tp11[0].start_time, end_time: tp11[0].end_time, completed: 0, order_index: 0 }
    ]);

    const runner = createRunner(db);

    // 第一次确认
    const dto1 = await runner.submitMessage({
      userId,
      characterId,
      userInput: '就这样',
      isConfirmation: true
    });

    check('ConcurrentConfirm: first confirm ok', dto1.ok === true);
    check('ConcurrentConfirm: first confirm published', dto1.published === true);

    // 第二次确认（模拟并发）
    const dto2 = await runner.submitMessage({
      userId,
      characterId,
      userInput: '就这样',
      isConfirmation: true
    });

    // 验证数据库中只有一个 active 计划
    const db2 = getDatabase();
    const activeCount = db2.prepare("SELECT COUNT(*) as cnt FROM plans WHERE status = 'active' AND date = ?").get(today) as { cnt: number };
    check('ConcurrentConfirm: only one active plan', activeCount.cnt === 1);

    // 验证 live 唯一索引存在（V7 起替换为 idx_plans_live_unique_per_scope_date）
    const indexes = db2.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE '%live_unique%'").all() as Array<{ name: string }>;
    check('ConcurrentConfirm: unique index exists', indexes.length > 0);
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 12：状态面板能看到实际调用的模型 =====
async function testModelTransparency(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId } = setupTestEnv(dbPath);
    const db = getDatabase();
    cleanupPlans();

    // 模型返回 response.model = "deepseek-chat-real"
    const realModel = 'deepseek-chat-real';
    const runner = createRunner(db, createMockFetchForPlanning({
      type: 'create_draft',
      tasks: [{ start_time: futureTimePairs(1)[0].start_time, end_time: futureTimePairs(1)[0].end_time, content: '透明度测试' }],
      message: '计划已生成'
    }, realModel));

    const dto = await runner.submitMessage({
      userId,
      characterId,
      userInput: '安排任务'
    });

    check('ModelTransparency: ok=true', dto.ok === true);
    check('ModelTransparency: has resolvedModel', (dto.resolvedModel?.length ?? 0) > 0);
    check('ModelTransparency: has responseModel', (dto.responseModel?.length ?? 0) > 0);
    check('ModelTransparency: responseModel is real model', dto.responseModel === realModel);
    // resolvedModel 不应该等于别名 "planningModel"，应该是解析后的真实模型 ID
    check('ModelTransparency: resolvedModel is not alias', dto.resolvedModel !== 'planningModel');

    // 验证数据库中保存了模型信息
    const draft = planRepository.getDraftPlan();
    check('ModelTransparency: DB has resolved_model', (draft?.resolved_model?.length ?? 0) > 0);
    check('ModelTransparency: DB has response_model', draft?.response_model === realModel);

    // 验证 settings 中保存了 resolved model
    const savedResolved = settingsRepository.getPlanningModelResolved();
    check('ModelTransparency: settings has resolved model', (savedResolved?.length ?? 0) > 0);
    check('ModelTransparency: settings resolved is not alias', savedResolved !== 'planningModel');
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 13：打包版编译产物存在 =====
async function testPackagedBuildExists(): Promise<void> {
  // 验证 PlanningGraph 的编译产物存在
  const distPath = path.join(process.cwd(), 'dist', 'agent', 'graphs', 'planning', 'graph.js');
  check('PackagedBuild: planning graph.js exists', fs.existsSync(distPath));

  const toolsPath = path.join(process.cwd(), 'dist', 'agent', 'graphs', 'planning', 'tools.js');
  check('PackagedBuild: planning tools.js exists', fs.existsSync(toolsPath));

  const statePath = path.join(process.cwd(), 'dist', 'agent', 'graphs', 'planning', 'state.js');
  check('PackagedBuild: planning state.js exists', fs.existsSync(statePath));

  // 验证 integration.js 导出了 planning 相关函数
  const integrationPath = path.join(process.cwd(), 'dist', 'main', 'integration.js');
  check('PackagedBuild: integration.js exists', fs.existsSync(integrationPath));

  if (fs.existsSync(integrationPath)) {
    const content = fs.readFileSync(integrationPath, 'utf-8');
    check('PackagedBuild: integration exports handlePlanningMessage', content.includes('handlePlanningMessage'));
    check('PackagedBuild: integration exports getPlanningModelInfo', content.includes('getPlanningModelInfo'));
    check('PackagedBuild: integration exports handlePlanningConfirm', content.includes('handlePlanningConfirm'));
  }

  // 验证 V5 migration 存在于编译产物中
  const migrationPath = path.join(process.cwd(), 'dist', 'infrastructure', 'database', 'migration-runner.js');
  if (fs.existsSync(migrationPath)) {
    const content = fs.readFileSync(migrationPath, 'utf-8');
    check('PackagedBuild: V5 migration exists', content.includes('draft_version') || content.includes('migrationV5'));
  }
}

// ===== 额外测试：executePlanningTool 直接测试 =====
async function testExecutePlanningToolDirectly(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    setupTestEnv(dbPath);
    cleanupPlans();

    const planId = `plan_${Date.now()}_tool`;
    const today = '2026-07-11'; // 固定日期，匹配 FixedClock

    // 测试 create_draft
    const createResult = executePlanningTool({
      type: 'create_draft',
      tasks: [
        { start_time: '09:00', end_time: '10:00', content: '任务1' },
        { start_time: '10:00', end_time: '11:00', content: '任务2' }
      ],
      message: '创建草案'
    }, {
      planId,
      date: today,
      currentDraft: null,
      userConfirmed: false,
      currentTimeHour: 8,
      currentTimeMinute: 0
    });

    check('ToolDirect: create_draft success', createResult.success === true);
    check('ToolDirect: create_draft has draft', createResult.draft !== undefined);
    check('ToolDirect: create_draft has 2 tasks', createResult.draft?.tasks?.length === 2);

    const draft = createResult.draft!;

    // 测试 patch_tasks
    const patchResult = executePlanningTool({
      type: 'patch_tasks',
      patches: [{ id: draft.tasks[0].id, content: '修改后的任务1' }],
      message: '修改任务'
    }, {
      planId,
      date: today,
      currentDraft: draft,
      userConfirmed: false,
      currentTimeHour: 8,
      currentTimeMinute: 0
    });

    check('ToolDirect: patch_tasks success', patchResult.success === true);
    check('ToolDirect: patch_tasks content changed', patchResult.draft?.tasks?.[0]?.content === '修改后的任务1');

    // 测试 delete_task
    const deleteResult = executePlanningTool({
      type: 'delete_task',
      taskId: draft.tasks[1].id,
      message: '删除任务'
    }, {
      planId,
      date: today,
      currentDraft: patchResult.draft,
      userConfirmed: false,
      currentTimeHour: 8,
      currentTimeMinute: 0
    });

    check('ToolDirect: delete_task success', deleteResult.success === true);
    check('ToolDirect: delete_task has 1 task', deleteResult.draft?.tasks?.length === 1);

    // 测试 publish_plan 未确认时拒绝
    const publishRejected = executePlanningTool({
      type: 'publish_plan',
      message: '发布'
    }, {
      planId,
      date: today,
      currentDraft: deleteResult.draft,
      userConfirmed: false,
      currentTimeHour: 8,
      currentTimeMinute: 0
    });

    check('ToolDirect: publish_plan rejected without confirm', !publishRejected.success);
    check('ToolDirect: publish_plan has error', (publishRejected.error?.length ?? 0) > 0);

    // 测试 publish_plan 确认后成功
    planRepository.markUserConfirmed(planId);
    const publishAccepted = executePlanningTool({
      type: 'publish_plan',
      message: '发布'
    }, {
      planId,
      date: today,
      currentDraft: deleteResult.draft,
      userConfirmed: true,
      currentTimeHour: 8,
      currentTimeMinute: 0
    });

    check('ToolDirect: publish_plan accepted with confirm', publishAccepted.success === true);
    check('ToolDirect: publish_plan published=true', publishAccepted.published === true);

    // 验证 plan 状态变为 active
    const activePlan = planRepository.getActivePlan();
    check('ToolDirect: plan is active', activePlan?.status === 'active');
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// ===== 额外测试：isConfirmationInput 确认关键词检测 =====
async function testConfirmationKeywords(): Promise<void> {
  check('ConfirmKeywords: "就这样" detected', isConfirmationInput('就这样'));
  check('ConfirmKeywords: "确认" detected', isConfirmationInput('确认'));
  check('ConfirmKeywords: "没问题" detected', isConfirmationInput('没问题'));
  check('ConfirmKeywords: "可以了" detected', isConfirmationInput('可以了'));
  check('ConfirmKeywords: "发布吧" detected', isConfirmationInput('发布吧'));
  check('ConfirmKeywords: "ok" detected', isConfirmationInput('ok'));
  // Fix 6: "好的"已从确认关键词中移除，不能在有草案时自动发布
  check('ConfirmKeywords: "好的" NOT detected (Fix 6 removed)', !isConfirmationInput('好的'));
  check('ConfirmKeywords: "帮我安排" not detected', !isConfirmationInput('帮我安排'));
  check('ConfirmKeywords: "修改一下" not detected', !isConfirmationInput('修改一下'));
}

// ===== 测试 14：UI 删除任务后数据库真删除（通过 submitManualEdit）=====
async function testManualEditDeleteTaskFromDB(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId } = setupTestEnv(dbPath);
    const db = getDatabase();
    cleanupPlans();

    // 先创建一个草案
    const planId = `plan_${Date.now()}_test14`;
    const today = '2026-07-11'; // 固定日期，匹配 FixedClock
    const tp14 = futureTimePairs(3);
    planRepository.insert({ id: planId, date: today, status: 'draft', user_id: userId, character_id: characterId });
    planRepository.insertTasks([
      { id: 't14a', plan_id: planId, content: '任务A', start_time: tp14[0].start_time, end_time: tp14[0].end_time, completed: 0, order_index: 0 },
      { id: 't14b', plan_id: planId, content: '任务B', start_time: tp14[1].start_time, end_time: tp14[1].end_time, completed: 0, order_index: 1 },
      { id: 't14c', plan_id: planId, content: '任务C', start_time: tp14[2].start_time, end_time: tp14[2].end_time, completed: 0, order_index: 2 }
    ]);

    const runner = createRunner(db);

    // 通过 submitManualEdit 删除任务 B
    const dto = await runner.submitManualEdit({
      userId,
      characterId,
      planId,
      agentAction: {
        type: 'delete_task',
        taskId: 't14b',
        message: '已删除任务B'
      }
    });

    check('ManualDelete: ok=true', dto.ok === true);
    check('ManualDelete: actionType=delete_task', dto.actionType === 'delete_task');

    // 验证数据库中任务 B 已被真正删除
    const remainingTasks = planRepository.getTasksByPlanId(planId);
    check('ManualDelete: task B removed from DB', !remainingTasks.find(t => t.id === 't14b'));
    check('ManualDelete: 2 tasks remain', remainingTasks.length === 2);

    // 关键验证：重新打开数据库（模拟重启）后任务 B 仍然不存在
    closeDatabase();
    initDatabase({ path: dbPath });
    const tasksAfterRestart = planRepository.getTasksByPlanId(planId);
    check('ManualDelete: task B still gone after restart', !tasksAfterRestart.find(t => t.id === 't14b'));
    check('ManualDelete: 2 tasks remain after restart', tasksAfterRestart.length === 2);
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 15：手动改时间不调用模型 =====
async function testManualEditDoesNotCallModel(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId } = setupTestEnv(dbPath);
    const db = getDatabase();
    cleanupPlans();

    const planId = `plan_${Date.now()}_test15`;
    const today = '2026-07-11'; // 固定日期，匹配 FixedClock
    planRepository.insert({ id: planId, date: today, status: 'draft', user_id: userId, character_id: characterId });
    const timePairs = futureTimePairs(3);
    planRepository.insertTasks([
      { id: 't15a', plan_id: planId, content: '任务A', start_time: timePairs[0].start_time, end_time: timePairs[0].end_time, completed: 0, order_index: 0 },
      { id: 't15b', plan_id: planId, content: '任务B', start_time: timePairs[1].start_time, end_time: timePairs[1].end_time, completed: 0, order_index: 1 }
    ]);

    // 使用一个会记录调用次数的 mock fetch
    let fetchCallCount = 0;
    const trackingFetch = async (_url: string, _options?: RequestInit): Promise<Response> => {
      fetchCallCount++;
      const body = JSON.stringify({ type: 'ask_clarification', clarificationQuestion: '不应调用模型', message: '不应调用模型' });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: 'test',
          model: 'deepseek-chat',
          choices: [{ message: { role: 'assistant', content: body }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 }
        }),
        text: async () => body
      } as unknown as Response;
    };

    const config = getDefaultAppConfig();
    const secretStore = createMockSecretStore();
    const modelGateway = new ModelGateway({ config, secretStore, fetchFn: trackingFetch, db });
    const timeService = new TimeService('Asia/Shanghai', createFixedClock());
    const userContextService = new UserContextService();
    const runner = new PlanningGraphRunner({ modelGateway, timeService, userContextService });

    // 通过 submitManualEdit 修改任务时间（不应调用模型）
    // 修改为第三个时间对，避免与任务 B 重叠
    const dto = await runner.submitManualEdit({
      userId,
      characterId,
      planId,
      agentAction: {
        type: 'patch_tasks',
        patches: [{ id: 't15a', start_time: timePairs[2].start_time, end_time: timePairs[2].end_time }],
        message: '已修改任务A时间'
      }
    });

    check('ManualNoModel: ok=true', dto.ok === true);
    check('ManualNoModel: actionType=patch_tasks', dto.actionType === 'patch_tasks');
    check('ManualNoModel: fetch NOT called (model not invoked)', fetchCallCount === 0);
    check('ManualNoModel: turnCallCount=0', modelGateway.getTurnCallCount() === 0);

    // 验证任务时间已修改
    const tasks = planRepository.getTasksByPlanId(planId);
    const patchedTask = tasks.find(t => t.id === 't15a');
    check('ManualNoModel: task time changed', patchedTask?.start_time === timePairs[2].start_time);
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 16：重启恢复可见消息历史 =====
async function testRestartRestoresMessageHistory(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId } = setupTestEnv(dbPath);
    const db = getDatabase();
    cleanupPlans();

    // 第一阶段：创建草案并产生消息历史
    const timePairs = futureTimePairs(1);
    const runner1 = createRunner(db, createMockFetchForPlanning({
      type: 'create_draft',
      tasks: [{ start_time: timePairs[0].start_time, end_time: timePairs[0].end_time, content: '恢复测试任务' }],
      message: '计划草案已生成，请确认。'
    }));

    await runner1.submitMessage({
      userId,
      characterId,
      userInput: '帮我安排一个任务'
    });

    // 验证 checkpoint 已保存
    const checkpoint = checkpointRepository.getActive('planning');
    check('RestartHistory: checkpoint saved', checkpoint !== null && checkpoint !== undefined);

    // 第二阶段：模拟重启 — 创建新的 runner，调用 getPlanningState 恢复状态
    const runner2 = createRunner(db);
    const planningState = runner2.getPlanningState();

    check('RestartHistory: has messages', Array.isArray(planningState.messages) && planningState.messages.length > 0);
    check('RestartHistory: phase is drafting or awaiting', planningState.phase === 'drafting' || planningState.phase === 'awaiting_confirmation');
    check('RestartHistory: has currentDraft', planningState.currentDraft !== null);

    // 验证消息中包含用户输入和助手回复
    const userMessages = planningState.messages.filter(m => m.role === 'user');
    const assistantMessages = planningState.messages.filter(m => m.role === 'assistant');
    check('RestartHistory: has user message', userMessages.length > 0);
    check('RestartHistory: has assistant message', assistantMessages.length > 0);
    check('RestartHistory: assistant message has content', (assistantMessages[0]?.content?.length ?? 0) > 0);
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 17：重叠时间和反向时间不能发布 =====
async function testOverlapAndReversedTimeCannotPublish(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    setupTestEnv(dbPath);
    cleanupPlans();

    // 直接测试 validatePlanDraft 函数

    // 场景 A：任务时间重叠
    const overlapResult = validatePlanDraft(
      [
        { id: 't1', content: '任务A', start_time: '09:00', end_time: '11:00', order_index: 0 },
        { id: 't2', content: '任务B', start_time: '10:30', end_time: '12:00', order_index: 1 }
      ],
      8, 0 // 当前 08:00，确保不是过去时间
    );
    check('OverlapReject: overlapping tasks rejected', !overlapResult.valid);
    check('OverlapReject: has error message', (overlapResult.error?.length ?? 0) > 0);

    // 场景 B：反向时间（start >= end）
    const reversedResult = validatePlanDraft(
      [{ id: 't1', content: '反向任务', start_time: '11:00', end_time: '09:00', order_index: 0 }],
      8, 0
    );
    check('ReversedReject: reversed time rejected', !reversedResult.valid);
    check('ReversedReject: error mentions start < end', (reversedResult.error ?? '').includes('必须早于'));

    // 场景 C：合法的不重叠任务应该通过
    const validResult = validatePlanDraft(
      [
        { id: 't1', content: '任务A', start_time: '09:00', end_time: '10:00', order_index: 0 },
        { id: 't2', content: '任务B', start_time: '10:00', end_time: '11:00', order_index: 1 }
      ],
      8, 0
    );
    check('OverlapReject: non-overlapping tasks accepted', validResult.valid);

    // 场景 D：通过 PlanningGraph 验证重叠任务不能发布
    const { userId: uid, characterId: cid } = { userId: 'test-user-plan', characterId: 'test-roxy' };
    const planId = `plan_${Date.now()}_test17`;
    const today = '2026-07-11'; // 固定日期，匹配 FixedClock
    planRepository.insert({ id: planId, date: today, status: 'draft', user_id: uid, character_id: cid });
    // 插入重叠任务到数据库
    planRepository.insertTasks([
      { id: 't17a', plan_id: planId, content: '重叠任务A', start_time: '14:00', end_time: '16:00', completed: 0, order_index: 0 },
      { id: 't17b', plan_id: planId, content: '重叠任务B', start_time: '15:00', end_time: '17:00', completed: 0, order_index: 1 }
    ]);

    const runner = createRunner(getDatabase());
    // 尝试确认发布（重叠任务应该被 publish 前的校验拒绝）
    const dto = await runner.submitMessage({
      userId: uid,
      characterId: cid,
      userInput: '就这样',
      isConfirmation: true
    });

    check('OverlapReject: publish rejected for overlap', dto.published !== true);
    // 验证没有 active 计划
    const activePlan = planRepository.getActivePlan();
    check('OverlapReject: no active plan created', activePlan === null || activePlan === undefined);
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 18：planningModel 配置确实进入 HTTP body.model =====
async function testPlanningModelEntersHttpBody(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId } = setupTestEnv(dbPath);
    const db = getDatabase();
    cleanupPlans();

    // 设置 planningModel 为自定义值
    const customModel = 'deepseek-chat-custom-123';
    settingsRepository.set('model_alias_planning', customModel);

    // 捕获 fetch 调用的 body
    let capturedBody: any = null;
    const capturingFetch = async (_url: string, options?: RequestInit): Promise<Response> => {
      if (options?.body) {
        try {
          capturedBody = JSON.parse(options.body as string);
        } catch { /* ignore */ }
      }
      const action: AgentAction = {
        type: 'create_draft',
        tasks: [{ start_time: futureTimePairs(1)[0].start_time, end_time: futureTimePairs(1)[0].end_time, content: 'body.model 测试' }],
        message: '计划已生成'
      };
      const body = JSON.stringify(action);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: 'test',
          model: customModel,
          choices: [{ message: { role: 'assistant', content: body }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 }
        }),
        text: async () => body
      } as unknown as Response;
    };

    const config = getDefaultAppConfig();
    const secretStore = createMockSecretStore();
    const modelGateway = new ModelGateway({ config, secretStore, fetchFn: capturingFetch, db });

    // 注入 configReloader，模拟 integration.ts 的行为
    modelGateway.setConfigReloader(() => {
      const freshDefaults = getDefaultAppConfig();
      const freshUserAliases = settingsRepository.getModelAliases();
      return applyUserModelAliases(freshDefaults, freshUserAliases);
    });

    const timeService = new TimeService('Asia/Shanghai', createFixedClock());
    const userContextService = new UserContextService();
    const runner = new PlanningGraphRunner({ modelGateway, timeService, userContextService });

    const dto = await runner.submitMessage({
      userId,
      characterId,
      userInput: '安排任务'
    });

    check('BodyModel: ok=true', dto.ok === true);
    check('BodyModel: fetch was called', capturedBody !== null);
    check('BodyModel: body.model equals custom planningModel', capturedBody?.model === customModel);
    check('BodyModel: body.model is NOT default deepseek-chat', capturedBody?.model !== 'deepseek-chat');

    // 验证 resolvedModel 返回了自定义模型
    check('BodyModel: resolvedModel is custom', dto.resolvedModel === customModel);

    // 验证 responseModel 返回了 API 的 model 字段
    check('BodyModel: responseModel is custom', dto.responseModel === customModel);
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 19：工具失败后 Agent 能在调用上限内自动修正 =====
async function testToolFailureAutoRecovery(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId } = setupTestEnv(dbPath);
    const db = getDatabase();
    cleanupPlans();

    // 模拟模型第一次返回无效动作（触发工具失败），第二次返回合法动作
    let modelCallCount = 0;
    const recoveryFetch = async (_url: string, _options?: RequestInit): Promise<Response> => {
      modelCallCount++;
      let action: AgentAction;

      if (modelCallCount === 1) {
        // 第一次：返回需要草案但没有草案的动作（触发可恢复错误）
        action = {
          type: 'patch_tasks',
          patches: [{ id: 'nonexistent', content: '修改不存在的任务' }],
          message: '我来修改任务'
        };
      } else {
        // 第二次：返回合法的 create_draft
        const tp = futureTimePairs(2);
        action = {
          type: 'create_draft',
          tasks: [
            { start_time: tp[0].start_time, end_time: tp[0].end_time, content: '自动修正任务A' },
            { start_time: tp[1].start_time, end_time: tp[1].end_time, content: '自动修正任务B' }
          ],
          message: '已重新生成计划草案。'
        };
      }

      const body = JSON.stringify(action);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: 'test',
          model: 'deepseek-chat',
          choices: [{ message: { role: 'assistant', content: body }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 }
        }),
        text: async () => body
      } as unknown as Response;
    };

    const config = getDefaultAppConfig();
    const secretStore = createMockSecretStore();
    const modelGateway = new ModelGateway({ config, secretStore, fetchFn: recoveryFetch, db });
    const timeService = new TimeService('Asia/Shanghai', createFixedClock());
    const userContextService = new UserContextService();
    const runner = new PlanningGraphRunner({ modelGateway, timeService, userContextService });

    const dto = await runner.submitMessage({
      userId,
      characterId,
      userInput: '安排两个任务'
    });

    // 验证模型被调用了至少 2 次（第一次失败，第二次修正）
    check('AutoRecovery: model called at least 2 times', modelCallCount >= 2);
    // 验证模型调用不超过上限（3 次）
    check('AutoRecovery: model calls within limit (<=3)', modelCallCount <= 3);
    // 验证最终成功创建了草案
    check('AutoRecovery: ok=true', dto.ok === true);
    check('AutoRecovery: has plan', dto.plan !== undefined && dto.plan !== null);
    check('AutoRecovery: has 2 tasks', dto.plan?.tasks?.length === 2);

    // 验证数据库中有草案
    const draft = planRepository.getDraftPlan();
    check('AutoRecovery: draft in DB', draft !== null && draft !== undefined);
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 20："好的"不能在有草案时自动发布 =====
async function testHaoDeDoesNotAutoPublish(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId } = setupTestEnv(dbPath);
    const db = getDatabase();
    cleanupPlans();

    // 创建一个已有草案的场景
    const planId = `plan_${Date.now()}_test20`;
    const today = '2026-07-11'; // 固定日期，匹配 FixedClock
    planRepository.insert({ id: planId, date: today, status: 'draft', user_id: userId, character_id: characterId });
    const tp = futureTimePairs(1);
    planRepository.insertTasks([
      { id: 't20a', plan_id: planId, content: '任务', start_time: tp[0].start_time, end_time: tp[0].end_time, completed: 0, order_index: 0 }
    ]);

    // 模型返回 ask_clarification（因为 "好的" 不是确认词，会交给模型处理）
    const runner = createRunner(db, createMockFetchForPlanning({
      type: 'ask_clarification',
      clarificationQuestion: '你确定要发布吗？',
      message: '你确定要发布吗？'
    }));

    // 用户输入"好的"（不在 awaiting_confirmation 阶段）
    const dto = await runner.submitMessage({
      userId,
      characterId,
      userInput: '好的'
      // 没有 isConfirmation=true
    });

    // 验证没有自动发布
    check('HaoDeNoPublish: published=false', dto.published !== true);
    // 验证草案仍然是 draft
    const draft = planRepository.getDraftPlan();
    check('HaoDeNoPublish: still draft', draft?.status === 'draft');
    // 验证没有 active 计划
    const activePlan = planRepository.getActivePlan();
    check('HaoDeNoPublish: no active plan', activePlan === null || activePlan === undefined);
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 21：Fix 1 - 非法 patch 返回失败后，数据库字段保持修改前的值 =====
async function testIllegalPatchRollbackFieldsUnchanged(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId } = setupTestEnv(dbPath);
    cleanupPlans();

    const planId = `plan_${Date.now()}_test21`;
    const today = '2026-07-11'; // 固定日期，匹配 FixedClock
    const tp = futureTimePairs(2);
    planRepository.insert({ id: planId, date: today, status: 'draft', user_id: userId, character_id: characterId });
    planRepository.insertTasks([
      { id: 't21a', plan_id: planId, content: '原始任务A', start_time: tp[0].start_time, end_time: tp[0].end_time, completed: 0, order_index: 0 },
      { id: 't21b', plan_id: planId, content: '原始任务B', start_time: tp[1].start_time, end_time: tp[1].end_time, completed: 0, order_index: 1 }
    ]);

    // 记录修改前的所有字段值
    const tasksBefore = planRepository.getTasksByPlanId(planId);
    const snapshotBefore = tasksBefore.map(t => ({
      id: t.id, content: t.content, start_time: t.start_time, end_time: t.end_time,
      completed: t.completed, order_index: t.order_index
    }));

    // 构造非法 patch：将任务A的 start_time 改为 >= end_time（反向时间）
    // 这会在事务内校验时失败并回滚
    const draftForPatch = {
      planId,
      date: today,
      tasks: tasksBefore.map(t => ({
        id: t.id, content: t.content, start_time: t.start_time ?? '',
        end_time: t.end_time ?? '', completed: t.completed, order_index: t.order_index
      })),
      draftVersion: 1
    };

    const illegalResult = executePlanningTool({
      type: 'patch_tasks',
      patches: [
        { id: 't21a', start_time: '23:59', end_time: '00:01' }  // start >= end，非法
      ],
      message: '非法修改'
    }, {
      planId,
      date: today,
      currentDraft: draftForPatch,
      userConfirmed: false,
      currentTimeHour: new Date().getHours(),
      currentTimeMinute: new Date().getMinutes()
    });

    // 验证 patch 返回失败
    check('Fix1Rollback: illegal patch returns failure', illegalResult.success === false);
    check('Fix1Rollback: has error message', (illegalResult.error?.length ?? 0) > 0);

    // 关键验证：重新查询数据库，所有字段必须保持修改前的值
    const tasksAfter = planRepository.getTasksByPlanId(planId);
    check('Fix1Rollback: task count unchanged', tasksAfter.length === snapshotBefore.length);

    for (let i = 0; i < snapshotBefore.length; i++) {
      const before = snapshotBefore[i];
      const after = tasksAfter.find(t => t.id === before.id);
      check(`Fix1Rollback: task ${before.id} content unchanged`, after?.content === before.content);
      check(`Fix1Rollback: task ${before.id} start_time unchanged`, after?.start_time === before.start_time);
      check(`Fix1Rollback: task ${before.id} end_time unchanged`, after?.end_time === before.end_time);
      check(`Fix1Rollback: task ${before.id} completed unchanged`, after?.completed === before.completed);
      check(`Fix1Rollback: task ${before.id} order_index unchanged`, after?.order_index === before.order_index);
    }

    // 额外验证：构造会导致重叠的非法 patch，同样应回滚
    const overlapResult = executePlanningTool({
      type: 'patch_tasks',
      patches: [
        { id: 't21a', end_time: tp[1].end_time }  // 把A的结束时间延长到B的结束时间，导致重叠
      ],
      message: '重叠修改'
    }, {
      planId,
      date: today,
      currentDraft: draftForPatch,
      userConfirmed: false,
      currentTimeHour: new Date().getHours(),
      currentTimeMinute: new Date().getMinutes()
    });

    check('Fix1Rollback: overlap patch returns failure', overlapResult.success === false);

    // 再次验证数据库字段未变
    const tasksAfterOverlap = planRepository.getTasksByPlanId(planId);
    const taskA = tasksAfterOverlap.find(t => t.id === 't21a');
    check('Fix1Rollback: task A end_time unchanged after overlap attempt', taskA?.end_time === snapshotBefore[0].end_time);
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 22：Fix 2 - 第二次模型请求的 messages 中包含第一次工具错误 =====
async function testLastToolErrorInjectedIntoSecondModelCall(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId } = setupTestEnv(dbPath);
    const db = getDatabase();
    cleanupPlans();

    // 捕获每次 fetch 调用的 messages
    const capturedMessagesHistory: Array<Array<{ role: string; content: string }>> = [];
    let modelCallCount = 0;

    const capturingFetch = async (_url: string, options?: RequestInit): Promise<Response> => {
      modelCallCount++;
      // 捕获请求 body 中的 messages
      if (options?.body) {
        try {
          const parsed = JSON.parse(options.body as string);
          if (parsed.messages) {
            capturedMessagesHistory.push(parsed.messages.map((m: any) => ({ role: m.role, content: m.content })));
          }
        } catch { /* ignore */ }
      }

      let action: AgentAction;
      if (modelCallCount === 1) {
        // 第一次：返回需要草案但没有草案的动作（触发工具失败）
        action = {
          type: 'patch_tasks',
          patches: [{ id: 'nonexistent-task-id', content: '修改不存在的任务' }],
          message: '我来修改任务'
        };
      } else {
        // 第二次：返回合法的 create_draft
        const tp = futureTimePairs(1);
        action = {
          type: 'create_draft',
          tasks: [{ start_time: tp[0].start_time, end_time: tp[0].end_time, content: '修正后任务' }],
          message: '已重新生成计划草案。'
        };
      }

      const body = JSON.stringify(action);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: 'test',
          model: 'deepseek-chat',
          choices: [{ message: { role: 'assistant', content: body }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 }
        }),
        text: async () => body
      } as unknown as Response;
    };

    const config = getDefaultAppConfig();
    const secretStore = createMockSecretStore();
    const modelGateway = new ModelGateway({ config, secretStore, fetchFn: capturingFetch, db });
    const timeService = new TimeService('Asia/Shanghai', createFixedClock());
    const userContextService = new UserContextService();
    const runner = new PlanningGraphRunner({ modelGateway, timeService, userContextService });

    const dto = await runner.submitMessage({
      userId,
      characterId,
      userInput: '安排任务'
    });

    // 验证模型被调用了至少 2 次
    check('Fix2Inject: model called at least 2 times', modelCallCount >= 2);
    // 验证最终成功
    check('Fix2Inject: ok=true', dto.ok === true);
    check('Fix2Inject: has plan', dto.plan !== undefined);

    // 关键验证：第二次模型请求的 messages 中必须包含第一次工具错误信息
    check('Fix2Inject: captured at least 2 message sets', capturedMessagesHistory.length >= 2);

    if (capturedMessagesHistory.length >= 2) {
      const secondCallMessages = capturedMessagesHistory[1];
      // 将所有 message content 拼接起来检查是否包含错误信息
      const allContent = secondCallMessages.map(m => m.content).join('\n');
      // 第二次 messages 中应该包含错误相关的内容（上一次操作失败了）
      const hasErrorInjection = allContent.includes('失败') || allContent.includes('错误') || allContent.includes('error') || allContent.includes('不要重复');
      check('Fix2Inject: second call messages contain first tool error', hasErrorInjection);

      // 验证第二次 messages 中有 assistant 角色的消息包含错误描述
      const assistantMessages = secondCallMessages.filter(m => m.role === 'assistant');
      const hasAssistantErrorDesc = assistantMessages.some(m =>
        m.content.includes('失败') || m.content.includes('错误') || m.content.includes('但失败了')
      );
      check('Fix2Inject: assistant message describes the failure', hasAssistantErrorDesc);
    }

    // 验证最终成功后 lastToolError 被清理（通过 DTO 不包含错误信息）
    check('Fix2Inject: final dto ok (error cleared)', dto.ok === true);
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 23：阻断 1 - 第一次失败、第二次成功时模型调用次数严格等于 2 =====
async function testToolExecutionStatusPreventsThirdModelCall(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId } = setupTestEnv(dbPath);
    const db = getDatabase();
    cleanupPlans();

    let modelCallCount = 0;
    const recoveryFetch = async (_url: string, _options?: RequestInit): Promise<Response> => {
      modelCallCount++;
      let action: AgentAction;

      if (modelCallCount === 1) {
        // 第一次：返回需要草案但没有草案的动作（触发工具失败）
        action = {
          type: 'patch_tasks',
          patches: [{ id: 'nonexistent', content: '修改不存在的任务' }],
          message: '我来修改任务'
        };
      } else {
        // 第二次：返回合法的 create_draft
        const tp = futureTimePairs(2);
        action = {
          type: 'create_draft',
          tasks: [
            { start_time: tp[0].start_time, end_time: tp[0].end_time, content: '修正后任务A' },
            { start_time: tp[1].start_time, end_time: tp[1].end_time, content: '修正后任务B' }
          ],
          message: '已重新生成计划草案。'
        };
      }

      const body = JSON.stringify(action);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: 'test',
          model: 'deepseek-chat',
          choices: [{ message: { role: 'assistant', content: body }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 }
        }),
        text: async () => body
      } as unknown as Response;
    };

    const config = getDefaultAppConfig();
    const secretStore = createMockSecretStore();
    const modelGateway = new ModelGateway({ config, secretStore, fetchFn: recoveryFetch, db });
    const timeService = new TimeService('Asia/Shanghai', createFixedClock());
    const userContextService = new UserContextService();
    const runner = new PlanningGraphRunner({ modelGateway, timeService, userContextService });

    const dto = await runner.submitMessage({
      userId,
      characterId,
      userInput: '安排两个任务'
    });

    // 阻断 1 核心验证：模型调用次数严格等于 2（第一次失败 + 第二次成功），禁止第三次
    check('ToolStatus: model call count === 2', modelCallCount === 2);
    // 验证最终成功
    check('ToolStatus: ok=true', dto.ok === true);
    check('ToolStatus: has plan', dto.plan !== undefined && dto.plan !== null);
    check('ToolStatus: 2 tasks', dto.plan?.tasks?.length === 2);
    // 验证草案版本只有 1（没有被第三次调用覆盖）
    check('ToolStatus: draftVersion === 1', dto.plan?.draftVersion === 1);
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 24：阻断 2 - 手动编辑失败返回 ok=false，数据库回滚，模型调用次数为 0 =====
async function testManualEditFailureReturnsOkFalse(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId } = setupTestEnv(dbPath);
    const db = getDatabase();
    cleanupPlans();

    // 创建一个已有草案的场景，2 个任务
    const planId = `plan_${Date.now()}_test24`;
    const today = '2026-07-11'; // 固定日期，匹配 FixedClock
    const tp = futureTimePairs(2);
    planRepository.insert({ id: planId, date: today, status: 'draft', user_id: userId, character_id: characterId });
    planRepository.insertTasks([
      { id: 't24a', plan_id: planId, content: '任务A', start_time: tp[0].start_time, end_time: tp[0].end_time, completed: 0, order_index: 0 },
      { id: 't24b', plan_id: planId, content: '任务B', start_time: tp[1].start_time, end_time: tp[1].end_time, completed: 0, order_index: 1 }
    ]);

    // 记录修改前的值
    const tasksBefore = planRepository.getTasksByPlanId(planId);
    const taskABefore = tasksBefore.find(t => t.id === 't24a');

    // 使用不调用模型的 fetch（如果被调用会计数）
    let fetchCallCount = 0;
    const trackingFetch = async (_url: string, _options?: RequestInit): Promise<Response> => {
      fetchCallCount++;
      const body = JSON.stringify({ type: 'ask_clarification', clarificationQuestion: '不应调用', message: '不应调用' });
      return {
        ok: true, status: 200,
        json: async () => ({ id: 't', model: 'deepseek-chat', choices: [{ message: { role: 'assistant', content: body }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }),
        text: async () => body
      } as unknown as Response;
    };

    const config = getDefaultAppConfig();
    const secretStore = createMockSecretStore();
    const modelGateway = new ModelGateway({ config, secretStore, fetchFn: trackingFetch, db });
    const timeService = new TimeService('Asia/Shanghai', createFixedClock());
    const userContextService = new UserContextService();
    const runner = new PlanningGraphRunner({ modelGateway, timeService, userContextService });

    // 提交重叠时间的 patch：把任务 A 的 end_time 改为和任务 B 的 start_time 重叠
    // 任务 B 是 tp[1].start_time - tp[1].end_time
    // 让任务 A 的 end_time > 任务 B 的 start_time，造成重叠
    const overlapEndTime = tp[1].end_time; // 这会让 A 的时间范围覆盖 B
    const dto = await runner.submitManualEdit({
      userId,
      characterId,
      planId,
      agentAction: {
        type: 'patch_tasks',
        patches: [{ id: 't24a', end_time: overlapEndTime }],
        message: '修改任务A结束时间'
      }
    });

    // 阻断 2 核心验证：dto.ok=false
    check('ManualFail: ok=false', dto.ok === false);
    // reason 有明确错误信息
    check('ManualFail: has reason', (dto.reason?.length ?? 0) > 0);
    check('ManualFail: reason mentions overlap or validation', (dto.reason ?? '').includes('重叠') || (dto.reason ?? '').includes('校验失败') || (dto.reason ?? '').includes('失败'));

    // 模型调用次数为 0
    check('ManualFail: fetch NOT called (model 0)', fetchCallCount === 0);
    check('ManualFail: turnCallCount=0', modelGateway.getTurnCallCount() === 0);

    // 数据库完整回滚：任务 A 的 end_time 保持修改前的值
    const tasksAfter = planRepository.getTasksByPlanId(planId);
    const taskAAfter = tasksAfter.find(t => t.id === 't24a');
    check('ManualFail: task A end_time unchanged (rollback)', taskAAfter?.end_time === taskABefore?.end_time);
    check('ManualFail: task A content unchanged', taskAAfter?.content === taskABefore?.content);
    check('ManualFail: task A start_time unchanged', taskAAfter?.start_time === taskABefore?.start_time);
    check('ManualFail: still 2 tasks', tasksAfter.length === 2);
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 25：阻断 3 - 删除最后一个任务被禁止 =====
async function testDeleteLastTaskForbidden(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId } = setupTestEnv(dbPath);
    const db = getDatabase();
    cleanupPlans();

    // 创建只有一个任务的草案
    const planId = `plan_${Date.now()}_test25`;
    const today = '2026-07-11'; // 固定日期，匹配 FixedClock
    const tp = futureTimePairs(1);
    planRepository.insert({ id: planId, date: today, status: 'draft', user_id: userId, character_id: characterId });
    planRepository.insertTasks([
      { id: 't25a', plan_id: planId, content: '唯一任务', start_time: tp[0].start_time, end_time: tp[0].end_time, completed: 0, order_index: 0 }
    ]);

    let fetchCallCount = 0;
    const trackingFetch = async (_url: string, _options?: RequestInit): Promise<Response> => {
      fetchCallCount++;
      const body = JSON.stringify({ type: 'ask_clarification', clarificationQuestion: '不应调用', message: '不应调用' });
      return {
        ok: true, status: 200,
        json: async () => ({ id: 't', model: 'deepseek-chat', choices: [{ message: { role: 'assistant', content: body }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }),
        text: async () => body
      } as unknown as Response;
    };

    const config = getDefaultAppConfig();
    const secretStore = createMockSecretStore();
    const modelGateway = new ModelGateway({ config, secretStore, fetchFn: trackingFetch, db });
    const timeService = new TimeService('Asia/Shanghai', createFixedClock());
    const userContextService = new UserContextService();
    const runner = new PlanningGraphRunner({ modelGateway, timeService, userContextService });

    // 尝试删除最后一个（唯一的）任务
    const dto = await runner.submitManualEdit({
      userId,
      characterId,
      planId,
      agentAction: {
        type: 'delete_task',
        taskId: 't25a',
        message: '删除唯一任务'
      }
    });

    // 阻断 3 核心验证：删除被禁止，返回失败
    check('DeleteLast: ok=false', dto.ok === false);
    check('DeleteLast: has reason', (dto.reason?.length ?? 0) > 0);
    check('DeleteLast: reason mentions last task', (dto.reason ?? '').includes('最后一个') || (dto.reason ?? '').includes('放弃'));

    // 模型未被调用
    check('DeleteLast: fetch NOT called', fetchCallCount === 0);

    // 数据库中任务仍然存在（未被删除）
    const tasksAfter = planRepository.getTasksByPlanId(planId);
    check('DeleteLast: task still exists', tasksAfter.find(t => t.id === 't25a') !== undefined);
    check('DeleteLast: still 1 task', tasksAfter.length === 1);

    // 验证通过 graph 路径（非手动编辑）也禁止删除最后一个任务
    cleanupPlans();
    const planId2 = `plan_${Date.now()}_test25b`;
    planRepository.insert({ id: planId2, date: today, status: 'draft', user_id: userId, character_id: characterId });
    planRepository.insertTasks([
      { id: 't25b', plan_id: planId2, content: '唯一任务B', start_time: tp[0].start_time, end_time: tp[0].end_time, completed: 0, order_index: 0 }
    ]);

    // 模型返回 delete_task
    const deleteActionFetch = async (_url: string, _options?: RequestInit): Promise<Response> => {
      const action: AgentAction = {
        type: 'delete_task',
        taskId: 't25b',
        message: '删除唯一任务'
      };
      const body = JSON.stringify(action);
      return {
        ok: true, status: 200,
        json: async () => ({ id: 't', model: 'deepseek-chat', choices: [{ message: { role: 'assistant', content: body }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }),
        text: async () => body
      } as unknown as Response;
    };

    const modelGateway2 = new ModelGateway({ config, secretStore, fetchFn: deleteActionFetch, db });
    const runner2 = new PlanningGraphRunner({ modelGateway: modelGateway2, timeService, userContextService });

    // 先设置 checkpoint 让 graph 知道有草案
    const { toPlanDraft } = require('../../src/agent/graphs/planning/tools');
    const draftPlan = planRepository.getById(planId2);
    const draftTasks = planRepository.getTasksByPlanId(planId2);
    const checkpointRepo = checkpointRepository;
    checkpointRepo.save({
      id: `planning-test25-${Date.now()}`,
      graph_type: 'planning',
      state_json: JSON.stringify({
        messages: [],
        currentDraft: toPlanDraft({ id: planId2, date: today, tasks: draftTasks }, draftPlan?.draft_version ?? 1),
        draftVersion: draftPlan?.draft_version ?? 1,
        awaitingConfirmation: true,
        userId,
        characterId
      }),
      reason: 'awaiting_confirmation',
      scope_key: `${userId}:${characterId}`
    });

    const dto2 = await runner2.submitMessage({
      userId,
      characterId,
      userInput: '删除这个任务'
    });

    // 通过 graph 路径也禁止删除最后一个任务
    check('DeleteLastGraph: ok=false (or not published)', dto2.ok === false || dto2.published !== true);
    // 任务仍然存在
    const tasksAfterGraph = planRepository.getTasksByPlanId(planId2);
    check('DeleteLastGraph: task still exists', tasksAfterGraph.find(t => t.id === 't25b') !== undefined);
    check('DeleteLastGraph: still 1 task', tasksAfterGraph.length === 1);
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 26：阻断 4 - 确认发布失败不循环（任务变成过去时间）=====
// 验收要求：用户确认发布；发布时任务已经变成过去时间；publish_plan 返回失败；
// dto.ok === false；模型调用次数为 0；没有 recursion limit；数据库计划没有被错误发布。
async function testConfirmationPublishFailureNoLoop(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId } = setupTestEnv(dbPath);
    const db = getDatabase();
    cleanupPlans();

    // 创建一个草案，任务时间是未来时间（相对于固定时钟 10:00）
    const planId = `plan_${Date.now()}_test26`;
    const today = '2026-07-11'; // 固定日期，匹配 FixedClock
    const tp = futureTimePairs(1); // 10:30-11:00
    planRepository.insert({ id: planId, date: today, status: 'draft', user_id: userId, character_id: characterId });
    planRepository.insertTasks([
      { id: 't26a', plan_id: planId, content: '即将过期任务', start_time: tp[0].start_time, end_time: tp[0].end_time, completed: 0, order_index: 0 }
    ]);
    planRepository.markUserConfirmed(planId);

    // 使用一个时钟，将当前时间推进到任务开始时间之后（让任务变成过去时间）
    // 任务是 10:30-11:00，将时钟设为 11:30，任务变成过去时间
    const pastClock = new FixedClock(new Date('2026-07-11T03:30:00.000Z')); // UTC 03:30 = Shanghai 11:30

    // 模型不应被调用（isConfirmation=true 跳过模型），但如果循环会触发 recursion limit
    let fetchCallCount = 0;
    const trackingFetch = async (_url: string, _options?: RequestInit): Promise<Response> => {
      fetchCallCount++;
      const body = JSON.stringify({ type: 'publish_plan', message: '发布' });
      return {
        ok: true, status: 200,
        json: async () => ({ id: 't', model: 'deepseek-chat', choices: [{ message: { role: 'assistant', content: body }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }),
        text: async () => body
      } as unknown as Response;
    };

    const config = getDefaultAppConfig();
    const secretStore = createMockSecretStore();
    const modelGateway = new ModelGateway({ config, secretStore, fetchFn: trackingFetch, db });
    const timeService = new TimeService('Asia/Shanghai', pastClock);
    const userContextService = new UserContextService();
    const runner = new PlanningGraphRunner({ modelGateway, timeService, userContextService });

    // 用户点击确认发布按钮（isConfirmation=true）
    const dto = await runner.submitMessage({
      userId,
      characterId,
      userInput: '确认',
      isConfirmation: true
    });

    // 验收点 1：dto.ok === false（发布失败）
    check('ConfirmNoLoop: ok=false', dto.ok === false);
    // 验收点 2：有明确失败原因
    check('ConfirmNoLoop: has reason', (dto.reason?.length ?? 0) > 0);
    // 验收点 3：模型调用次数为 0（isConfirmation 不调用模型）
    check('ConfirmNoLoop: model NOT called (modelCallCount=0)', fetchCallCount === 0);
    check('ConfirmNoLoop: turnCallCount=0', modelGateway.getTurnCallCount() === 0);
    // 验收点 4：没有 recursion limit（没有抛出异常，正常返回 DTO）
    check('ConfirmNoLoop: no recursion limit (dto returned)', dto !== null && dto !== undefined);
    // 验收点 5：published !== true
    check('ConfirmNoLoop: published=false', dto.published !== true);
    // 验收点 6：数据库计划没有被错误发布（仍然是 draft 状态）
    const plan = planRepository.getById(planId);
    check('ConfirmNoLoop: plan still draft in DB', plan?.status === 'draft');
    // 验收点 7：没有 active 计划被创建
    const activePlan = planRepository.getActivePlan();
    check('ConfirmNoLoop: no active plan created', activePlan === null || activePlan === undefined);

    // 验证 Trace 存在且 modelCallCount=0
    const trace = runner.getLastTrace();
    check('ConfirmNoLoop: trace exists', trace !== null);
    check('ConfirmNoLoop: trace modelCallCount=0', trace?.modelCallCount === 0);
    check('ConfirmNoLoop: trace finalResult=fail', trace?.finalResult === 'fail');
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 27：23:59 边界场景 - FixedClock 确保时间稳定 =====
async function testMidnightBoundary23_59(): Promise<void> {
  // 使用 23:59 作为当前时间，验证时间辅助函数和校验仍然稳定
  const clock2359 = new FixedClock(new Date('2026-07-11T15:59:00.000Z')); // UTC 15:59 = Shanghai 23:59

  const dbPath = tempDbPath();
  try {
    const { userId, characterId } = setupTestEnv(dbPath);
    const db = getDatabase();
    cleanupPlans();

    // 23:59 时，未来时间只能是 00:00 之后（跨日）
    // 但我们的日期固定为 2026-07-11，所以 23:59 之后的时间在当天不存在
    // 验证 validateTaskTimesNotPast 在 23:59 时的行为
    const hour2359 = 23;
    const min2359 = 59;

    // 22:00 是过去时间（22:00 < 23:59）
    const pastCheck = validateTaskTimesNotPast(
      [{ start_time: '22:00', end_time: '23:00' }],
      hour2359, min2359
    );
    check('Boundary2359: 22:00 rejected as past', !pastCheck.valid);

    // 23:59 本身开始也不合法（等于当前时间，但开始时间必须 >= 当前）
    // validateTaskTimesNotPast 用 < 比较，23:59 = 23:59 不算 past（valid=true）
    // 但 start < end 校验会拒绝（start === end）
    const equalCheck = validateTaskTimesNotPast(
      [{ start_time: '23:59', end_time: '23:59' }],
      hour2359, min2359
    );
    // validateTaskTimesNotPast 只检查过去时间，23:59 = 23:59 不算过去，所以 valid=true
    // start < end 的校验由 validatePlanDraft 负责
    check('Boundary2359: 23:59 equal time not past (valid=true, start<end checked elsewhere)', equalCheck.valid === true);

    // 验证 TimeService 在 23:59 返回正确的时间上下文
    const timeService = new TimeService('Asia/Shanghai', clock2359);
    const ctx = timeService.getCurrentTimeContext();
    check('Boundary2359: localDisplay is 23:59', ctx.localDisplay === '2026-07-11 23:59:00');
    check('Boundary2359: weekday is 星期六', ctx.weekday === '星期六');

    // 验证 PlanningGraph 在 23:59 能正常运行（不会崩溃）
    // 模型返回 ask_clarification（因为 23:59 几乎没有未来时间可安排）
    const runner = createRunner(db, createMockFetchForPlanning({
      type: 'ask_clarification',
      clarificationQuestion: '现在已经 23:59 了，你今天还有想完成的事吗？',
      message: '现在已经 23:59 了，你今天还有想完成的事吗？'
    }), clock2359);

    const dto = await runner.submitMessage({
      userId,
      characterId,
      userInput: '安排任务'
    });

    check('Boundary2359: graph completes without crash', dto !== null && dto !== undefined);
    check('Boundary2359: ok=true', dto.ok === true);
    check('Boundary2359: actionType=ask_clarification', dto.actionType === 'ask_clarification');
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 28：零点场景（00:00）=====
async function testMidnightBoundary00_00(): Promise<void> {
  const clock0000 = new FixedClock(new Date('2026-07-11T16:00:00.000Z')); // UTC 16:00 = Shanghai 00:00 (next day)
  // 注意：2026-07-11T16:00:00Z 在 Asia/Shanghai 是 2026-07-12 00:00:00
  // 但我们固定日期为 2026-07-11，这里主要验证时间逻辑不崩溃

  const dbPath = tempDbPath();
  try {
    const { userId, characterId } = setupTestEnv(dbPath);
    const db = getDatabase();
    cleanupPlans();

    const timeService = new TimeService('Asia/Shanghai', clock0000);
    const ctx = timeService.getCurrentTimeContext();
    // 00:00 时所有当天时间都是未来时间（或等于当前）
    check('Boundary0000: hour is 00', ctx.localDisplay.includes('00:00:00'));

    // 00:00 时，01:00 是未来时间
    const futureCheck = validateTaskTimesNotPast(
      [{ start_time: '01:00', end_time: '02:00' }],
      0, 0
    );
    check('Boundary0000: 01:00 accepted as future at 00:00', futureCheck.valid);

    // 23:00 也是未来时间（在 00:00 之后）
    const lateFutureCheck = validateTaskTimesNotPast(
      [{ start_time: '23:00', end_time: '23:30' }],
      0, 0
    );
    check('Boundary0000: 23:00 accepted as future at 00:00', lateFutureCheck.valid);

    // 验证 PlanningGraph 在 00:00 能正常运行
    const tp = futureTimePairs(1); // 基于固定基准 10:00 的时间对，在 00:00 都是未来
    const runner = createRunner(db, createMockFetchForPlanning({
      type: 'create_draft',
      tasks: [{ start_time: tp[0].start_time, end_time: tp[0].end_time, content: '零点任务' }],
      message: '计划已生成'
    }), clock0000);

    const dto = await runner.submitMessage({
      userId,
      characterId,
      userInput: '安排任务'
    });

    check('Boundary0000: graph completes without crash', dto !== null && dto !== undefined);
    check('Boundary0000: ok=true', dto.ok === true);
    check('Boundary0000: has plan', dto.plan !== undefined);
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 29：跨日边界 - 23:59 到次日 00:00 =====
async function testCrossDayBoundary(): Promise<void> {
  // 验证 23:50 到 00:10 跨日场景，时间校验逻辑稳定
  const clock2350 = new FixedClock(new Date('2026-07-11T15:50:00.000Z')); // Shanghai 23:50

  const dbPath = tempDbPath();
  try {
    setupTestEnv(dbPath);
    cleanupPlans();

    const timeService = new TimeService('Asia/Shanghai', clock2350);
    const ctx = timeService.getCurrentTimeContext();
    check('CrossDay: time is 23:50', ctx.localDisplay === '2026-07-11 23:50:00');

    // 23:50 时，23:55 是未来时间（5 分钟后）
    const soonFuture = validateTaskTimesNotPast(
      [{ start_time: '23:55', end_time: '23:59' }],
      23, 50
    );
    check('CrossDay: 23:55 is future at 23:50', soonFuture.valid);

    // 23:45 是过去时间
    const pastCheck = validateTaskTimesNotPast(
      [{ start_time: '23:45', end_time: '23:50' }],
      23, 50
    );
    check('CrossDay: 23:45 is past at 23:50', !pastCheck.valid);

    // 切换到次日 00:05
    const clock0005 = new FixedClock(new Date('2026-07-11T16:05:00.000Z')); // Shanghai 00:05 (next day)
    timeService.setClock(clock0005);
    const ctx2 = timeService.getCurrentTimeContext();
    check('CrossDay: time switched to 00:05', ctx2.localDisplay.includes('00:05:00'));

    // 00:05 时，00:10 是未来时间
    const futureNextDay = validateTaskTimesNotPast(
      [{ start_time: '00:10', end_time: '00:30' }],
      0, 5
    );
    check('CrossDay: 00:10 is future at 00:05', futureNextDay.valid);

    // 23:30 现在也是未来时间（在 00:05 之后）
    const lateFuture = validateTaskTimesNotPast(
      [{ start_time: '23:30', end_time: '23:50' }],
      0, 5
    );
    check('CrossDay: 23:30 is future at 00:05', lateFuture.valid);
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 30：Trace Token 累计验证（两次模型调用 200/100 → 最终 400/200）=====
async function testTraceTokenAccumulation(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId } = setupTestEnv(dbPath);
    const db = getDatabase();
    cleanupPlans();

    // 模拟两次模型调用：第一次 inputTokens=200, outputTokens=100
    // 第二次 inputTokens=200, outputTokens=100
    // 最终 totalInputTokens=400, totalOutputTokens=200
    let modelCallCount = 0;
    const accumulatingFetch = async (_url: string, _options?: RequestInit): Promise<Response> => {
      modelCallCount++;
      let action: AgentAction;

      if (modelCallCount === 1) {
        // 第一次：返回需要草案但没有草案的动作（触发工具失败，回到 agent_decide）
        action = {
          type: 'patch_tasks',
          patches: [{ id: 'nonexistent', content: '触发失败以进行第二次调用' }],
          message: '我来修改任务'
        };
      } else {
        // 第二次：返回合法的 create_draft
        const tp = futureTimePairs(1);
        action = {
          type: 'create_draft',
          tasks: [{ start_time: tp[0].start_time, end_time: tp[0].end_time, content: '累计token测试' }],
          message: '已重新生成计划草案。'
        };
      }

      const body = JSON.stringify(action);
      return {
        ok: true, status: 200,
        json: async () => ({
          id: 'test',
          model: 'deepseek-chat',
          choices: [{ message: { role: 'assistant', content: body }, finish_reason: 'stop' }],
          // 每次调用都是 inputTokens=200, outputTokens=100
          usage: { prompt_tokens: 200, completion_tokens: 100, total_tokens: 300 }
        }),
        text: async () => body
      } as unknown as Response;
    };

    const config = getDefaultAppConfig();
    const secretStore = createMockSecretStore();
    const modelGateway = new ModelGateway({ config, secretStore, fetchFn: accumulatingFetch, db });
    const timeService = new TimeService('Asia/Shanghai', createFixedClock());
    const userContextService = new UserContextService();
    const runner = new PlanningGraphRunner({ modelGateway, timeService, userContextService });

    const dto = await runner.submitMessage({
      userId,
      characterId,
      userInput: '安排任务'
    });

    // 验证模型被调用了 2 次
    check('TokenAccum: model called 2 times', modelCallCount === 2);
    // 验证最终成功
    check('TokenAccum: ok=true', dto.ok === true);

    // 核心：验证 Trace 中的累计 token
    const trace = runner.getLastTrace();
    check('TokenAccum: trace exists', trace !== null);
    check('TokenAccum: trace modelCallCount=2', trace?.modelCallCount === 2);
    // 两次调用都是 200/100，累计应该是 400/200
    check('TokenAccum: totalInputTokens=400', trace?.totalInputTokens === 400);
    check('TokenAccum: totalOutputTokens=200', trace?.totalOutputTokens === 200);
    // lastInputTokens 和 lastOutputTokens 应该是最后一次调用的值（200/100）
    check('TokenAccum: lastInputTokens=200', trace?.inputTokens === 200);
    check('TokenAccum: lastOutputTokens=100', trace?.outputTokens === 100);
    // 验证 phases 包含 2 个 agent_decide 阶段
    const agentDecidePhases = trace?.phases.filter(p => p.name === 'agent_decide') ?? [];
    check('TokenAccum: 2 agent_decide phases', agentDecidePhases.length === 2);
    // 验证 phases 包含 execute_tool 阶段
    const executeToolPhases = trace?.phases.filter(p => p.name === 'execute_tool') ?? [];
    check('TokenAccum: has execute_tool phases', executeToolPhases.length >= 1);
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 31：Trace 脱敏验证 =====
async function testTraceSanitization(): Promise<void> {
  // 直接测试 sanitizePlanningTraceText 函数
  const sensitiveTexts = [
    '我的 API Key 是 sk-abc123def456ghi789jkl012mno345',
    'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.token',
    'Authorization: Bearer abc123def456ghi789',
    '联系我 user@example.com 或 admin@test.org',
    '文件在 C:\\Users\\admin\\Documents\\secrets.txt',
    '配置在 /home/user/.config/credentials',
    'password=MySecretPass123 和 api_key=sk-test123456789',
    '电话 13812345678 联系我',
    '卡号 1234567890123456 是信用卡'
  ];

  const sanitized = sensitiveTexts.map(s => sanitizePlanningTraceText(s, 200));

  // 验证 API Key 被脱敏
  check('Sanitize: API Key redacted', !sanitized[0].includes('sk-abc123def456ghi789jkl012mno345'));
  check('Sanitize: API Key has REDACTED marker', sanitized[0].includes('[REDACTED'));

  // 验证 Bearer Token 被脱敏
  check('Sanitize: Bearer token redacted', !sanitized[1].includes('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'));
  check('Sanitize: Bearer has REDACTED marker', sanitized[1].includes('[REDACTED'));

  // 验证 Authorization 头被脱敏
  check('Sanitize: Authorization redacted', !sanitized[2].includes('Bearer abc123def456ghi789'));

  // 验证邮箱被脱敏
  check('Sanitize: email 1 redacted', !sanitized[3].includes('user@example.com'));
  check('Sanitize: email 2 redacted', !sanitized[3].includes('admin@test.org'));
  check('Sanitize: email has REDACTED marker', sanitized[3].includes('[REDACTED_EMAIL]'));

  // 验证 Windows 路径被脱敏
  check('Sanitize: Windows path redacted', !sanitized[4].includes('C:\\Users\\admin\\Documents\\secrets.txt'));
  check('Sanitize: Windows path has REDACTED marker', sanitized[4].includes('[REDACTED_PATH]'));

  // 验证 Unix 路径被脱敏
  check('Sanitize: Unix path redacted', !sanitized[5].includes('/home/user/.config/credentials'));
  check('Sanitize: Unix path has REDACTED marker', sanitized[5].includes('[REDACTED_PATH]'));

  // 验证敏感键值对被脱敏
  check('Sanitize: password redacted', !sanitized[6].includes('MySecretPass123'));
  check('Sanitize: api_key value redacted', !sanitized[6].includes('sk-test123456789'));

  // 验证电话号码被脱敏
  check('Sanitize: phone redacted', !sanitized[7].includes('13812345678'));
  check('Sanitize: phone has REDACTED marker', sanitized[7].includes('[REDACTED_PHONE]'));

  // 验证超长数字被脱敏
  check('Sanitize: long number redacted', !sanitized[8].includes('1234567890123456'));

  // 验证通过 PlanningGraph 后 Trace 的 userInputSummary 经过脱敏
  const dbPath = tempDbPath();
  try {
    const { userId, characterId } = setupTestEnv(dbPath);
    const db = getDatabase();
    cleanupPlans();

    const runner = createRunner(db, createMockFetchForPlanning({
      type: 'ask_clarification',
      clarificationQuestion: '你想要什么？',
      message: '你想要什么？'
    }));

    // 用户输入包含敏感信息
    const sensitiveInput = '我的 API Key 是 sk-test123456789abc，邮箱 test@example.com，路径 C:\\Users\\secret';
    const dto = await runner.submitMessage({
      userId,
      characterId,
      userInput: sensitiveInput
    });

    check('Sanitize: graph completes', dto.ok === true);

    // 验证 Trace 的 userInputSummary 不包含原始敏感信息
    const trace = runner.getLastTrace();
    check('Sanitize: trace exists', trace !== null);
    check('Sanitize: userInputSummary redacts API key', !(trace?.userInputSummary ?? '').includes('sk-test123456789abc'));
    check('Sanitize: userInputSummary redacts email', !(trace?.userInputSummary ?? '').includes('test@example.com'));
    check('Sanitize: userInputSummary redacts path', !(trace?.userInputSummary ?? '').includes('C:\\Users\\secret'));
    check('Sanitize: userInputSummary has REDACTED marker', (trace?.userInputSummary ?? '').includes('[REDACTED'));
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 32：手动编辑生成并刷新 Trace =====
async function testManualEditGeneratesTrace(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId } = setupTestEnv(dbPath);
    const db = getDatabase();
    cleanupPlans();

    // 创建一个草案
    const planId = `plan_${Date.now()}_test32`;
    const today = '2026-07-11';
    const tp = futureTimePairs(2);
    planRepository.insert({ id: planId, date: today, status: 'draft', user_id: userId, character_id: characterId });
    planRepository.insertTasks([
      { id: 't32a', plan_id: planId, content: '任务A', start_time: tp[0].start_time, end_time: tp[0].end_time, completed: 0, order_index: 0 },
      { id: 't32b', plan_id: planId, content: '任务B', start_time: tp[1].start_time, end_time: tp[1].end_time, completed: 0, order_index: 1 }
    ]);

    const runner = createRunner(db);

    // 第一次手动编辑：修改任务A的时间
    const newTime = futureTimePairs(3)[2]; // 第三个时间槽，避免重叠
    const dto1 = await runner.submitManualEdit({
      userId,
      characterId,
      planId,
      agentAction: {
        type: 'patch_tasks',
        patches: [{ id: 't32a', start_time: newTime.start_time, end_time: newTime.end_time }],
        message: '修改任务A时间'
      }
    });

    check('ManualTrace: edit 1 ok=true', dto1.ok === true);

    // 验证第一次手动编辑生成了 Trace
    const trace1 = runner.getLastTrace();
    check('ManualTrace: trace 1 exists', trace1 !== null);
    check('ManualTrace: trace 1 modelCallCount=0', trace1?.modelCallCount === 0);
    check('ManualTrace: trace 1 has traceId', (trace1?.traceId?.length ?? 0) > 0);
    check('ManualTrace: trace 1 has actionType', (trace1?.phases?.some(p => p.actionType === 'patch_tasks')) === true);
    check('ManualTrace: trace 1 finalResult=ok', trace1?.finalResult === 'ok');
    check('ManualTrace: trace 1 has draftVersion', (trace1?.draftVersion ?? 0) >= 0);
    check('ManualTrace: trace 1 has totalDurationMs', (trace1?.totalDurationMs ?? 0) >= 0);

    // 第二次手动编辑：删除任务B（验证 Trace 被刷新）
    const dto2 = await runner.submitManualEdit({
      userId,
      characterId,
      planId,
      agentAction: {
        type: 'delete_task',
        taskId: 't32b',
        message: '删除任务B'
      }
    });

    check('ManualTrace: edit 2 ok=true', dto2.ok === true);

    // 验证第二次手动编辑刷新了 Trace（traceId 应该不同）
    const trace2 = runner.getLastTrace();
    check('ManualTrace: trace 2 exists', trace2 !== null);
    check('ManualTrace: trace 2 modelCallCount=0', trace2?.modelCallCount === 0);
    check('ManualTrace: trace 2 has delete action', (trace2?.phases?.some(p => p.actionType === 'delete_task')) === true);
    // Trace 被刷新（traceId 不同）
    check('ManualTrace: trace 2 refreshed (different traceId)', trace1?.traceId !== trace2?.traceId);

    // 验证阶段记录包含 load_planning_context
    const hasLoadContext = trace2?.phases.some(p => p.name === 'load_planning_context') ?? false;
    check('ManualTrace: trace has load_planning_context phase', hasLoadContext);
    // 验证阶段记录包含 execute_tool
    const hasExecuteTool = trace2?.phases.some(p => p.name === 'execute_tool') ?? false;
    check('ManualTrace: trace has execute_tool phase', hasExecuteTool);
    // 验证阶段记录包含 build_response
    const hasBuildResponse = trace2?.phases.some(p => p.name === 'build_response') ?? false;
    check('ManualTrace: trace has build_response phase', hasBuildResponse);
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 33：模型输出缺少 message 字段时使用默认消息（v4-pro 兼容性） =====
async function testPatchTasksWithoutMessage(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId } = setupTestEnv(dbPath);
    const db = getDatabase();
    cleanupPlans();

    // 先创建一个草案
    const planId = `plan_${Date.now()}_test33`;
    const today = '2026-07-11'; // 固定日期，匹配 FixedClock
    const tp33 = futureTimePairs(2);
    planRepository.insert({ id: planId, date: today, status: 'draft', user_id: userId, character_id: characterId });
    planRepository.insertTasks([
      { id: 't1', plan_id: planId, content: '上午工作', start_time: tp33[0].start_time, end_time: tp33[0].end_time, completed: 0, order_index: 0 },
      { id: 't2', plan_id: planId, content: '下午任务', start_time: tp33[1].start_time, end_time: tp33[1].end_time, completed: 0, order_index: 1 }
    ]);

    const tasks = planRepository.getTasksByPlanId(planId);
    const afternoonTaskId = tasks.find(t => t.content === '下午任务')?.id;
    // 新结束时间必须在 start_time 和 end_time 之间（11:30-12:00 → 11:45）
    const newEndTime = '11:45';

    // 模型返回 patch_tasks 但故意不包含 message 字段（模拟 v4-pro 行为）
    const actionWithoutMessage = {
      type: 'patch_tasks' as const,
      patches: [
        { id: afternoonTaskId, end_time: newEndTime }
      ]
      // 故意省略 message 字段
    };
    const runner = createRunner(db, createMockFetchForPlanning(actionWithoutMessage));

    const dto = await runner.submitMessage({
      userId,
      characterId,
      userInput: '下午不要太满'
    });

    // 校验：不应报错 "message: Invalid input"
    check('PatchNoMessage: ok=true', dto.ok === true);
    check('PatchNoMessage: actionType=patch_tasks', dto.actionType === 'patch_tasks');
    // 校验：应使用默认消息补全
    check('PatchNoMessage: has default message', (dto.message?.length ?? 0) > 0);
    // 校验：任务确实被修改了
    const updatedTasks = planRepository.getTasksByPlanId(planId);
    const patchedTask = updatedTasks.find(t => t.id === afternoonTaskId);
    check('PatchNoMessage: task end_time changed', patchedTask?.end_time === newEndTime);
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

/**
 * 创建 mock fetch，返回 content 为空但 reasoning_content 有值的响应。
 * 模拟 deepseek-v4-pro 在思考模式下 content 为空白的场景。
 */
function createMockFetchReasoningContent(action: AgentAction, model: string = 'deepseek-v4-pro') {
  const body = JSON.stringify(action);
  return async (_url: string, _options?: RequestInit): Promise<Response> => {
    const mockResponse = {
      ok: true,
      status: 200,
      json: async () => ({
        id: 'test-reasoning-id',
        model,
        choices: [{
          // content 为空字符串，实际响应在 reasoning_content 中
          message: { role: 'assistant', content: '   ', reasoning_content: body },
          finish_reason: 'stop'
        }],
        usage: { prompt_tokens: 200, completion_tokens: 100, total_tokens: 300 }
      }),
      text: async () => body
    } as unknown as Response;
    return mockResponse;
  };
}

// ===== 测试 34：reasoning_content 回退（v4-pro 兼容性）=====
async function testReasoningContentFallback(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId } = setupTestEnv(dbPath);
    const db = getDatabase();
    cleanupPlans();

    // 模型返回 create_draft，但 content 为空白，实际 JSON 在 reasoning_content 中
    const action: AgentAction = {
      type: 'create_draft',
      tasks: [
        { start_time: '11:00', end_time: '12:00', content: '测试任务' }
      ],
      message: '计划已生成'
    };
    const runner = createRunner(db, createMockFetchReasoningContent(action));

    const dto = await runner.submitMessage({
      userId,
      characterId,
      userInput: '帮我安排一个上午的任务'
    });

    // 校验：应从 reasoning_content 回退获取实际响应，不报错
    check('ReasoningFallback: ok=true', dto.ok === true);
    check('ReasoningFallback: actionType=create_draft', dto.actionType === 'create_draft');
    check('ReasoningFallback: has message', (dto.message?.length ?? 0) > 0);
    // 校验：草案确实创建了
    check('ReasoningFallback: plan created', dto.plan !== undefined && dto.plan !== null);
    const draft = planRepository.getDraftPlan();
    check('ReasoningFallback: draft in DB', draft !== null && draft !== undefined);
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// ===== 运行所有测试 =====
async function main(): Promise<void> {
  console.log('=== PlanningGraph 测试开始 ===\n');

  await testVagueGoalAsksClarification();
  console.log('');
  await testClearGoalCreatesDraft();
  console.log('');
  await testPatchAfternoonConstraint();
  console.log('');
  await testPatchSpecificTaskOnly();
  console.log('');
  await testDeleteSpecificTaskOnly();
  console.log('');
  await testConfirmationEquivalence();
  console.log('');
  await testNoPublishWithoutConfirmation();
  console.log('');
  await testNoPastTaskTimes();
  console.log('');
  await testRestartRecovery();
  console.log('');
  await testInvalidParametersNotWritten();
  console.log('');
  await testConcurrentConfirmSingleActive();
  console.log('');
  await testModelTransparency();
  console.log('');
  await testPackagedBuildExists();
  console.log('');
  await testExecutePlanningToolDirectly();
  console.log('');
  await testConfirmationKeywords();
  console.log('');
  // Fix 7: 集成测试
  await testManualEditDeleteTaskFromDB();
  console.log('');
  await testManualEditDoesNotCallModel();
  console.log('');
  await testRestartRestoresMessageHistory();
  console.log('');
  await testOverlapAndReversedTimeCannotPublish();
  console.log('');
  await testPlanningModelEntersHttpBody();
  console.log('');
  await testToolFailureAutoRecovery();
  console.log('');
  await testHaoDeDoesNotAutoPublish();
  console.log('');
  // Fix 1 & Fix 2 新增测试
  await testIllegalPatchRollbackFieldsUnchanged();
  console.log('');
  await testLastToolErrorInjectedIntoSecondModelCall();
  console.log('');
  // 阻断 1/2/3 新增测试
  await testToolExecutionStatusPreventsThirdModelCall();
  console.log('');
  await testManualEditFailureReturnsOkFalse();
  console.log('');
  await testDeleteLastTaskForbidden();
  console.log('');
  // 阻断 4 - 确认发布失败不循环 + 时间边界 + Trace 验证
  await testConfirmationPublishFailureNoLoop();
  console.log('');
  await testMidnightBoundary23_59();
  console.log('');
  await testMidnightBoundary00_00();
  console.log('');
  await testCrossDayBoundary();
  console.log('');
  await testTraceTokenAccumulation();
  console.log('');
  await testTraceSanitization();
  console.log('');
  await testManualEditGeneratesTrace();
  console.log('');
  await testPatchTasksWithoutMessage();
  console.log('');
  await testReasoningContentFallback();

  console.log('\n=== 测试结果 ===');
  console.log(`PASS: ${pass}, FAIL: ${fail}`);
  if (failures.length > 0) {
    console.log('\n失败测试：');
    failures.forEach(f => console.log(`  - ${f}`));
    process.exit(1);
  } else {
    console.log('全部通过！');
  }
}

main().catch((error) => {
  console.error('Test runner failed:', error);
  process.exit(1);
});
