# Planning Mock Scenario Regression 报告

> **testType: mock**
>
> 本报告为 Mock 模型结构行为回归测试结果，**不包含真实模型验收**。
> 测试使用 mock fetch 模拟模型返回，不调用真实 API，不验证真实模型智能表现。
> 真实模型验收必须使用真实 API、真实 planningModel 和隔离 userData 单独执行。
> **未真正调用 API 时，不得输出"真实模型 15/15 通过"。**
>
> 生成时间：2026-07-11

---

## 一、本轮修改文件列表（6 项验收阻断修复）

### 阻断 1：修复确认发布失败导致的无限循环

| 文件 | 修改内容 |
|------|----------|
| `src/agent/graphs/planning/state.ts` | 新增 `graphIterationCount` state 字段，独立于 `modelCallCount` |
| `src/agent/graphs/planning/graph.ts` | 新增 `MAX_GRAPH_ITERATIONS = 6`；`execute_tool` 条件路由中 `isConfirmation && toolExecutionStatus === 'failed'` 直接返回 `build_response`；普通失败需同时满足 `modelCallCount < MAX_MODEL_CALLS_FOR_PLANNING && graphIterationCount < MAX_GRAPH_ITERATIONS` 才回 `agent_decide` |
| `src/agent/graphs/planning/nodes/execute-tool.ts` | 每次执行递增 `graphIterationCount`，所有返回点包含该字段 |

### 阻断 2：修复时间测试不稳定性

| 文件 | 修改内容 |
|------|----------|
| `src/services/TimeService.ts` | 新增 `Clock` 接口、`SystemClock`、`FixedClock` 类和 `setClock` 方法；所有 `new Date()` 替换为 `this.clock.now()` |
| `tests/unit/planning-graph.test.ts` | 全局注入 `FixedClock`（固定 2026-07-11 10:00:00 Asia/Shanghai）；新增 23:59、00:00、跨日边界测试；移除 `Math.min(23, currentHour + N)` 模式 |
| `tests/unit/planning-real-model-scenarios.test.ts` | `createRunner` 使用 `new FixedClock(FIXED_TEST_DATE)`；`futureTimePairs` 改为固定基准 10:00 AM |

### 阻断 3：修复 Planning Trace

| 文件 | 修改内容 |
|------|----------|
| `src/agent/graphs/planning/state.ts` | `PlanningState` 新增 `totalInputTokens`、`totalOutputTokens`；`PlanningTrace` 接口新增同名字段 |
| `src/agent/graphs/planning/nodes/agent-decide.ts` | 3 个返回点（模型失败、Zod 失败、成功）累加 `totalInputTokens`/`totalOutputTokens` |
| `src/agent/graphs/planning/nodes/build-response.ts` | trace 使用累计 token；`userInputSummary` 使用 `sanitizePlanningTraceText`；添加阶段计时 |
| `src/agent/graphs/planning/nodes/execute-tool.ts` | 增加 `tracePhases` 记录和 `durationMs` 计时 |
| `src/agent/graphs/planning/nodes/load-planning-context.ts` | 增加 `tracePhases` 记录和阶段计时 |
| `src/agent/graphs/planning/graph.ts` | `submitManualEdit` 执行后保存 `this.lastTrace = finalState.planningTrace ?? null` |

### 阻断 4：实现真正的 Trace 脱敏

| 文件 | 修改内容 |
|------|----------|
| `src/agent/graphs/planning/sanitize.ts` | **新增文件**。`sanitizePlanningTraceText` 函数处理 9 类敏感信息：API Key、Bearer Token、Authorization、邮箱、Windows 路径、Unix 路径、credential/password/token/key 键值、电话号码、过长数字 |
| `src/agent/graphs/planning/nodes/build-response.ts` | `userInputSummary: sanitizePlanningTraceText(state.userInput, 80)` 替代 `state.userInput.slice(0, 80)` |

### 阻断 5：纠正验收报告命名和指标

| 文件 | 修改内容 |
|------|----------|
| `tests/unit/planning-real-model-scenarios.test.ts` | 头部注释改为"Planning Mock Scenario Regression"；`ScenarioMetrics` 新增 `testType`/`configuredModel`/`resolvedModel`/`responseModel`/`messageStructValid`；`isPersonaConsistent` 重命名为 `isMessageStructValid`；所有 `recordMetrics` 调用添加新字段；报告输出添加免责声明 |
| `PLANNING_REAL_MODEL_REPORT.md` | 本文件：纠正命名、明确 testType=mock、移除"人格一致"列、明确真实模型验收需独立执行 |

### 阻断 6：新增回归测试

| 文件 | 修改内容 |
|------|----------|
| `tests/unit/planning-graph.test.ts` | 新增 7 个测试（测试 26-32）：确认发布失败不循环、23:59 边界、00:00 零点、跨日边界、Token 累计、Trace 脱敏、手动编辑生成 Trace |

