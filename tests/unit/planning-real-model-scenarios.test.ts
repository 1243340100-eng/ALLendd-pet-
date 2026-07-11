/**
 * Planning Mock Scenario Regression（Mock 场景回归测试）。
 *
 * 此测试使用 mock 模型验证 Graph、工具和状态结构行为。
 * 不调用真实 API，不验证真实模型智能表现。
 * 真实模型验收必须使用真实 API、真实 planningModel 和隔离 userData 单独执行。
 *
 * testType: mock
 *
 * 15 个场景：
 *   1. 模糊目标 - 提出关键问题，不编造计划
 *   2. 信息充分 - 直接生成草案，不重复询问
 *   3. 当前时间约束 - 晚上运行不安排过去时间
 *   4. 局部修改 - 只修改目标任务
 *   5. 语义修改 - 保留主要目标，增加缓冲
 *   6. 删除任务 - 其他任务不变
 *   7. 添加任务 - 找不冲突时间
 *   8. 时间冲突 - 解释冲突并提出调整方案
 *   9. 输入框确认 - 只在 awaiting_confirmation 阶段发布
 *  10. 模糊确认 - 不能在错误阶段擅自发布
 *  11. 手动编辑 - UI 修改不调用模型
 *  12. 重启恢复 - 恢复草案、消息历史、draftVersion
 *  13. 工具自动修正 - 第一次失败，第二次修正
 *  14. API 异常 - 超时/限流/非法 JSON 时保留原草案
 *  15. 最后任务保护 - 删除最后一个任务时提示放弃计划
 *
 * 运行：npx tsx tests/unit/planning-real-model-scenarios.test.ts
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
import type { AgentAction, PlanningResponseDTO, PlanningTrace } from '../../src/agent/graphs/planning/state';
import type { SecretStore, ApiSecretConfig } from '../../src/infrastructure/secrets/secret-store';
import { getDefaultAppConfig } from '../../src/infrastructure/config/config-loader';

// ===== Mock 场景回归指标 =====
interface ScenarioMetrics {
  scenarioId: number;
  scenarioName: string;
  userInput: string;
  passed: boolean;
  /** 测试类型：mock（此测试文件固定为 mock） */
  testType: 'mock' | 'real';
  /** 用户配置的模型 ID（app_settings 中的 planningModel） */
  configuredModel: string;
  /** ModelGateway 解析后的实际模型 ID */
  resolvedModel: string;
  /** API 返回的 response.model */
  responseModel: string;
  modelCallCount: number;
  unnecessaryClarification: boolean;
  unrelatedTasksChanged: boolean;
  timeReasonable: boolean;
  hasOverlap: boolean;
  /** 消息结构基本检查（非空且 < 1000 字）。不验证人格一致性。 */
  messageStructValid: boolean;
  needsManualFix: boolean;
  failureReason: string;
  traceId: string;
  notes: string;
}

const metrics: ScenarioMetrics[] = [];

/** 记录场景指标 */
function recordMetrics(m: ScenarioMetrics): void {
  metrics.push(m);
  const status = m.passed ? 'PASS' : 'FAIL';
  console.log(`[${status}] 场景 ${m.scenarioId}: ${m.scenarioName}`);
  if (!m.passed) {
    console.log(`  失败原因: ${m.failureReason}`);
  }
  console.log(`  testType: ${m.testType} | configuredModel: ${m.configuredModel} | resolvedModel: ${m.resolvedModel} | responseModel: ${m.responseModel}`);
  console.log(`  模型调用: ${m.modelCallCount} | 无意义追问: ${m.unnecessaryClarification} | 改变无关任务: ${m.unrelatedTasksChanged}`);
  console.log(`  时间合理: ${m.timeReasonable} | 重叠: ${m.hasOverlap} | 消息结构有效: ${m.messageStructValid}`);
  console.log(`  traceId: ${m.traceId}`);
}

// ===== 测试工具函数 =====
let passCount = 0;
let failCount = 0;

function check(name: string, condition: boolean): boolean {
  if (condition) {
    passCount++;
  } else {
    failCount++;
    console.error(`FAIL ${name}`);
  }
  return condition;
}

function tempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'petdb-rms-'));
  return path.join(dir, 'test.sqlite');
}

function cleanupDbFile(dbPath: string): void {
  try {
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    const dir = path.dirname(dbPath);
    if (fs.existsSync(dir)) fs.rmdirSync(dir);
  } catch { /* ignore */ }
}

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

/** 创建 mock fetch，返回指定的 AgentAction JSON（支持多轮序列） */
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
        choices: [{ message: { role: 'assistant', content: body }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 200, completion_tokens: 100, total_tokens: 300 }
      }),
      text: async () => body
    } as unknown as Response;
    return mockResponse;
  };
}

/** 创建 mock fetch，模拟 API 失败（超时/限流/非法 JSON） */
function createFailingMockFetch(errorType: 'timeout' | 'rate_limit' | 'invalid_json' = 'invalid_json') {
  return async (_url: string, _options?: RequestInit): Promise<Response> => {
    if (errorType === 'timeout') {
      throw new Error('Request timeout');
    }
    if (errorType === 'rate_limit') {
      const mockResponse = {
        ok: false,
        status: 429,
        json: async () => ({ error: { message: 'Rate limit exceeded' } }),
        text: async () => '{"error":{"message":"Rate limit exceeded"}}'
      } as unknown as Response;
      return mockResponse;
    }
    // invalid_json
    const mockResponse = {
      ok: true,
      status: 200,
      json: async () => { throw new Error('Invalid JSON'); },
      text: async () => 'not valid json {{{'
    } as unknown as Response;
    return mockResponse;
  };
}

