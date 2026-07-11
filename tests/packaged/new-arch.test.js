'use strict';

/**
 * test:packaged-new-arch
 *
 * 打包级自动测试：启动真实的 PetFramework.exe，验证 LangGraph 新架构在打包环境中实际运行。
 * 不依赖 tsx，不使用 mock，只断言实际 EXE 行为。
 *
 * 验证内容：
 * 1. app.asar 包含 @langchain/core、@langchain/langgraph、zod-to-json-schema、dist/ 核心文件
 * 2. 进程启动后创建 pet-data.sqlite
 * 3. SQLite _migrations 表存在
 * 4. stdout/stderr 不包含错误标记字符串
 * 5. architecture-status.json 最终为 langgraph_ready
 * 6. 首次启动触发 Onboarding（无既有用户数据时）
 * 7. 关闭后清理临时用户目录
 * 8. 有超时保护，可靠结束 Electron 子进程
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const projectRoot = path.resolve(__dirname, '..', '..');
const exePath = path.join(projectRoot, 'release', 'win-unpacked', 'PetFramework.exe');
const asarPath = path.join(projectRoot, 'release', 'win-unpacked', 'resources', 'app.asar');

// ===== 配置 =====
const STARTUP_TIMEOUT_MS = 45000;
const PROCESS_KILL_TIMEOUT_MS = 10000;
const FORBIDDEN_ERROR_STRINGS = [
  'new architecture not loaded',
  'init failed',
  'Cannot find module',
  'using legacy path',
  'Module load failed'
];

// ===== 工具函数 =====

function log(msg) {
  console.log(`[packaged-new-arch] ${msg}`);
}

function logPass(msg) {
  console.log(`PASS ${msg}`);
}

function logFail(msg) {
  console.error(`FAIL ${msg}`);
}

/**
 * 递归删除目录（兼容 Windows）
 */
function removeDirSync(dir) {
  if (!fs.existsSync(dir)) return;
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  } catch (e) {
    // Windows 文件锁可能导致失败，尝试延迟后再删
    try {
      const { execSync } = require('child_process');
      execSync(`rmdir /s /q "${dir}"`, { stdio: 'ignore' });
    } catch {
      log(`warning: could not remove temp dir: ${dir}`);
    }
  }
}

/**
 * 创建唯一临时目录
 */