---

## 二、自动测试结果

| 测试项 | 结果 | 说明 |
|--------|------|------|
| `npm run typecheck` | exit 0 | 无类型错误 |
| `npm run build:ts` | exit 0 | TypeScript 编译成功 |
| `npx tsx tests/unit/planning-graph.test.ts` | **269 PASS, 0 FAIL** | 含 7 个新回归测试 |
| `npx tsx tests/unit/planning-real-model-scenarios.test.ts` | **15/15 通过, 19 PASS, 0 FAIL** | Mock 场景回归，testType=mock |
| `npx tsx tests/unit/database.test.ts` | **56 passed, 0 failed** | 数据库 + migration V1-V6 |
| `npm run pack` | exit 0 | 打包成功 |
| `npm run test:packaged-new-arch` | **ALL TESTS PASSED** | 打包版新架构验证通过 |

> **重要说明**：以上 `planning-real-model-scenarios.test.ts` 为 **Mock 场景回归测试**（testType=mock），使用 mock fetch 模拟模型返回，**未调用真实 API**。不得称为"真实模型验收"。

---

## 三、Mock 场景回归报告（testType: mock）

> 以下指标来自 mock 模型结构行为验证，仅验证 Graph、工具和状态结构。
> **不验证人格一致性**。`messageStructValid` 仅表示消息非空且 < 1000 字。
> 真实模型验收必须使用真实 API、真实 planningModel 和隔离 userData 单独执行。

| # | 场景 | 通过 | testType | configuredModel | resolvedModel | responseModel | 模型调用 | 消息结构有效 | traceId |
|---|------|------|----------|-----------------|---------------|---------------|----------|--------------|---------|
| 1 | 模糊目标 | YES | mock | (用户配置) | deepseek-chat | deepseek-chat | 1 | Y | planning-* |
| 2 | 信息充分 | YES | mock | (用户配置) | deepseek-chat | deepseek-chat | 1 | Y | planning-* |
| 3 | 当前时间约束 | YES | mock | (用户配置) | deepseek-chat | deepseek-chat | 3 | Y | planning-* |
| 4 | 局部修改 | YES | mock | (用户配置) | deepseek-chat | deepseek-chat | 1 | Y | planning-* |
| 5 | 语义修改 | YES | mock | (用户配置) | deepseek-chat | deepseek-chat | 1 | Y | planning-* |
| 6 | 删除任务 | YES | mock | (用户配置) | deepseek-chat | deepseek-chat | 1 | Y | planning-* |
| 7 | 添加任务 | YES | mock | (用户配置) | deepseek-chat | deepseek-chat | 1 | Y | planning-* |
| 8 | 时间冲突 | YES | mock | (用户配置) | deepseek-chat | deepseek-chat | 3 | Y | planning-* |
| 9 | 输入框确认 | YES | mock | (用户配置) | deepseek-chat | deepseek-chat | 0 | Y | planning-* |
| 10 | 模糊确认 | YES | mock | (用户配置) | deepseek-chat | deepseek-chat | 1 | Y | planning-* |
| 11 | 手动编辑 | YES | mock | (用户配置) | deepseek-chat | deepseek-chat | 0 | Y | planning-* |
| 12 | 重启恢复 | YES | mock | (用户配置) | deepseek-chat | deepseek-chat | 0 | Y | planning-* |
| 13 | 工具自动修正 | YES | mock | (用户配置) | deepseek-chat | deepseek-chat | 2 | Y | planning-* |
| 14 | API 异常 | YES | mock | (用户配置) | deepseek-chat | deepseek-chat | 1 | Y | planning-* |
| 15 | 最后任务保护 | YES | mock | (用户配置) | deepseek-chat | deepseek-chat | 3 | Y | planning-* |

**Mock 场景总计：15 通过, 0 失败**

### Mock 场景详细说明

1. **模糊目标**："今天帮我推进一下项目" → mock 返回 `ask_clarification`，未创建草案
2. **信息充分**："我十点开始，十二点前写完大纲..." → mock 返回 3 任务草案
3. **当前时间约束**：mock 返回 08:00 过去时间 → 被 `validatePlanDraft` 拒绝
4. **局部修改**："把第二项推迟半小时" → 只修改第二项
5. **语义修改**："下午不要排太满" → 修改下午任务结束时间
6. **删除任务**："删除代码审查" → 删除指定任务
7. **添加任务**："再加半小时运动" → 在不冲突时间段添加
8. **时间冲突**：mock 返回冲突时间 → 被 `validatePlanDraft` 拒绝
9. **输入框确认**：`create_draft` 后 `awaiting_confirmation`，"就这样"触发发布
10. **模糊确认**：不在 `awaiting_confirmation` 阶段说"好的" → 不发布
11. **手动编辑**：`submitManualEdit` → `modelCallCount=0`
12. **重启恢复**：新 Runner `getPlanningState()` → 恢复 messages、currentDraft、draftVersion
13. **工具自动修正**：第一次非法 task ID → 失败回环 → 第二次修正成功
14. **API 异常**：模拟 429 限流 → 原草案完整保留
15. **最后任务保护**：删除唯一任务 → 被 `delete_task` 拒绝