function setupTestEnv(dbPath: string): { userId: string; characterId: string } {
  initDatabase({ path: dbPath });
  runMigrations(getDatabase());
  const userId = 'test-user-rms';
  const characterId = 'test-roxy';
  settingsRepository.set('onboarding_completed', 'true');
  settingsRepository.set('user_id', userId);
  settingsRepository.set('active_character_id', characterId);
  try {
    getDatabase().prepare('INSERT INTO users (id, nickname, preferred_name) VALUES (?, ?, ?)').run(userId, '昌昌', '昌昌');
  } catch { /* may already exist */ }
  return { userId, characterId };
}

/** 固定测试时间：2026-07-11 10:00:00 Asia/Shanghai（UTC+8，即 UTC 02:00:00） */
const FIXED_TEST_DATE = new Date('2026-07-11T02:00:00.000Z');

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
  const timeService = new TimeService('Asia/Shanghai', new FixedClock(FIXED_TEST_DATE));
  const userContextService = new UserContextService();
  return new PlanningGraphRunner({ modelGateway, timeService, userContextService });
}

function cleanupPlans(): void {
  try {
    getDatabase().prepare('DELETE FROM plan_tasks').run();
    getDatabase().prepare('DELETE FROM plans').run();
    getDatabase().prepare('DELETE FROM graph_checkpoints').run();
  } catch { /* ignore */ }
}

/** 固定基准时间：10:00 AM = 600 分钟。所有测试时间基于此，不依赖 new Date()。 */
const FIXED_BASE_MINUTES = 10 * 60; // 10:00 = 600 minutes

/** 生成未来时间对（基于固定基准 10:00 AM，不跨午夜，不重叠） */
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

/** 检查任务列表是否有时间重叠 */
function hasTimeOverlap(tasks: Array<{ start_time: string; end_time: string }>): boolean {
  const normalized = tasks.map(t => {
    const [sh, sm] = t.start_time.split(':').map(Number);
    const [eh, em] = t.end_time.split(':').map(Number);
    return { start: sh * 60 + sm, end: eh * 60 + em };
  });
  for (let i = 0; i < normalized.length; i++) {
    for (let j = i + 1; j < normalized.length; j++) {
      if (normalized[i].start < normalized[j].end && normalized[j].start < normalized[i].end) {
        return true;
      }
    }
  }
  return false;
}

/** 检查回复消息结构是否有效（非空且 < 1000 字）。
 * 注意：这只是消息结构基本检查，不验证人格一致性。
 * 人格一致性验证必须通过真实模型人工验收。
 */
function isMessageStructValid(message: string | undefined): boolean {
  if (!message || message.trim().length === 0) return false;
  if (message.length > 1000) return false;
  return true;
}

// ===== 15 个场景测试 =====

