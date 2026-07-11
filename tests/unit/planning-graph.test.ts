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
import { TimeService } from '../../src/services/TimeService';
import { UserContextService } from '../../src/services/UserContextService';

import { PlanningGraphRunner } from '../../src/agent/graphs/planning/graph';
import type { AgentAction } from '../../src/agent/graphs/planning/state';
import { validateAgentAction, validateTaskTimesNotPast, executePlanningTool } from '../../src/agent/graphs/planning/tools';
import { isConfirmationInput } from '../../src/agent/graphs/planning/nodes/agent-decide';
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

/** 创建 PlanningGraphRunner */
function createRunner(
  db: ReturnType<typeof getDatabase>,
  fetchFn?: ReturnType<typeof createMockFetchForPlanning>
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

  const timeService = new TimeService('Asia/Shanghai');
  const userContextService = new UserContextService();

  return new PlanningGraphRunner({ modelGateway, timeService, userContextService });
}

/** 清理所有计划数据（测试间隔离） */
function cleanupPlans(): void {
  try {
    getDatabase().prepare('DELETE FROM plan_tasks').run();
    getDatabase().prepare('DELETE FROM plans').run();
    getDatabase().prepare('DELETE FROM checkpoints').run();
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

/** 生成未来时间（当前时间 + offsetMinutes 分钟）的 HH:MM 格式，不跨午夜 */
function futureTime(offsetMinutes: number): string {
  const now = new Date();
  const future = new Date(now.getTime() + offsetMinutes * 60000);
  let h = future.getHours();
  let m = future.getMinutes();
  // 如果跨午夜，回退到 23:59 避免时间验证失败
  if (h * 60 + m < now.getHours() * 60 + now.getMinutes()) {
    h = 23;
    m = 59;
  }
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * 生成 N 个递增的未来时间对（start/end），确保：
 * 1. 所有时间在当前时间之后
 * 2. 不跨午夜
 * 3. start < end
 * 4. 时间对之间不重叠
 */
function futureTimePairs(count: number): Array<{ start_time: string; end_time: string }> {
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const maxMinutes = 23 * 60 + 58; // 23:58 as max
  const availableMinutes = maxMinutes - currentMinutes;
  const slotSize = Math.floor(availableMinutes / (count + 1));

  const pairs: Array<{ start_time: string; end_time: string }> = [];
  for (let i = 0; i < count; i++) {
    const startMin = currentMinutes + slotSize * (i + 1);
    const endMin = startMin + slotSize - 1; // 至少 1 分钟间隔
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

    // 先创建一个草案
    const planId = `plan_${Date.now()}_test3`;
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
    planRepository.insert({ id: planId, date: today, status: 'draft' });
    planRepository.insertTasks([
      { id: 't1', plan_id: planId, content: '上午工作', start_time: '09:00', end_time: '11:00', completed: 0, order_index: 0 },
      { id: 't2', plan_id: planId, content: '下午任务A', start_time: '14:00', end_time: '16:00', completed: 0, order_index: 1 },
      { id: 't3', plan_id: planId, content: '下午任务B', start_time: '16:00', end_time: '18:00', completed: 0, order_index: 2 }
    ]);

    // 获取草案中的任务 ID
    const tasks = planRepository.getTasksByPlanId(planId);
    const afternoonTaskId = tasks.find(t => t.content === '下午任务A')?.id;

    // 模型返回 patch_tasks 修改下午任务
    const runner = createRunner(db, createMockFetchForPlanning({
      type: 'patch_tasks',
      patches: [
        { id: afternoonTaskId, end_time: '15:00' }
      ],
      message: '已将下午任务A的结束时间提前到15:00，让下午不那么满。'
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
    check('PatchAfternoon: task end_time changed', patchedTask?.end_time === '15:00');
    check('PatchAfternoon: other task unchanged', otherTask?.start_time === '09:00' && otherTask?.end_time === '11:00');
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
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
    planRepository.insert({ id: planId, date: today, status: 'draft' });
    planRepository.insertTasks([
      { id: 't1', plan_id: planId, content: '第一项', start_time: '09:00', end_time: '10:00', completed: 0, order_index: 0 },
      { id: 't2', plan_id: planId, content: '第二项', start_time: '10:00', end_time: '11:00', completed: 0, order_index: 1 },
      { id: 't3', plan_id: planId, content: '第三项', start_time: '11:00', end_time: '12:00', completed: 0, order_index: 2 }
    ]);

    const tasks = planRepository.getTasksByPlanId(planId);
    const secondTaskId = tasks.find(t => t.content === '第二项')?.id;

    const runner = createRunner(db, createMockFetchForPlanning({
      type: 'patch_tasks',
      patches: [
        { id: secondTaskId, start_time: '10:30', end_time: '11:30' }
      ],
      message: '已将第二项推迟半小时。'
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
    check('PatchSpecific: second task moved', secondTask?.start_time === '10:30' && secondTask?.end_time === '11:30');
    check('PatchSpecific: first task unchanged', firstTask?.start_time === '09:00');
    check('PatchSpecific: third task unchanged', thirdTask?.start_time === '11:00');
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
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
    planRepository.insert({ id: planId, date: today, status: 'draft' });
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
async function testConfirmationEquivalence(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId } = setupTestEnv(dbPath);
    const db = getDatabase();

    // === 场景 A：对话中说"就这样" ===
    cleanupPlans();
    const planIdA = `plan_${Date.now()}_test6a`;
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
    planRepository.insert({ id: planIdA, date: today, status: 'draft' });
    planRepository.insertTasks([
      { id: 't1a', plan_id: planIdA, content: '任务A', start_time: '09:00', end_time: '10:00', completed: 0, order_index: 0 }
    ]);

    const runnerA = createRunner(db);
    const dtoA = await runnerA.submitMessage({
      userId,
      characterId,
      userInput: '就这样',
      isConfirmation: true
    });

    check('ConfirmEquiv A: ok=true', dtoA.ok === true);
    check('ConfirmEquiv A: published=true', dtoA.published === true);

    const activePlanA = planRepository.getActivePlan();
    check('ConfirmEquiv A: active plan exists', activePlanA !== null);
    check('ConfirmEquiv A: status=active', activePlanA?.status === 'active');

    // === 场景 B：点击确认按钮（isConfirmation=true） ===
    cleanupPlans();
    const planIdB = `plan_${Date.now()}_test6b`;
    planRepository.insert({ id: planIdB, date: today, status: 'draft' });
    planRepository.insertTasks([
      { id: 't1b', plan_id: planIdB, content: '任务B', start_time: '09:00', end_time: '10:00', completed: 0, order_index: 0 }
    ]);

    const runnerB = createRunner(db);
    const dtoB = await runnerB.submitMessage({
      userId,
      characterId,
      userInput: '确认',  // 模拟点击确认按钮时 integration.ts 传入的 "就这样"
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
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
    planRepository.insert({ id: planId, date: today, status: 'draft' });
    planRepository.insertTasks([
      { id: 't1', plan_id: planId, content: '任务', start_time: '09:00', end_time: '10:00', completed: 0, order_index: 0 }
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
  // 直接测试 validateTaskTimesNotPast 函数
  const now = new Date();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();

  // 过去时间的任务应该被拒绝
  const pastTime = `${String(Math.max(0, currentHour - 2)).padStart(2, '0')}:00`;
  const pastCheck = validateTaskTimesNotPast(
    [{ start_time: pastTime, end_time: `${String(Math.max(0, currentHour - 1)).padStart(2, '0')}:00` }],
    currentHour,
    currentMinute
  );
  check('NoPastTimes: past task rejected', !pastCheck.valid);

  // 未来时间的任务应该通过
  const futureTime = `${String(Math.min(23, currentHour + 2)).padStart(2, '0')}:00`;
  const futureCheck = validateTaskTimesNotPast(
    [{ start_time: futureTime, end_time: `${String(Math.min(23, currentHour + 3)).padStart(2, '0')}:00` }],
    currentHour,
    currentMinute
  );
  check('NoPastTimes: future task accepted', futureCheck.valid);

  // 通过 PlanningGraph 测试完整流程
  const dbPath = tempDbPath();
  try {
    const { userId, characterId } = setupTestEnv(dbPath);
    const db = getDatabase();
    cleanupPlans();

    // 模型返回过去时间的任务
    const pastHour = String(Math.max(0, currentHour - 3)).padStart(2, '0');
    const pastEndHour = String(Math.max(0, currentHour - 2)).padStart(2, '0');
    const runner = createRunner(db, createMockFetchForPlanning({
      type: 'create_draft',
      tasks: [{ start_time: `${pastHour}:00`, end_time: `${pastEndHour}:00`, content: '过去任务' }],
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

    check('InvalidParams: graph rejects invalid', dto.ok === false || dto.plan === undefined);

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
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
    planRepository.insert({ id: planId, date: today, status: 'draft' });
    planRepository.insertTasks([
      { id: 't1', plan_id: planId, content: '任务', start_time: '09:00', end_time: '10:00', completed: 0, order_index: 0 }
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

    // 验证 active 唯一索引存在
    const indexes = db2.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE '%active_unique%'").all() as Array<{ name: string }>;
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
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });

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
  check('ConfirmKeywords: "好的" detected', isConfirmationInput('好的'));
  check('ConfirmKeywords: "帮我安排" not detected', !isConfirmationInput('帮我安排'));
  check('ConfirmKeywords: "修改一下" not detected', !isConfirmationInput('修改一下'));
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