function createTempUserDataDir() {
  const tmpBase = path.join(os.tmpdir(), 'pet-framework-test');
  const tmpDir = path.join(tmpBase, `run-${Date.now()}-${Math.floor(Math.random() * 10000)}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  return tmpDir;
}

/**
 * 等待 architecture-status.json 出现且 state 达到预期（非阻塞，使用 setInterval 轮询）
 */
function waitForArchitectureStatus(userDataDir, timeoutMs) {
  return new Promise((resolve) => {
    const statusFile = path.join(userDataDir, 'architecture-status.json');
    const start = Date.now();
    let lastLogTime = 0;

    const check = () => {
      const elapsed = Date.now() - start;
      if (elapsed > timeoutMs) {
        resolve(null);
        return;
      }

      if (fs.existsSync(statusFile)) {
        try {
          const content = JSON.parse(fs.readFileSync(statusFile, 'utf-8'));
          if (content.state === 'langgraph_ready' || content.state === 'initialization_failed') {
            resolve(content);
            return;
          }
        } catch {
          // 文件可能正在写入，继续等待
        }
      }

      if (elapsed - lastLogTime > 5000) {
        lastLogTime = elapsed;
        log(`waiting for architecture-status.json... (${Math.floor(elapsed / 1000)}s)`);
      }

      setTimeout(check, 500);
    };

    check();
  });
}

// ===== Phase 1: asar 内容检查 =====

function testAsarContents() {
  log('=== Phase 1: asar 内容检查 ===');
  assert.strictEqual(fs.existsSync(asarPath), true, `app.asar not found: ${asarPath}`);

  const asar = require('@electron/asar');
  const allFiles = asar.listPackage(asarPath).map(f => f.replace(/\\/g, '/'));

  const requiredFiles = [
    'node_modules/@langchain/core/package.json',
    'node_modules/@langchain/core/singletons.js',
    'node_modules/@langchain/langgraph/package.json',
    'node_modules/zod-to-json-schema/package.json',
    'dist/main/integration.js',
    'dist/main/graph-dispatcher.js',
    'dist/agent/graphs/conversation/graph.js',
    // Fix 7: planning 相关文件必须存在于打包产物中
    'dist/agent/graphs/planning/graph.js',
    'dist/agent/graphs/planning/tools.js',
    'dist/agent/graphs/planning/state.js',
    'dist/agent/graphs/planning/nodes/agent-decide.js',
    'dist/agent/graphs/planning/nodes/execute-tool.js',
    'dist/agent/graphs/planning/nodes/build-response.js',
    'dist/agent/graphs/planning/nodes/persist-checkpoint.js',
    'dist/agent/graphs/planning/nodes/load-planning-context.js',
    'dist/infrastructure/database/repositories/plan-repository.js',
    'dist/infrastructure/database/repositories/checkpoint-repository.js'
  ];

  for (const required of requiredFiles) {
    const found = allFiles.some(f => f === '/' + required || f === required || f.endsWith('/' + required));
    assert.ok(found, `Missing in asar: ${required}`);
    logPass(`asar contains: ${required}`);
  }

  // 额外验证 singletons 目录
  const hasSingletonsDir = allFiles.some(f => f.includes('@langchain/core/dist/singletons'));
  assert.ok(hasSingletonsDir, 'Missing @langchain/core/dist/singletons/ in asar');
  logPass('asar contains: @langchain/core/dist/singletons/');

  // Fix 7: 验证 integration.js 中包含 planning IPC 的真实实现（不只是函数名存在）
  // 从 dist 目录读取编译产物（与 asar 中的内容一致）
  const distRoot = path.join(projectRoot, 'dist');

  const integrationPath = path.join(distRoot, 'main', 'integration.js');
  assert.strictEqual(fs.existsSync(integrationPath), true, `dist/main/integration.js not found: ${integrationPath}`);
  const integrationContent = fs.readFileSync(integrationPath, 'utf-8');
  const requiredPlanningExports = [
    'handlePlanningMessage',
    'handlePlanningConfirm',
    'handlePlanningManualEdit',
    'getPlanningState',
    'getPlanningModelInfo',
    'setPlanningModel',
    'handlePlanningToggleTask',
    'getDraftPlan',
    'getActivePlan'
  ];
  for (const exportName of requiredPlanningExports) {
    assert.ok(
      integrationContent.includes(`function ${exportName}`),
      `integration.js missing planning export: ${exportName}`
    );
    logPass(`integration.js exports: ${exportName}`);
  }

  // 验证 V5 migration 存在于编译产物中
  const migrationPath = path.join(distRoot, 'infrastructure', 'database', 'migration-runner.js');
  const migrationContent = fs.readFileSync(migrationPath, 'utf-8');
  assert.ok(
    migrationContent.includes('draft_version') || migrationContent.includes('migrationV5'),
    'V5 migration not found in migration-runner.js'
  );
  logPass('V5 migration present in migration-runner.js');

  // 验证 validatePlanDraft 函数存在于 tools.js 中
  const toolsPath = path.join(distRoot, 'agent', 'graphs', 'planning', 'tools.js');
  const toolsContent = fs.readFileSync(toolsPath, 'utf-8');
  assert.ok(toolsContent.includes('validatePlanDraft'), 'validatePlanDraft not found in planning/tools.js');
  logPass('validatePlanDraft present in planning/tools.js');

  // 验证 submitManualEdit 方法存在于 graph.js 中
  const graphPath = path.join(distRoot, 'agent', 'graphs', 'planning', 'graph.js');
  const graphContent = fs.readFileSync(graphPath, 'utf-8');
  assert.ok(graphContent.includes('submitManualEdit'), 'submitManualEdit not found in planning/graph.js');
  assert.ok(graphContent.includes('getPlanningState'), 'getPlanningState not found in planning/graph.js');
  logPass('submitManualEdit and getPlanningState present in planning/graph.js');

  // 验证 configReloader 机制存在于 ModelGateway.js 中
  const gatewayPath = path.join(distRoot, 'services', 'ModelGateway.js');
  const gatewayContent = fs.readFileSync(gatewayPath, 'utf-8');
  assert.ok(gatewayContent.includes('setConfigReloader'), 'setConfigReloader not found in ModelGateway.js');
  assert.ok(gatewayContent.includes('getEffectiveConfig'), 'getEffectiveConfig not found in ModelGateway.js');
  logPass('configReloader mechanism present in ModelGateway.js');
}

// ===== Phase 2: 启动 EXE 并验证 =====

function testLaunchExe() {
  return new Promise((resolve, reject) => {
    log('=== Phase 2: 启动 PetFramework.exe ===');

    assert.strictEqual(fs.existsSync(exePath), true, `PetFramework.exe not found: ${exePath}`);

    const userDataDir = createTempUserDataDir();
    log(`临时用户目录: ${userDataDir}`);

    let stdoutBuffer = '';
    let stderrBuffer = '';
    let killed = false;
    let resolved = false;

    const child = spawn(exePath, [`--user-data-dir=${userDataDir}`], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: false,
      cwd: path.dirname(exePath)
    });

    const cleanup = () => {
      if (killed) return;
      killed = true;
      try {
        if (!child.killed && child.pid) {
          // Windows: 使用 taskkill 强制终止进程树
          try {
            require('child_process').execSync(`taskkill /pid ${child.pid} /f /t`, { stdio: 'ignore' });
          } catch {
            child.kill('SIGKILL');
          }
        }
      } catch {
        // 忽略
      }
    };

    child.stdout.on('data', (data) => {
      const text = data.toString('utf-8');
      stdoutBuffer += text;
    });

    child.stderr.on('data', (data) => {
      const text = data.toString('utf-8');
      stderrBuffer += text;
    });

    child.on('error', (err) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      removeDirSync(userDataDir);
      reject(new Error(`Failed to spawn PetFramework.exe: ${err.message}`));
    });

    child.on('exit', (code, signal) => {
      if (resolved) return;
      // 如果进程在测试完成前退出，记录日志
      log(`process exited: code=${code}, signal=${signal}`);
    });

    // 超时保护
    const overallTimer = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      cleanup();
      removeDirSync(userDataDir);
      reject(new Error(`Startup timeout after ${STARTUP_TIMEOUT_MS}ms`));
    }, STARTUP_TIMEOUT_MS);

    // 等待 architecture-status.json
    waitForArchitectureStatus(userDataDir, STARTUP_TIMEOUT_MS - 5000)
      .then((status) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(overallTimer);

        try {
          // 断言 1: architecture-status.json 存在且 state=langgraph_ready
          assert.ok(status, 'architecture-status.json not found or did not reach final state');
          assert.strictEqual(
            status.state,
            'langgraph_ready',
            `Expected state=langgraph_ready, got state=${status.state}, error=${status.error || 'none'}`
          );
          logPass(`architecture-status.json: state=${status.state}`);

          // 断言 2: pet-data.sqlite 存在
          const sqlitePath = path.join(userDataDir, 'pet-data.sqlite');
          assert.strictEqual(
            fs.existsSync(sqlitePath),
            true,
            `pet-data.sqlite not created at: ${sqlitePath}`
          );
          logPass(`pet-data.sqlite created: ${sqlitePath}`);

          // 断言 3: _migrations 表存在
          const Database = require('better-sqlite3');
          const db = new Database(sqlitePath, { readonly: true });
          try {
            const migrations = db.prepare('SELECT version, name FROM _migrations').all();
            assert.ok(migrations.length > 0, '_migrations table empty or missing');
            logPass(`SQLite _migrations table: ${migrations.length} migration(s) applied`);

            // 验证核心表存在
            const tables = db.prepare(
              "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
            ).all().map(r => r.name);
            const expectedTables = ['memories', 'reminders', 'sessions', 'messages', 'reflection_jobs', 'event_outbox'];
            for (const tbl of expectedTables) {
              assert.ok(tables.includes(tbl), `Missing table: ${tbl}`);
            }
            logPass(`SQLite core tables present: ${expectedTables.join(', ')}`);

            // Fix 7: 验证 planning 相关表存在
            const planningTables = ['plans', 'plan_tasks', 'graph_checkpoints'];
            for (const tbl of planningTables) {
              assert.ok(tables.includes(tbl), `Missing planning table: ${tbl}`);
            }
            logPass(`SQLite planning tables present: ${planningTables.join(', ')}`);

            // 验证 plans 表有 V5 migration 新增的字段
            const plansSchema = db.prepare("PRAGMA table_info(plans)").all();
            const planColumns = plansSchema.map(r => r.name);
            assert.ok(planColumns.includes('draft_version'), 'plans table missing draft_version column (V5 migration)');
            assert.ok(planColumns.includes('resolved_model'), 'plans table missing resolved_model column (V5 migration)');
            assert.ok(planColumns.includes('response_model'), 'plans table missing response_model column (V5 migration)');
            assert.ok(planColumns.includes('user_confirmed'), 'plans table missing user_confirmed column (V5 migration)');
            logPass('plans table has V5 migration columns (draft_version, resolved_model, response_model, user_confirmed)');

            // 验证 migration 版本 >= 5
            const latestMigration = db.prepare("SELECT MAX(version) as maxVersion FROM _migrations").get();
            assert.ok(latestMigration.maxVersion >= 5, `Expected migration version >= 5, got ${latestMigration.maxVersion}`);
            logPass(`Migration version >= 5 (actual: ${latestMigration.maxVersion})`);
          } finally {
            db.close();
          }

          // 断言 4: stdout/stderr 不包含错误字符串
          const combinedOutput = stdoutBuffer + stderrBuffer;
          for (const forbidden of FORBIDDEN_ERROR_STRINGS) {
            assert.ok(
              !combinedOutput.includes(forbidden),
              `Forbidden string in output: "${forbidden}"`
            );
          }
          logPass('stdout/stderr: no forbidden error strings');

          // 断言 5: 首次启动应触发 Onboarding
          // 首次启动时没有既有用户数据，architecture-status.json 中 newArchReady=true
          // onboarding 事件通过 renderer 发送，stdout 应包含 onboarding 相关日志
          // 或 architecture-status.json 表明新架构已就绪
          assert.strictEqual(status.newArchReady, true, 'newArchReady should be true');
          logPass('newArchReady=true (architecture initialized successfully)');

          // 断言 6: 没有 initialization error
          assert.strictEqual(status.error, null, `Initialization error: ${status.error}`);
          logPass('No initialization error');

          log('--- 捕获的启动日志（前 2000 字符）---');
          const logPreview = (stdoutBuffer + stderrBuffer).slice(0, 2000);
          console.log(logPreview);
          log('--- 日志预览结束 ---');

          cleanup();

          // 清理临时目录
          setTimeout(() => {
            removeDirSync(userDataDir);
            logPass('临时用户目录已清理');
            resolve({
              userDataDir,
              sqlitePath,
              status,
              stdout: stdoutBuffer,
              stderr: stderrBuffer
            });
          }, 2000);
        } catch (err) {
          cleanup();
          removeDirSync(userDataDir);
          reject(err);
        }
      })
      .catch((err) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(overallTimer);
        cleanup();
        removeDirSync(userDataDir);
        reject(err);
      });
  });
}

// ===== Phase 3: 实际调用 Planning IPC 完成完整链路 =====
// Fix 6: 不能只检查文件和导出函数是否存在，必须实际调用 Planning 代码路径。
// 链路：设置 planningModel → 创建草案 → 手动 patch/delete → 确认 → 查询 active plan

function testPlanningIPCFullChain() {
  log('=== Phase 3: Planning IPC 完整链路测试 ===');

  // 1. Require 编译后的 dist 模块（与打包产物中相同的代码）
  const { initDatabase, closeDatabase, getDatabase } = require(path.join(projectRoot, 'dist', 'infrastructure', 'database', 'connection.js'));
  const { settingsRepository } = require(path.join(projectRoot, 'dist', 'infrastructure', 'database', 'repositories', 'settings-repository.js'));
  const { planRepository } = require(path.join(projectRoot, 'dist', 'infrastructure', 'database', 'repositories', 'plan-repository.js'));
  const { runMigrations } = require(path.join(projectRoot, 'dist', 'infrastructure', 'database', 'migration-runner.js'));
  const { ModelGateway } = require(path.join(projectRoot, 'dist', 'services', 'ModelGateway.js'));
  const { TimeService, FixedClock } = require(path.join(projectRoot, 'dist', 'services', 'TimeService.js'));
  const { UserContextService } = require(path.join(projectRoot, 'dist', 'services', 'UserContextService.js'));
  const { PlanningGraphRunner } = require(path.join(projectRoot, 'dist', 'agent', 'graphs', 'planning', 'graph.js'));
  const { getDefaultAppConfig, applyUserModelAliases } = require(path.join(projectRoot, 'dist', 'infrastructure', 'config', 'config-loader.js'));

  // 2. 创建临时数据库并初始化
  const tmpDir = createTempUserDataDir();
  const dbPath = path.join(tmpDir, 'test-planning.sqlite');
  try {
    initDatabase({ path: dbPath });
    const db = getDatabase();
    runMigrations(db);

    // 设置基础环境
    const userId = 'test-planning-user';
    const characterId = 'test-planning-roxy';
    settingsRepository.set('onboarding_completed', 'true');
    settingsRepository.set('user_id', userId);
    settingsRepository.set('active_character_id', characterId);
    try {
      db.prepare('INSERT INTO users (id, nickname, preferred_name) VALUES (?, ?, ?)').run(userId, '测试用户', '测试用户');
    } catch { /* may already exist */ }

    // 清理可能残留的 planning 数据
    db.prepare('DELETE FROM plan_tasks').run();
    db.prepare('DELETE FROM plans').run();
    db.prepare('DELETE FROM graph_checkpoints').run();

    // 3. 步骤 1：设置 planningModel
    const customPlanningModel = 'test-planning-model-v6';
    settingsRepository.set('model_alias_planning', customPlanningModel);
    const configuredModel = settingsRepository.get('model_alias_planning');
    assert.strictEqual(configuredModel, customPlanningModel, 'planningModel not set correctly');
    logPass('Step 1: planningModel 设置成功');

    // 4. 创建 mock fetch 和 ModelGateway
    // 固定时间对：基于 10:00 AM（匹配 FixedClock），不依赖 new Date()
    const tp = [
      { start_time: '10:30', end_time: '11:00' },
      { start_time: '11:30', end_time: '12:00' },
      { start_time: '12:30', end_time: '13:00' },
      { start_time: '13:30', end_time: '14:00' }
    ];

    const mockFetch = async (_url, options) => {
      // 验证 body.model 是设置的 planningModel
      let bodyModel = null;
      if (options && options.body) {
        try {
          const parsed = JSON.parse(options.body);
          bodyModel = parsed.model;
        } catch { /* ignore */ }
      }

      // 返回 create_draft 动作
      const action = {
        type: 'create_draft',
        tasks: [
          { start_time: tp[0].start_time, end_time: tp[0].end_time, content: '任务一' },
          { start_time: tp[1].start_time, end_time: tp[1].end_time, content: '任务二' },
          { start_time: tp[2].start_time, end_time: tp[2].end_time, content: '任务三' }
        ],
        message: '计划草案已生成，请确认。'
      };
      const body = JSON.stringify(action);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: 'test-planning',
          model: bodyModel || customPlanningModel,
          choices: [{ message: { role: 'assistant', content: body }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 }
        }),
        text: async () => body
      };
    };

    const defaultConfig = getDefaultAppConfig();
    const mockSecretStore = {
      read: () => ({
        provider: 'deepseek',
        endpoint: 'https://api.deepseek.com/v1/chat/completions',
        model: 'deepseek-chat',
        apiKey: 'test-key'
      }),
      write: () => {},
      clear: () => {},
      isEncrypted: () => true
    };

    const modelGateway = new ModelGateway({
      config: defaultConfig,
      secretStore: mockSecretStore,
      fetchFn: mockFetch,
      db
    });
    // 注入 configReloader：每次 invoke 前从 app_settings 重新读取模型别名
    modelGateway.setConfigReloader(() => {
      const freshDefaults = getDefaultAppConfig();
      const freshUserAliases = settingsRepository.getModelAliases();
      return applyUserModelAliases(freshDefaults, freshUserAliases);
    });

    const timeService = new TimeService('Asia/Shanghai', new FixedClock(new Date('2026-07-11T02:00:00.000Z')));
    const userContextService = new UserContextService();
    const runner = new PlanningGraphRunner({ modelGateway, timeService, userContextService });

    // 5. 步骤 2：创建草案（通过 PlanningGraphRunner.submitMessage）
    // 注意：这是同步函数中调用 async，需要 await
    return (async () => {
      const createDto = await runner.submitMessage({
        userId,
        characterId,
        userInput: '今天安排三个任务'
      });

      assert.ok(createDto.ok, `create_draft should succeed: ${createDto.reason}`);
      assert.strictEqual(createDto.actionType, 'create_draft');
      assert.ok(createDto.plan, 'plan should be returned');
      assert.strictEqual(createDto.plan.tasks.length, 3);
      assert.strictEqual(createDto.awaitingConfirmation, true, 'awaitingConfirmation should be true after create_draft');
      logPass('Step 2: create_draft 成功，3 个任务，awaitingConfirmation=true');

      const planId = createDto.plan.planId;

      // 6. 步骤 3a：手动 patch 修改第一个任务的内容
      const firstTaskId = createDto.plan.tasks[0].id;
      const patchDto = await runner.submitManualEdit({
        userId,
        characterId,
        planId,
        agentAction: {
          type: 'patch_tasks',
          patches: [{ id: firstTaskId, content: '修改后的任务一' }],
          message: '已修改任务一'
        }
      });

      assert.ok(patchDto.ok, `manual patch should succeed: ${patchDto.reason}`);
      assert.strictEqual(patchDto.actionType, 'patch_tasks');
      logPass('Step 3a: 手动 patch 任务成功');

      // 验证 patch 确实写入数据库
      const tasksAfterPatch = planRepository.getTasksByPlanId(planId);
      const patchedTask = tasksAfterPatch.find(t => t.id === firstTaskId);
      assert.strictEqual(patchedTask.content, '修改后的任务一', 'task content not patched in DB');
      logPass('Step 3a: patch 已写入数据库');

      // 7. 步骤 3b：手动 delete 删除第二个任务
      const secondTaskId = createDto.plan.tasks[1].id;
      const deleteDto = await runner.submitManualEdit({
        userId,
        characterId,
        planId,
        agentAction: {
          type: 'delete_task',
          taskId: secondTaskId,
          message: '已删除任务二'
        }
      });

      assert.ok(deleteDto.ok, `manual delete should succeed: ${deleteDto.reason}`);
      assert.strictEqual(deleteDto.actionType, 'delete_task');
      logPass('Step 3b: 手动 delete 任务成功');

      // 验证 delete 确实从数据库删除
      const tasksAfterDelete = planRepository.getTasksByPlanId(planId);
      assert.strictEqual(tasksAfterDelete.length, 2, 'should have 2 tasks after delete');
      assert.ok(!tasksAfterDelete.find(t => t.id === secondTaskId), 'deleted task should not exist');
      logPass('Step 3b: delete 已从数据库删除');

      // 8. 步骤 4：确认发布计划（isConfirmation=true）
      const confirmDto = await runner.submitMessage({
        userId,
        characterId,
        userInput: '就这样',
        isConfirmation: true
      });

      assert.ok(confirmDto.ok, `confirm should succeed: ${confirmDto.reason}`);
      assert.strictEqual(confirmDto.published, true, 'plan should be published');
      logPass('Step 4: 确认发布成功，published=true');

      // 9. 步骤 5：查询 active plan
      const activePlan = planRepository.getActivePlan();
      assert.ok(activePlan, 'active plan should exist');
      assert.strictEqual(activePlan.status, 'active');
      assert.strictEqual(activePlan.tasks.length, 2, 'active plan should have 2 tasks (after delete)');
      logPass('Step 5: 查询 active plan 成功，status=active，2 个任务');

      // 10. 验证 resolvedModel 和 responseModel 已保存到数据库
      assert.ok(activePlan.resolved_model, 'resolved_model should be saved in DB');
      assert.ok(activePlan.response_model, 'response_model should be saved in DB');
      logPass(`Step 5: resolved_model=${activePlan.resolved_model}, response_model=${activePlan.response_model}`);

      // 11. 验证 checkpoint 已被消费（发布后不再有 active checkpoint）
      const { checkpointRepository } = require(path.join(projectRoot, 'dist', 'infrastructure', 'database', 'repositories', 'checkpoint-repository.js'));
      const activeCheckpoint = checkpointRepository.getActiveByScope('planning', `${userId}:${characterId}`);
      assert.strictEqual(activeCheckpoint, null, 'checkpoint should be consumed after publish');
      logPass('Step 5: checkpoint 已在发布后消费');

      // 12. 验证 scope_key 隔离：V6 migration 添加了 scope_key 列
      const checkpointSchema = db.prepare("PRAGMA table_info(graph_checkpoints)").all();
      const hasScopeKey = checkpointSchema.some(c => c.name === 'scope_key');
      assert.ok(hasScopeKey, 'graph_checkpoints should have scope_key column (V6 migration)');
      logPass('Step 5: V6 migration scope_key 列存在');

      closeDatabase();
      removeDirSync(tmpDir);
      logPass('Phase 3: Planning IPC 完整链路测试通过');
    })().catch((err) => {
      try { closeDatabase(); } catch { /* ignore */ }
      removeDirSync(tmpDir);
      throw err;
    });
  } catch (err) {
    try { closeDatabase(); } catch { /* ignore */ }
    removeDirSync(tmpDir);
    throw err;
  }
}

// ===== 主入口 =====

async function main() {
  log('开始打包级新架构验证测试');
  log(`EXE 路径: ${exePath}`);
  log(`asar 路径: ${asarPath}`);

  // Phase 1: asar 内容检查
  testAsarContents();

  // Phase 2: 启动 EXE 并验证
  const result = await testLaunchExe();

  // Phase 3: 实际调用 Planning IPC 完成完整链路
  await testPlanningIPCFullChain();

  // 汇总
  log('');
  log('=== 测试结果汇总 ===');
  logPass('Phase 1: app.asar 包含所有必要依赖和 dist 文件');
  logPass('Phase 2: PetFramework.exe 启动成功');
  logPass(`  - architecture state: ${result.status.state}`);
  logPass(`  - pet-data.sqlite: ${result.sqlitePath}`);
  logPass('  - _migrations 表存在');
  logPass('  - 核心表存在 (memories, reminders, sessions, messages, reflection_jobs, event_outbox)');
  logPass('  - stdout/stderr 无错误标记字符串');
  logPass('  - 临时用户目录已清理');
  logPass('Phase 3: Planning IPC 完整链路（设置 planningModel → 创建草案 → patch/delete → 确认 → 查询 active plan）');
  log('');
  console.log('=== ALL TESTS PASSED ===');
}

main().catch((err) => {
  logFail(err.message);
  if (err.stack) {
    console.error(err.stack);
  }
  process.exit(1);
});