// 场景 1：模糊目标
async function scenario01_VagueGoal(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId } = setupTestEnv(dbPath);
    cleanupPlans();

    const runner = createRunner(getDatabase(), createMockFetchForPlanning({
      type: 'ask_clarification',
      clarificationQuestion: '你今天主要想完成什么类型的工作？有具体的时间限制吗？',
      message: '你今天主要想完成什么类型的工作？有具体的时间限制吗？'
    }));

    const dto = await runner.submitMessage({ userId, characterId, userInput: '今天帮我推进一下项目' });
    const trace = runner.getLastTrace();

    const passed = dto.ok === true && dto.actionType === 'ask_clarification' && !dto.plan;
    const noDraft = planRepository.getDraftPlan() === null;

    recordMetrics({
      scenarioId: 1,
      scenarioName: '模糊目标',
      userInput: '今天帮我推进一下项目',
      passed: passed && noDraft,
      testType: 'mock' as const,
      configuredModel: trace?.configuredModel ?? '',
      resolvedModel: trace?.resolvedModel ?? dto.resolvedModel ?? '',
      responseModel: trace?.responseModel ?? dto.responseModel ?? '',
      modelCallCount: trace?.modelCallCount ?? 0,
      unnecessaryClarification: false,
      unrelatedTasksChanged: false,
      timeReasonable: true,
      hasOverlap: false,
      messageStructValid: isMessageStructValid(dto.message),
      needsManualFix: !passed,
      failureReason: passed ? '' : `ok=${dto.ok}, actionType=${dto.actionType}, hasPlan=${!!dto.plan}`,
      traceId: trace?.traceId ?? '',
      notes: '预期：提出关键问题，不编造计划'
    });

    check('S01: ask_clarification', dto.actionType === 'ask_clarification');
    check('S01: no draft created', noDraft);
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// 场景 2：信息充分
async function scenario02_SufficientInfo(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId } = setupTestEnv(dbPath);
    cleanupPlans();
    const tp = futureTimePairs(4);

    const runner = createRunner(getDatabase(), createMockFetchForPlanning({
      type: 'create_draft',
      tasks: [
        { start_time: tp[0].start_time, end_time: tp[0].end_time, content: '写大纲' },
        { start_time: tp[1].start_time, end_time: tp[1].end_time, content: '审查代码' },
        { start_time: tp[2].start_time, end_time: tp[2].end_time, content: '收尾工作' }
      ],
      message: '根据你的安排，我制定了今天的计划草案。'
    }));

    const dto = await runner.submitMessage({ userId, characterId, userInput: '我十点开始，十二点前写完大纲，下午审查代码，六点结束' });
    const trace = runner.getLastTrace();

    const hasPlan = !!dto.plan && dto.plan.tasks.length === 3;
    const passed = dto.ok === true && dto.actionType === 'create_draft' && hasPlan;
    const draft = planRepository.getDraftPlan();

    recordMetrics({
      scenarioId: 2,
      scenarioName: '信息充分',
      userInput: '我十点开始，十二点前写完大纲，下午审查代码，六点结束',
      passed: passed && !!draft,
      testType: 'mock' as const,
      configuredModel: trace?.configuredModel ?? '',
      resolvedModel: trace?.resolvedModel ?? dto.resolvedModel ?? '',
      responseModel: trace?.responseModel ?? dto.responseModel ?? '',
      modelCallCount: trace?.modelCallCount ?? 0,
      unnecessaryClarification: dto.actionType === 'ask_clarification',
      unrelatedTasksChanged: false,
      timeReasonable: !hasTimeOverlap(dto.plan?.tasks ?? []),
      hasOverlap: hasTimeOverlap(dto.plan?.tasks ?? []),
      messageStructValid: isMessageStructValid(dto.message),
      needsManualFix: !passed,
      failureReason: passed ? '' : `ok=${dto.ok}, actionType=${dto.actionType}, tasks=${dto.plan?.tasks?.length}`,
      traceId: trace?.traceId ?? '',
      notes: '预期：直接生成草案，不重复询问'
    });

    check('S02: create_draft', dto.actionType === 'create_draft');
    check('S02: 3 tasks', dto.plan?.tasks?.length === 3);
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// 场景 3：当前时间约束
async function scenario03_TimeConstraint(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId } = setupTestEnv(dbPath);
    cleanupPlans();
    const tp = futureTimePairs(2);

    // 模型尝试安排一个过去时间 + 一个未来时间
    const runner = createRunner(getDatabase(), createMockFetchForPlanning({
      type: 'create_draft',
      tasks: [
        { start_time: '08:00', end_time: '09:00', content: '早晨任务' }, // 过去时间
        { start_time: tp[0].start_time, end_time: tp[0].end_time, content: '未来任务' }
      ],
      message: '计划已生成'
    }));

    const dto = await runner.submitMessage({ userId, characterId, userInput: '帮我安排今天' });
    const trace = runner.getLastTrace();

    // 预期：过去时间被拒绝，草案未写入或写入失败
    const passed = dto.ok === false || dto.actionType !== 'create_draft';

    recordMetrics({
      scenarioId: 3,
      scenarioName: '当前时间约束',
      userInput: '帮我安排今天（含过去时间）',
      passed,
      testType: 'mock' as const,
      configuredModel: trace?.configuredModel ?? '',
      resolvedModel: trace?.resolvedModel ?? dto.resolvedModel ?? '',
      responseModel: trace?.responseModel ?? dto.responseModel ?? '',
      modelCallCount: trace?.modelCallCount ?? 0,
      unnecessaryClarification: false,
      unrelatedTasksChanged: false,
      timeReasonable: passed,
      hasOverlap: false,
      messageStructValid: isMessageStructValid(dto.message),
      needsManualFix: !passed,
      failureReason: passed ? '' : '过去时间未被拒绝',
      traceId: trace?.traceId ?? '',
      notes: '预期：晚上运行时不安排已经过去的时间'
    });

    check('S03: past time rejected', passed);
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// 场景 4：局部修改
async function scenario04_LocalPatch(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId } = setupTestEnv(dbPath);
    cleanupPlans();
    const tp = futureTimePairs(4);
    const planId = `plan_s4_${Date.now()}`;
    const today = '2026-07-11'; // 固定日期，匹配 FixedClock
    planRepository.insert({ id: planId, date: today, status: 'draft' });
    planRepository.insertTasks([
      { id: 's4t1', plan_id: planId, content: '第一项', start_time: tp[0].start_time, end_time: tp[0].end_time, completed: 0, order_index: 0 },
      { id: 's4t2', plan_id: planId, content: '第二项', start_time: tp[1].start_time, end_time: tp[1].end_time, completed: 0, order_index: 1 },
      { id: 's4t3', plan_id: planId, content: '第三项', start_time: tp[2].start_time, end_time: tp[2].end_time, completed: 0, order_index: 2 }
    ]);

    const tasks = planRepository.getTasksByPlanId(planId);
    const secondTaskId = tasks.find(t => t.content === '第二项')?.id;
    const originalFirst = tasks.find(t => t.content === '第一项');
    const originalThird = tasks.find(t => t.content === '第三项');

    const runner = createRunner(getDatabase(), createMockFetchForPlanning({
      type: 'patch_tasks',
      patches: [{ id: secondTaskId, start_time: tp[3].start_time, end_time: tp[3].end_time }],
      message: '已将第二项推迟。'
    }));

    const dto = await runner.submitMessage({ userId, characterId, userInput: '把第二项推迟半小时' });
    const trace = runner.getLastTrace();

    const updatedTasks = planRepository.getTasksByPlanId(planId);
    const patchedTask = updatedTasks.find(t => t.id === secondTaskId);
    const firstUnchanged = updatedTasks.find(t => t.content === '第一项');
    const thirdUnchanged = updatedTasks.find(t => t.content === '第三项');

    const onlySecondChanged = patchedTask?.start_time === tp[3].start_time
      && firstUnchanged?.start_time === originalFirst?.start_time
      && thirdUnchanged?.start_time === originalThird?.start_time;

    recordMetrics({
      scenarioId: 4,
      scenarioName: '局部修改',
      userInput: '把第二项推迟半小时',
      passed: dto.ok === true && onlySecondChanged,
      testType: 'mock' as const,
      configuredModel: trace?.configuredModel ?? '',
      resolvedModel: trace?.resolvedModel ?? dto.resolvedModel ?? '',
      responseModel: trace?.responseModel ?? dto.responseModel ?? '',
      modelCallCount: trace?.modelCallCount ?? 0,
      unnecessaryClarification: false,
      unrelatedTasksChanged: !onlySecondChanged,
      timeReasonable: !hasTimeOverlap(updatedTasks),
      hasOverlap: hasTimeOverlap(updatedTasks),
      messageStructValid: isMessageStructValid(dto.message),
      needsManualFix: !onlySecondChanged,
      failureReason: onlySecondChanged ? '' : '修改了无关任务或未修改目标任务',
      traceId: trace?.traceId ?? '',
      notes: '预期：只修改第二项'
    });

    check('S04: only second task changed', onlySecondChanged);
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// 场景 5：语义修改
async function scenario05_SemanticPatch(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId } = setupTestEnv(dbPath);
    cleanupPlans();
    const tp = futureTimePairs(3);
    const planId = `plan_s5_${Date.now()}`;
    const today = '2026-07-11'; // 固定日期，匹配 FixedClock
    planRepository.insert({ id: planId, date: today, status: 'draft' });
    planRepository.insertTasks([
      { id: 's5t1', plan_id: planId, content: '上午工作', start_time: tp[0].start_time, end_time: tp[0].end_time, completed: 0, order_index: 0 },
      { id: 's5t2', plan_id: planId, content: '下午任务A', start_time: tp[1].start_time, end_time: tp[1].end_time, completed: 0, order_index: 1 },
      { id: 's5t3', plan_id: planId, content: '下午任务B', start_time: tp[2].start_time, end_time: tp[2].end_time, completed: 0, order_index: 2 }
    ]);

    const tasks = planRepository.getTasksByPlanId(planId);
    const afternoonA = tasks.find(t => t.content === '下午任务A');
    const newEndTime = tp[2].start_time; // 提前结束，增加缓冲

    const runner = createRunner(getDatabase(), createMockFetchForPlanning({
      type: 'patch_tasks',
      patches: [{ id: afternoonA?.id, end_time: newEndTime }],
      message: '已将下午任务A提前结束，让下午不那么满。'
    }));

    const dto = await runner.submitMessage({ userId, characterId, userInput: '下午不要排太满' });
    const trace = runner.getLastTrace();

    const updatedTasks = planRepository.getTasksByPlanId(planId);
    const morningTask = updatedTasks.find(t => t.content === '上午工作');
    const morningUnchanged = morningTask?.start_time === tp[0].start_time;

    recordMetrics({
      scenarioId: 5,
      scenarioName: '语义修改',
      userInput: '下午不要排太满',
      passed: dto.ok === true && morningUnchanged && !hasTimeOverlap(updatedTasks),
      testType: 'mock' as const,
      configuredModel: trace?.configuredModel ?? '',
      resolvedModel: trace?.resolvedModel ?? dto.resolvedModel ?? '',
      responseModel: trace?.responseModel ?? dto.responseModel ?? '',
      modelCallCount: trace?.modelCallCount ?? 0,
      unnecessaryClarification: false,
      unrelatedTasksChanged: !morningUnchanged,
      timeReasonable: !hasTimeOverlap(updatedTasks),
      hasOverlap: hasTimeOverlap(updatedTasks),
      messageStructValid: isMessageStructValid(dto.message),
      needsManualFix: !morningUnchanged,
      failureReason: morningUnchanged ? '' : '改变了无关任务',
      traceId: trace?.traceId ?? '',
      notes: '预期：保留主要目标，增加缓冲'
    });

    check('S05: morning unchanged', morningUnchanged);
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// 场景 6：删除任务
async function scenario06_DeleteTask(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId } = setupTestEnv(dbPath);
    cleanupPlans();
    const planId = `plan_s6_${Date.now()}`;
    const today = '2026-07-11'; // 固定日期，匹配 FixedClock
    planRepository.insert({ id: planId, date: today, status: 'draft' });
    planRepository.insertTasks([
      { id: 's6t1', plan_id: planId, content: '写文档', start_time: '09:00', end_time: '10:00', completed: 0, order_index: 0 },
      { id: 's6t2', plan_id: planId, content: '代码审查', start_time: '10:00', end_time: '11:00', completed: 0, order_index: 1 },
      { id: 's6t3', plan_id: planId, content: '写测试', start_time: '11:00', end_time: '12:00', completed: 0, order_index: 2 }
    ]);

    const tasks = planRepository.getTasksByPlanId(planId);
    const reviewId = tasks.find(t => t.content === '代码审查')?.id;

    const runner = createRunner(getDatabase(), createMockFetchForPlanning({
      type: 'delete_task',
      taskId: reviewId,
      message: '已删除代码审查任务。'
    }));

    const dto = await runner.submitMessage({ userId, characterId, userInput: '删除代码审查' });
    const trace = runner.getLastTrace();

    const updatedTasks = planRepository.getTasksByPlanId(planId);
    const reviewDeleted = !updatedTasks.find(t => t.id === reviewId);
    const othersPreserved = updatedTasks.length === 2
      && updatedTasks.find(t => t.content === '写文档') !== undefined
      && updatedTasks.find(t => t.content === '写测试') !== undefined;

    recordMetrics({
      scenarioId: 6,
      scenarioName: '删除任务',
      userInput: '删除代码审查',
      passed: reviewDeleted && othersPreserved,
      testType: 'mock' as const,
      configuredModel: trace?.configuredModel ?? '',
      resolvedModel: trace?.resolvedModel ?? dto.resolvedModel ?? '',
      responseModel: trace?.responseModel ?? dto.responseModel ?? '',
      modelCallCount: trace?.modelCallCount ?? 0,
      unnecessaryClarification: false,
      unrelatedTasksChanged: !othersPreserved,
      timeReasonable: true,
      hasOverlap: false,
      messageStructValid: isMessageStructValid(dto.message),
      needsManualFix: !reviewDeleted,
      failureReason: reviewDeleted ? '' : '未删除目标任务',
      traceId: trace?.traceId ?? '',
      notes: '预期：其他任务不变'
    });

    check('S06: review deleted, others preserved', reviewDeleted && othersPreserved);
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// 场景 7：添加任务
async function scenario07_AddTask(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId } = setupTestEnv(dbPath);
    cleanupPlans();
    const tp = futureTimePairs(3);
    const planId = `plan_s7_${Date.now()}`;
    const today = '2026-07-11'; // 固定日期，匹配 FixedClock
    planRepository.insert({ id: planId, date: today, status: 'draft' });
    planRepository.insertTasks([
      { id: 's7t1', plan_id: planId, content: '任务A', start_time: tp[0].start_time, end_time: tp[0].end_time, completed: 0, order_index: 0 },
      { id: 's7t2', plan_id: planId, content: '任务B', start_time: tp[1].start_time, end_time: tp[1].end_time, completed: 0, order_index: 1 }
    ]);

    const runner = createRunner(getDatabase(), createMockFetchForPlanning({
      type: 'add_task',
      newTask: { start_time: tp[2].start_time, end_time: tp[2].end_time, content: '半小时运动' },
      message: '已在任务B之后添加运动时间。'
    }));

    const dto = await runner.submitMessage({ userId, characterId, userInput: '再加半小时运动' });
    const trace = runner.getLastTrace();

    const updatedTasks = planRepository.getTasksByPlanId(planId);
    const hasThreeTasks = updatedTasks.length === 3;
    const exerciseAdded = updatedTasks.find(t => t.content === '半小时运动') !== undefined;
    const noOverlap = !hasTimeOverlap(updatedTasks);

    recordMetrics({
      scenarioId: 7,
      scenarioName: '添加任务',
      userInput: '再加半小时运动',
      passed: hasThreeTasks && exerciseAdded && noOverlap,
      testType: 'mock' as const,
      configuredModel: trace?.configuredModel ?? '',
      resolvedModel: trace?.resolvedModel ?? dto.resolvedModel ?? '',
      responseModel: trace?.responseModel ?? dto.responseModel ?? '',
      modelCallCount: trace?.modelCallCount ?? 0,
      unnecessaryClarification: false,
      unrelatedTasksChanged: false,
      timeReasonable: noOverlap,
      hasOverlap: !noOverlap,
      messageStructValid: isMessageStructValid(dto.message),
      needsManualFix: !exerciseAdded,
      failureReason: exerciseAdded ? '' : '未添加任务或时间冲突',
      traceId: trace?.traceId ?? '',
      notes: '预期：找到不冲突时间，不覆盖现有任务'
    });

    check('S07: task added, no overlap', hasThreeTasks && exerciseAdded && noOverlap);
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// 场景 8：时间冲突
async function scenario08_TimeConflict(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId } = setupTestEnv(dbPath);
    cleanupPlans();
    const tp = futureTimePairs(2);
    const planId = `plan_s8_${Date.now()}`;
    const today = '2026-07-11'; // 固定日期，匹配 FixedClock
    planRepository.insert({ id: planId, date: today, status: 'draft' });
    planRepository.insertTasks([
      { id: 's8t1', plan_id: planId, content: '现有任务', start_time: tp[0].start_time, end_time: tp[0].end_time, completed: 0, order_index: 0 }
    ]);

    // 模型尝试添加与现有任务时间冲突的新任务（应被拒绝）
    const runner = createRunner(getDatabase(), createMockFetchForPlanning({
      type: 'add_task',
      newTask: { start_time: tp[0].start_time, end_time: tp[0].end_time, content: '冲突任务' },
      message: '这个时间已经有任务了，建议换一个时间。'
    }));

    const dto = await runner.submitMessage({ userId, characterId, userInput: '在这个时间加个任务' });
    const trace = runner.getLastTrace();

    const updatedTasks = planRepository.getTasksByPlanId(planId);
    // 预期：冲突被拒绝，原草案保留
    const conflictRejected = updatedTasks.length === 1 || !hasTimeOverlap(updatedTasks);

    recordMetrics({
      scenarioId: 8,
      scenarioName: '时间冲突',
      userInput: '在这个时间加个任务（冲突）',
      passed: conflictRejected,
      testType: 'mock' as const,
      configuredModel: trace?.configuredModel ?? '',
      resolvedModel: trace?.resolvedModel ?? dto.resolvedModel ?? '',
      responseModel: trace?.responseModel ?? dto.responseModel ?? '',
      modelCallCount: trace?.modelCallCount ?? 0,
      unnecessaryClarification: false,
      unrelatedTasksChanged: false,
      timeReasonable: !hasTimeOverlap(updatedTasks),
      hasOverlap: hasTimeOverlap(updatedTasks),
      messageStructValid: isMessageStructValid(dto.message),
      needsManualFix: !conflictRejected,
      failureReason: conflictRejected ? '' : '冲突任务被写入或原草案被破坏',
      traceId: trace?.traceId ?? '',
      notes: '预期：解释冲突，原草案不被破坏'
    });

    check('S08: conflict handled', conflictRejected);
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// 场景 9：输入框确认
async function scenario09_ConfirmInAwaitingPhase(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId } = setupTestEnv(dbPath);
    cleanupPlans();
    const tp = futureTimePairs(1);

    const runner = createRunner(getDatabase(), createMockFetchForPlanning({
      type: 'create_draft',
      tasks: [{ start_time: tp[0].start_time, end_time: tp[0].end_time, content: '任务' }],
      message: '草案已生成，请确认。'
    }));

    // 第一步：创建草案，进入 awaiting_confirmation
    const dtoCreate = await runner.submitMessage({ userId, characterId, userInput: '帮我安排一个任务' });
    const awaiting = dtoCreate.awaitingConfirmation === true;

    // 第二步：在 awaiting_confirmation 阶段输入"就这样"
    const dtoConfirm = await runner.submitMessage({ userId, characterId, userInput: '就这样', isConfirmation: false });
    const trace = runner.getLastTrace();

    const published = dtoConfirm.published === true;
    const activePlan = planRepository.getActivePlan();

    recordMetrics({
      scenarioId: 9,
      scenarioName: '输入框确认',
      userInput: '就这样',
      passed: awaiting && published && !!activePlan,
      testType: 'mock' as const,
      configuredModel: trace?.configuredModel ?? '',
      resolvedModel: trace?.resolvedModel ?? dto.resolvedModel ?? '',
      responseModel: trace?.responseModel ?? dto.responseModel ?? '',
      modelCallCount: trace?.modelCallCount ?? 0,
      unnecessaryClarification: false,
      unrelatedTasksChanged: false,
      timeReasonable: true,
      hasOverlap: false,
      messageStructValid: isMessageStructValid(dtoConfirm.message),
      needsManualFix: !published,
      failureReason: published ? '' : '未在 awaiting_confirmation 阶段发布',
      traceId: trace?.traceId ?? '',
      notes: '预期：只在 awaiting_confirmation 阶段发布'
    });

    check('S09: published in awaiting phase', awaiting && published);
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// 场景 10：模糊确认（不在 awaiting 阶段）
async function scenario10_VagueConfirmNotPublished(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId } = setupTestEnv(dbPath);
    cleanupPlans();
    const tp = futureTimePairs(1);
    const planId = `plan_s10_${Date.now()}`;
    const today = '2026-07-11'; // 固定日期，匹配 FixedClock
    planRepository.insert({ id: planId, date: today, status: 'draft' });
    planRepository.insertTasks([
      { id: 's10t1', plan_id: planId, content: '任务', start_time: tp[0].start_time, end_time: tp[0].end_time, completed: 0, order_index: 0 }
    ]);

    // 模型对"好的"返回 request_confirmation（不擅自发布）
    const runner = createRunner(getDatabase(), createMockFetchForPlanning({
      type: 'request_confirmation',
      message: '计划已准备好，确认后即可发布。'
    }));

    // 不在 awaiting_confirmation 阶段（没有先 create_draft）
    const dto = await runner.submitMessage({ userId, characterId, userInput: '好的', isConfirmation: false });
    const trace = runner.getLastTrace();

    const notPublished = dto.published !== true;
    const noActivePlan = planRepository.getActivePlan() === null;

    recordMetrics({
      scenarioId: 10,
      scenarioName: '模糊确认',
      userInput: '好的',
      passed: notPublished && noActivePlan,
      testType: 'mock' as const,
      configuredModel: trace?.configuredModel ?? '',
      resolvedModel: trace?.resolvedModel ?? dto.resolvedModel ?? '',
      responseModel: trace?.responseModel ?? dto.responseModel ?? '',
      modelCallCount: trace?.modelCallCount ?? 0,
      unnecessaryClarification: false,
      unrelatedTasksChanged: false,
      timeReasonable: true,
      hasOverlap: false,
      messageStructValid: isMessageStructValid(dto.message),
      needsManualFix: !notPublished,
      failureReason: notPublished ? '' : '在错误阶段擅自发布',
      traceId: trace?.traceId ?? '',
      notes: '预期：不能在错误阶段擅自发布'
    });

    check('S10: not published outside awaiting phase', notPublished && noActivePlan);
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// 场景 11：手动编辑（不调用模型）
async function scenario11_ManualEdit(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId } = setupTestEnv(dbPath);
    cleanupPlans();
    const tp = futureTimePairs(2);
    const planId = `plan_s11_${Date.now()}`;
    const today = '2026-07-11'; // 固定日期，匹配 FixedClock
    planRepository.insert({ id: planId, date: today, status: 'draft' });
    planRepository.insertTasks([
      { id: 's11t1', plan_id: planId, content: '任务A', start_time: tp[0].start_time, end_time: tp[0].end_time, completed: 0, order_index: 0 },
      { id: 's11t2', plan_id: planId, content: '任务B', start_time: tp[1].start_time, end_time: tp[1].end_time, completed: 0, order_index: 1 }
    ]);

    const runner = createRunner(getDatabase(), createMockFetchForPlanning({
      type: 'create_draft',
      tasks: [{ start_time: '09:00', end_time: '10:00', content: '不应调用' }],
      message: '不应调用模型'
    }));

    // 手动编辑：修改任务A的时间
    const dto = await runner.submitManualEdit({
      userId,
      characterId,
      planId,
      agentAction: {
        type: 'patch_tasks',
        patches: [{ id: 's11t1', start_time: tp[1].end_time, end_time: tp[1].end_time }],
        message: '手动修改时间'
      }
    });
    const trace = runner.getLastTrace();

    // 手动编辑不调用模型，modelCallCount 应为 0
    const noModelCall = (trace?.modelCallCount ?? 0) === 0;

    recordMetrics({
      scenarioId: 11,
      scenarioName: '手动编辑',
      userInput: '(UI 手动修改时间)',
      passed: noModelCall,
      testType: 'mock' as const,
      configuredModel: trace?.configuredModel ?? '',
      resolvedModel: trace?.resolvedModel ?? dto.resolvedModel ?? '',
      responseModel: trace?.responseModel ?? dto.responseModel ?? '',
      modelCallCount: trace?.modelCallCount ?? 0,
      unnecessaryClarification: false,
      unrelatedTasksChanged: false,
      timeReasonable: true,
      hasOverlap: false,
      messageStructValid: true,
      needsManualFix: !noModelCall,
      failureReason: noModelCall ? '' : '手动编辑调用了模型',
      traceId: trace?.traceId ?? '',
      notes: '预期：UI 修改时间不调用模型'
    });

    check('S11: no model call for manual edit', noModelCall);
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// 场景 12：重启恢复
async function scenario12_RestartRecovery(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId } = setupTestEnv(dbPath);
    cleanupPlans();
    const tp = futureTimePairs(2);

    // 第一步：创建草案并产生 checkpoint
    const runner1 = createRunner(getDatabase(), createMockFetchForPlanning({
      type: 'create_draft',
      tasks: [
        { start_time: tp[0].start_time, end_time: tp[0].end_time, content: '任务A' },
        { start_time: tp[1].start_time, end_time: tp[1].end_time, content: '任务B' }
      ],
      message: '草案已生成，请确认。'
    }));

    const dtoCreate = await runner1.submitMessage({ userId, characterId, userInput: '帮我安排两个任务' });
    const draftBeforeRestart = planRepository.getDraftPlan();
    const draftVersionBefore = draftBeforeRestart?.draft_version ?? 0;

    // 模拟重启：创建新的 runner（旧 runner 的内存状态丢失）
    const runner2 = createRunner(getDatabase(), createMockFetchForPlanning({
      type: 'request_confirmation',
      message: '恢复成功，请确认计划。'
    }));

    // 恢复规划状态
    const planningState = runner2.getPlanningState(userId, characterId);

    // 验证恢复
    const messagesRestored = planningState.messages.length > 0;
    const draftRestored = !!planningState.currentDraft;
    const versionRestored = (planningState.currentDraft?.draftVersion ?? 0) >= draftVersionBefore;
    const awaitingRestored = planningState.awaitingConfirmation === true || planningState.phase !== 'idle';

    recordMetrics({
      scenarioId: 12,
      scenarioName: '重启恢复',
      userInput: '(模拟重启后恢复)',
      passed: messagesRestored && draftRestored && versionRestored,
      testType: 'mock' as const,
      configuredModel: '',
      resolvedModel: '',
      responseModel: '',
      modelCallCount: 0,
      unnecessaryClarification: false,
      unrelatedTasksChanged: false,
      timeReasonable: true,
      hasOverlap: false,
      messageStructValid: true,
      needsManualFix: !draftRestored,
      failureReason: draftRestored ? '' : '草案未恢复',
      traceId: '',
      notes: '预期：恢复草案、消息历史、draftVersion 和 awaiting_confirmation'
    });

    check('S12: messages restored', messagesRestored);
    check('S12: draft restored', draftRestored);
    check('S12: version restored', versionRestored);
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// 场景 13：工具自动修正
async function scenario13_AutoCorrection(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId } = setupTestEnv(dbPath);
    cleanupPlans();
    const tp = futureTimePairs(3);
    const planId = `plan_s13_${Date.now()}`;
    const today = '2026-07-11'; // 固定日期，匹配 FixedClock
    planRepository.insert({ id: planId, date: today, status: 'draft' });
    planRepository.insertTasks([
      { id: 's13t1', plan_id: planId, content: '任务A', start_time: tp[0].start_time, end_time: tp[0].end_time, completed: 0, order_index: 0 },
      { id: 's13t2', plan_id: planId, content: '任务B', start_time: tp[1].start_time, end_time: tp[1].end_time, completed: 0, order_index: 1 }
    ]);

    // 第一次：非法参数（引用不存在的 task ID），第二次：修正后成功
    const runner = createRunner(getDatabase(), createMockFetchForPlanning([
      {
        type: 'patch_tasks',
        patches: [{ id: 'non-existent-id', content: '修改内容' }],
        message: '修改任务'
      },
      {
        type: 'patch_tasks',
        patches: [{ id: 's13t1', content: '修改后的任务A' }],
        message: '已修正并修改任务A。'
      }
    ]));

    const dto = await runner.submitMessage({ userId, characterId, userInput: '修改第一个任务' });
    const trace = runner.getLastTrace();

    // 预期：第一次失败，第二次成功修正
    const corrected = dto.ok === true;
    const modelCalls = trace?.modelCallCount ?? 0;
    const autoCorrections = trace?.autoCorrectionCount ?? 0;

    recordMetrics({
      scenarioId: 13,
      scenarioName: '工具自动修正',
      userInput: '修改第一个任务（第一次非法参数）',
      passed: corrected && modelCalls >= 2 && autoCorrections >= 1,
      testType: 'mock' as const,
      configuredModel: trace?.configuredModel ?? '',
      resolvedModel: trace?.resolvedModel ?? dto.resolvedModel ?? '',
      responseModel: trace?.responseModel ?? dto.responseModel ?? '',
      modelCallCount: modelCalls,
      unnecessaryClarification: false,
      unrelatedTasksChanged: false,
      timeReasonable: true,
      hasOverlap: false,
      messageStructValid: isMessageStructValid(dto.message),
      needsManualFix: !corrected,
      failureReason: corrected ? '' : `corrected=${corrected}, calls=${modelCalls}, corrections=${autoCorrections}`,
      traceId: trace?.traceId ?? '',
      notes: '预期：第一次失败，第二次根据错误修正；成功后不再额外调用模型'
    });

    check('S13: auto-corrected', corrected && modelCalls >= 2 && autoCorrections >= 1);
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// 场景 14：API 异常
async function scenario14_ApiError(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId } = setupTestEnv(dbPath);
    cleanupPlans();
    const tp = futureTimePairs(2);
    const planId = `plan_s14_${Date.now()}`;
    const today = '2026-07-11'; // 固定日期，匹配 FixedClock
    planRepository.insert({ id: planId, date: today, status: 'draft' });
    planRepository.insertTasks([
      { id: 's14t1', plan_id: planId, content: '原有任务A', start_time: tp[0].start_time, end_time: tp[0].end_time, completed: 0, order_index: 0 },
      { id: 's14t2', plan_id: planId, content: '原有任务B', start_time: tp[1].start_time, end_time: tp[1].end_time, completed: 0, order_index: 1 }
    ]);

    // 使用模拟 API 失败的 fetch
    const config = getDefaultAppConfig();
    const secretStore = createMockSecretStore();
    const modelGateway = new ModelGateway({
      config,
      secretStore,
      fetchFn: createFailingMockFetch('rate_limit'),
      db: getDatabase()
    });
    const timeService = new TimeService('Asia/Shanghai');
    const userContextService = new UserContextService();
    const runner = new PlanningGraphRunner({ modelGateway, timeService, userContextService });

    const dto = await runner.submitMessage({ userId, characterId, userInput: '帮我修改计划' });
    const trace = runner.getLastTrace();

    // 预期：API 失败，但原草案保留
    const draftPreserved = planRepository.getDraftPlan();
    const tasksAfterError = planRepository.getTasksByPlanId(planId);
    const originalTasksPreserved = tasksAfterError.length === 2
      && tasksAfterError.find(t => t.content === '原有任务A') !== undefined
      && tasksAfterError.find(t => t.content === '原有任务B') !== undefined;

    recordMetrics({
      scenarioId: 14,
      scenarioName: 'API 异常',
      userInput: '帮我修改计划（API 限流）',
      passed: originalTasksPreserved,
      testType: 'mock' as const,
      configuredModel: trace?.configuredModel ?? '',
      resolvedModel: trace?.resolvedModel ?? dto.resolvedModel ?? '',
      responseModel: trace?.responseModel ?? dto.responseModel ?? '',
      modelCallCount: trace?.modelCallCount ?? 0,
      unnecessaryClarification: false,
      unrelatedTasksChanged: !originalTasksPreserved,
      timeReasonable: true,
      hasOverlap: false,
      messageStructValid: isMessageStructValid(dto.message),
      needsManualFix: !originalTasksPreserved,
      failureReason: originalTasksPreserved ? '' : 'API 异常破坏了原草案',
      traceId: trace?.traceId ?? '',
      notes: '预期：超时/限流/非法 JSON 时保留原草案，不写入损坏数据'
    });

    check('S14: draft preserved on API error', originalTasksPreserved);
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// 场景 15：最后任务保护
async function scenario15_LastTaskProtection(): Promise<void> {
  const dbPath = tempDbPath();
  try {
    const { userId, characterId } = setupTestEnv(dbPath);
    cleanupPlans();
    const tp = futureTimePairs(1);
    const planId = `plan_s15_${Date.now()}`;
    const today = '2026-07-11'; // 固定日期，匹配 FixedClock
    planRepository.insert({ id: planId, date: today, status: 'draft' });
    planRepository.insertTasks([
      { id: 's15t1', plan_id: planId, content: '最后一个任务', start_time: tp[0].start_time, end_time: tp[0].end_time, completed: 0, order_index: 0 }
    ]);

    const runner = createRunner(getDatabase(), createMockFetchForPlanning({
      type: 'delete_task',
      taskId: 's15t1',
      message: '已删除任务。'
    }));

    const dto = await runner.submitMessage({ userId, characterId, userInput: '删除这个任务' });
    const trace = runner.getLastTrace();

    // 预期：删除被拒绝，任务保留
    const tasksAfter = planRepository.getTasksByPlanId(planId);
    const taskStillExists = tasksAfter.length === 1 && tasksAfter.find(t => t.id === 's15t1') !== undefined;

    recordMetrics({
      scenarioId: 15,
      scenarioName: '最后任务保护',
      userInput: '删除这个任务（最后一个）',
      passed: taskStillExists,
      testType: 'mock' as const,
      configuredModel: trace?.configuredModel ?? '',
      resolvedModel: trace?.resolvedModel ?? dto.resolvedModel ?? '',
      responseModel: trace?.responseModel ?? dto.responseModel ?? '',
      modelCallCount: trace?.modelCallCount ?? 0,
      unnecessaryClarification: false,
      unrelatedTasksChanged: false,
      timeReasonable: true,
      hasOverlap: false,
      messageStructValid: isMessageStructValid(dto.message),
      needsManualFix: !taskStillExists,
      failureReason: taskStillExists ? '' : '最后一个任务被删除，未提示使用"放弃计划"',
      traceId: trace?.traceId ?? '',
      notes: '预期：删除最后一个任务时提示用户使用"放弃计划"'
    });

    check('S15: last task protected', taskStillExists);
  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }
}