### 新增回归测试摘要（planning-graph.test.ts 测试 26-32）

| # | 测试名 | 验证内容 | 结果 |
|---|--------|----------|------|
| 26 | `testConfirmationPublishFailureNoLoop` | 确认发布失败不循环：任务变过去时间 → publish_plan 失败 → dto.ok=false → modelCallCount=0 → 无 recursion limit → DB 未错误发布 → Trace 存在且 modelCallCount=0 | PASS |
| 27 | `testMidnightBoundary23_59` | 23:59 边界场景：FixedClock 设为 23:59 → validateTaskTimesNotPast 正确判断 → PlanningGraph 正常运行 | PASS |
| 28 | `testMidnightBoundary00_00` | 00:00 零点场景：FixedClock 设为 00:00 → 未来时间校验正确 → PlanningGraph 正常运行 | PASS |
| 29 | `testCrossDayBoundary` | 跨日边界：23:50 → 00:05 切换时钟 → 时间校验逻辑稳定 | PASS |
| 30 | `testTraceTokenAccumulation` | Token 累计：两次调用 200/100 → totalInputTokens=400, totalOutputTokens=200, lastInputTokens=200, lastOutputTokens=100 | PASS |
| 31 | `testTraceSanitization` | 脱敏验证：9 类敏感信息直接测试 + PlanningGraph 端到端 userInputSummary 脱敏 | PASS |
| 32 | `testManualEditGeneratesTrace` | 手动编辑生成 Trace：两次 submitManualEdit → traceId 不同、modelCallCount=0、phases 包含 load_planning_context/execute_tool/build_response | PASS |

---

## 四、真实模型人工验收（testType: real，需独立执行）

> **当前状态：未执行**
>
> 真实模型验收必须满足以下条件：
> 1. 使用真实 API（非 mock fetch）
> 2. 使用真实 `planningModel`（从 `app_settings` 读取）
> 3. 隔离 userData 单独执行
> 4. 报告必须记录每个场景的：testType=real、configuredModel、resolvedModel、responseModel、真实输入和输出、模型调用次数、人工评价和失败原因
>
> **未真正调用 API 时，不得输出"真实模型 15/15 通过"。**
>
> 验收步骤：
> 1. 启动 `release/win-unpacked/PetFramework.exe`
> 2. 打开 API 设置面板，配置接口地址、API Key、计划模型 ID（如 `deepseek-chat`）
> 3. 打开状态面板，确认 PlanningGraph 模型区域显示 configured/resolved/response model 三值一致
> 4. 进入计划模式，按 15 个场景逐个测试
> 5. 每轮后查看状态面板的 Planning Trace 区域，确认 traceId、模型调用次数、token、耗时、草案版本等信息
> 6. 验收完成后将结果补充到本节，明确标注 testType=real

---

## 五、模型 ID 说明

- **默认 planningModel**：`deepseek-chat`（DeepSeek API 服务商实际支持的模型 ID）
- **配置方式**：通过 API 设置面板的"计划模型 ID"输入框配置
- **状态面板显示**：
  - configuredModel（用户配置值，从 `app_settings.model_alias_planning` 读取）
  - resolvedModel（ModelGateway 解析后的实际模型 ID）
  - responseModel（API 返回的 `response.model`）
- **三者一致性检查**：不一致时显示明确警告

---

## 六、已知限制

1. **真实模型质量未自动验证**：自动化测试使用 mock 模型验证 Graph 结构行为，真实模型智能表现需人工通过 EXE 验收。
2. **Planning Trace 仅保留最近一轮**：`PlanningGraphRunner.lastTrace` 为内存存储，重启后丢失。历史 trace 可从日志文件中检索。
3. **模型一致性检查依赖 settings 表**：`configuredModel` 从 `app_settings` 的 `model_alias_planning` 读取，若用户从未配置则为空字符串。
4. **场景 3 和 8 的模型调用次数为 3**：因为 mock 模型始终返回相同动作，导致工具循环到 `MAX_MODEL_CALLS_FOR_PLANNING` 上限。真实模型应在第一次失败后修正，调用次数预期为 2。
5. **不包含日历同步、天气、云端账号**：本阶段未加入新大型功能，仅修复 6 项验收阻断。
6. **messageStructValid 不等于人格一致性**：自动化测试仅检查消息非空且不超过 1000 字符，真实人格语气需人工判断。

---

## 七、唯一正确测试 EXE 路径

```
d:\Documents\展示项目内容\roxy-electron-pet-framework\release\win-unpacked\PetFramework.exe
```