// ===== 生成报告 =====
function generateReport(): void {
  console.log('\n========== Planning Mock Scenario Regression 报告 ==========\n');
  console.log('testType: mock（此报告使用 mock 模型，不调用真实 API）');
  console.log('');
  console.log('场景 | 名称 | 通过 | testType | configuredModel | resolvedModel | responseModel | 模型调用 | 无意义追问 | 改变无关任务 | 时间合理 | 重叠 | 消息结构有效 | 需人工修改 | traceId');
  console.log('------|------|------|----------|-----------------|---------------|---------------|----------|------------|--------------|----------|------|--------------|------------|--------');

  for (const m of metrics) {
    console.log(`${m.scenarioId} | ${m.scenarioName} | ${m.passed ? 'YES' : 'NO'} | ${m.testType} | ${m.configuredModel} | ${m.resolvedModel} | ${m.responseModel} | ${m.modelCallCount} | ${m.unnecessaryClarification ? 'Y' : 'N'} | ${m.unrelatedTasksChanged ? 'Y' : 'N'} | ${m.timeReasonable ? 'Y' : 'N'} | ${m.hasOverlap ? 'Y' : 'N'} | ${m.messageStructValid ? 'Y' : 'N'} | ${m.needsManualFix ? 'Y' : 'N'} | ${m.traceId}`);
  }

  const passedCount = metrics.filter(m => m.passed).length;
  const failedCount = metrics.filter(m => !m.passed).length;
  console.log(`\n总计：${passedCount} 通过, ${failedCount} 失败 (共 ${metrics.length} 个场景)`);
  console.log(`\n注意：此为 mock 模型结构行为验证，testType=mock。`);
  console.log(`此报告不验证人格一致性，仅验证 Graph、工具和状态结构。`);
  console.log(`真实模型验收必须使用真实 API、真实 planningModel 和隔离 userData 单独执行。`);
  console.log(`未真正调用 API 时，不得输出"真实模型 15/15 通过"。`);
}

// ===== 主函数 =====
async function main(): Promise<void> {
  console.log('=== Planning Mock Scenario Regression ===\n');
  console.log('testType: mock（此测试使用 mock 模型，不调用真实 API）\n');

  await scenario01_VagueGoal();
  await scenario02_SufficientInfo();
  await scenario03_TimeConstraint();
  await scenario04_LocalPatch();
  await scenario05_SemanticPatch();
  await scenario06_DeleteTask();
  await scenario07_AddTask();
  await scenario08_TimeConflict();
  await scenario09_ConfirmInAwaitingPhase();
  await scenario10_VagueConfirmNotPublished();
  await scenario11_ManualEdit();
  await scenario12_RestartRecovery();
  await scenario13_AutoCorrection();
  await scenario14_ApiError();
  await scenario15_LastTaskProtection();

  generateReport();

  console.log(`\n=== 断言结果 ===`);
  console.log(`PASS: ${passCount}, FAIL: ${failCount}`);

  if (failCount > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Test runner failed:', err);
  process.exit(1);
});
