# V7 跨日期日历计划实施报告

## 1. 实际修改文件清单

### 新增文件

| 文件 | 用途 |
|---|---|
| `src/services/PlanMemoryRetriever.ts` | 计划记忆只读检索服务 |
| `src/services/CalendarActivationService.ts` | 每日激活 scheduled → active 服务 |
| `src/agent/graphs/planning/nodes/load-calendar-context.ts` | 日历上下文加载节点 |
| `tests/unit/calendar-planning.test.ts` | 跨日期日历计划测试（20 场景，78 项断言） |
| `tests/unit/calendar-activation.test.ts` | 每日激活幂等测试（8 场景，38 项断言） |
| `CALENDAR_PLANNING_IMPLEMENTATION_REPORT.md` | 本报告 |

### 修改文件

| 文件 | 修改内容 |
|---|---|
| `src/infrastructure/database/migration-runner.ts` | 新增 V7 `calendar_planning_extensions` migration |
| `src/infrastructure/database/repositories/plan-repository.ts` | PlanScope/PlanStatus 扩展、9 个 V7 查询方法、3 个状态转换方法 |
| `src/services/TimeService.ts` | 新增 6 个日期辅助方法（getTodayDateString 等） |
| `src/agent/graphs/planning/state.ts` | AgentActionType 扩展至 12 种、PlanningState 新增 planningThreadId/targetDate/selectedDate |
| `src/agent/graphs/planning/graph.ts` | PlanningGraphRunner 新增 timeService 字段、3 层 checkpoint 读取策略 |
| `src/agent/graphs/planning/nodes/load-planning-context.ts` | 改为 scope 隔离查询 |
| `src/agent/graphs/planning/nodes/agent-decide.ts` | system prompt 扩展日历工具说明 |
| `src/agent/graphs/planning/nodes/execute-tool.ts` | executePlanningTool 调用传入 scope，修复 `??`/`\|\|` 混用 |
| `src/agent/graphs/planning/nodes/persist-checkpoint.ts` | scope_key 扩展支持 planningThreadId |
| `src/agent/graphs/planning/tools.ts` | 新增 validateTargetDate、validatePlanDraftByMode，executePlanningTool context 新增 scope |
| `src/agent/graphs/proactive/state.ts` | ProactiveType 新增 `daily_plan` |
| `src/agent/graphs/proactive/nodes/receive-event.ts` | 新增 `daily_plan_due` 事件映射 |
| `src/main/integration.ts` | 新增 getCalendarMonth、getCalendarDate、handlePlanningMessageWithDate、activateTodayPlans 方法 |
| `app/main.js` | 新增 calendar:get-month、calendar:get-date、calendar:open-planning IPC handler |
| `app/preload.js` | 暴露 getCalendarMonth、getCalendarDate、openPlanningWithDate API |
| `app/renderer.js` | 新增日历面板 UI、月视图渲染、日期选择、详情展示、与计划模式联动 |
| `app/index.html` | 新增 #calendarToggle 按钮和 #calendarPanel 面板结构 |
| `app/styles.css` | 新增 .calendar-panel、.calendar-grid、.calendar-detail 等完整样式 |
| `tests/unit/database.test.ts` | 版本号断言更新为 7 |
| `tests/unit/planning-graph.test.ts` | 所有 insert 调用添加 user_id/characterId，修复 scope 隔离测试 |
| `PROJECT_STRUCTURE.md` | 新增 V7 跨日期日历计划章节 |
| `AGENTS.md` | PlanningGraph 专属约束扩展至 V7 |

## 2. 最终架构图

```
START
  │
  ├─ load_planning_context ── 注入 TimeService 当前时间、用户资料、scope 隔离的现有草案
  │
  ├─ load_calendar_context ── V7 新节点，按 scope 加载 selectedDate/selectedPlan/planSearchResults
  │
  ├─ agent_decide ─────────── 调用 ModelGateway（planningModel 别名），解析 12 种 AgentActionType
  │                            ↓ 只读工具返回 toolResult 给 agent_decide 继续判断
  │                            （MAX_READONLY_TOOL_LOOPS=3）
  │
  ├─ execute_tool ─────────── 执行 Zod 校验的动作；非法参数不写入数据库
  │                            （MAX_MODEL_CALLS_FOR_PLANNING=3, MAX_GRAPH_ITERATIONS=6）
  │
  ├─ build_response ───────── 构造 PlanningResponseDTO（含 resolvedModel、responseModel）
  │
  ├─ persist_checkpoint ───── 3 层 checkpoint 读取策略：
  │                            1. planningThreadId 非空：新格式 scope_key
  │                            2. 旧格式 scope_key
  │                            3. date:today 新格式
  │
  END
```

## 3. 新增 LangGraph 节点和工具

### 新增节点

- `load_calendar_context`：按 PlanScope 加载 selectedDate、selectedPlan、planSearchResults 上下文。

### 新增工具（AgentActionType 扩展至 12 种）

| 动作类型 | 类别 | 用途 |
|---|---|---|
| `cancel_plan` | 写工具 | 取消未来计划（draft/scheduled → cancelled） |
| `get_plan_by_date` | 只读工具 | 按日期查询计划 |
| `list_plans_by_range` | 只读工具 | 按日期范围查询计划 |
| `search_plans` | 只读工具 | 按任务内容搜索计划 |
| `get_calendar_month` | 只读工具 | 获取月视图计划摘要 |

### 只读工具循环

`READONLY_ACTION_TYPES = { get_plan_by_date, list_plans_by_range, search_plans, get_calendar_month }`

只读工具执行后返回 toolResult 给 agent_decide，让模型根据查询结果继续判断（不直接 build_response）。

## 4. 数据库迁移版本与回滚/兼容策略

### V7 migration：`calendar_planning_extensions`

- **版本号**：7
- **兼容性**：不删除现有 plans/plan_tasks，不丢失现有计划
- **幂等性**：重复执行安全（IF NOT EXISTS / PRAGMA table_info 检查）
- **旧数据回填**：user_id 默认 `default-user`，character_id 默认 `default-character`
- **冲突处理**：unique index 建立前检查并处理旧数据冲突（conflictsResolved 计数）

### 新增列

- `plans.user_id` TEXT — 用户 ID
- `plans.character_id` TEXT — 角色 ID
- `plans.timezone` TEXT — 创建时使用的时区
- `plans.activated_at` TEXT — scheduled → active 的激活时间
- `plans.completed_at` TEXT — 全部任务完成时间
- `plans.cancelled_at` TEXT — 取消时间

### 新增索引

- `idx_plans_live_unique_per_scope_date`：部分唯一索引，同一 user_id + character_id + date 只允许一个 live plan（draft/scheduled/active）
- `idx_plans_scope_date`：加速按 scope + date 查询

### 触发器扩展

`trg_plans_status_check_insert / _update` 扩展允许状态：`draft` / `scheduled` / `active` / `completed` / `cancelled` / `expired`

### 回滚策略

V7 migration 不删除任何数据，只追加列和索引。如需回滚，可：
1. 删除新增索引和触发器
2. 保留新增列（SQLite 不支持 DROP COLUMN，保留不影响）
3. 旧版本代码会忽略这些列

## 5. plans 状态机

```
                    ┌─────────────────────────────────────────────┐
                    │                                             │
                    ▼                                             │
  create_draft → draft ─── publish_plan ────→ scheduled ─── activate ───→ active
                    │                              │                    │
                    │                              │                    │
                    └─── cancel_plan ─────→ cancelled              completePlan
                    │                              │                    │
                    │                              │                    ▼
                    │                              │              completed
                    │                              │
                    └──────────────────────────────┘
```

- `draft` → `scheduled`：未来日期确认发布（`publishPlan('scheduled')`）
- `draft` → `active`：今天确认发布（`publishPlan('active')`）
- `scheduled` → `active`：每日激活服务原子转换（`activatePlan`）
- `active` → `completed`：所有任务完成（`completePlan`）
- `draft` / `scheduled` → `cancelled`：用户取消（`cancelPlan`）
- `active` / `completed` 不允许直接 cancel（需先完成或过期）

## 6. 日期及时区规则

### 校验模式（validateTargetDate）

| 模式 | 规则 |
|---|---|
| `future_date` | 08:00 即使早于当前时刻也合法；校验 HH:MM、start < end、重复、重叠 |
| `today` | 新增/修改任务不能早于当前时间 |
| `past_date` | 默认拒绝创建和修改；`allowPast=true` 时允许查看 |
| `display_or_activation` | 不因部分任务时间已过去就拒绝整个计划；过去未完成任务保留显示 |

### 边界覆盖

- 23:59 → 00:00 跨日（FixedClock 测试验证）
- 跨月（2026-07-31 → 2026-08-01）
- 跨年（2026-12-31 → 2027-01-01）
- 闰年（2028-02-29 合法，2027-02-29 非法）

### 时区处理

- 所有日期计算使用 `TimeService`，注入 `FixedClock` 控制
- `getTodayDateString()` 使用 `Intl.DateTimeFormat` 按本地时区计算
- 不得把 UTC 日期截断当作本地日期

## 7. PlanMemoryRetriever 设计

### 原则

- `plans` / `plan_tasks` 是唯一事实来源，PlanMemoryRetriever 只读不写
- 返回有限、结构化摘要（max 8 tasks/plan，max 60 chars content）
- 不把全部历史计划塞进 Prompt
- 修改计划后立即能通过检索读取新内容（直接查数据库，无缓存）
- 删除或取消计划后不返回过期副本（repository 已过滤 cancelled）

### 接口

| 方法 | 用途 |
|---|---|
| `getByDate(scope, date)` | 按日期检索计划摘要 |
| `listByRange(scope, from, to, limit?)` | 按日期范围检索（默认 31 条） |
| `search(scope, query, range?, limit?)` | 按任务内容搜索（默认 10 条） |
| `getMonthSummary(scope, year, month)` | 月视图摘要（不含任务详情） |
| `getTodayActive(scope, localDate)` | 获取今天的 active 计划摘要 |
| `getDraftByDate(scope, date)` | 获取指定日期的草案摘要 |

### 与 MemoryStore 的区别

- `MemoryStore`：稳定用户画像（"我下午容易疲劳"）
- `PlanMemoryRetriever`：计划事实（"7月20日有代码审查"）
- 不得混为一类

## 8. 每日激活幂等机制

### CalendarActivationService

```
activateTodayPlans(scope):
  1. todayDate = timeService.getTodayDateString()
  2. scheduledPlans = planRepository.getScheduledPlansForDate(scope, todayDate)
  3. for each plan:
     a. activatePlan(plan.id) — SQL WHERE status='scheduled' 保证原子性
     b. eventOutboxRepository.publish({ dedupeKey: daily_plan:${planId}:${date} })
  4. 返回 { activatedPlans, skippedCount, todayDate }
```

### 幂等保证

- `activatePlan` SQL `WHERE id=? AND status='scheduled'`：只会成功一次
- `event_outbox.dedupe_key` 唯一约束：事件只发布一次
- 重复调用 `activateTodayPlans` 不会重复激活或重复通知

### 跨日检测

- `hasDateChanged()`：比较 `lastCheckedDate` 和今天日期
- `startCrossDayWatcher(scope, onActivated)`：每 5 分钟检查一次跨日，变化时触发激活

### 不做的事

- 不调用模型（ProactiveGraph 负责生成符合角色人格的提示）
- 不直接操作 UI（caller 负责 renderer 刷新）
- 不为每个任务创建 reminder（除非用户明确单独设置提醒）

## 9. IPC 清单

| IPC 通道 | 用途 | 是否调用模型 |
|---|---|---|
| `calendar:get-month` | 获取月视图计划摘要 | 否 |
| `calendar:get-date` | 获取指定日期的计划详情 | 否 |
| `calendar:open-planning` | 以指定日期打开计划模式 | 否（只设置 targetDate） |
| `planning:start` | 进入计划模式 | 否 |
| `planning:submit-message` | 提交规划消息 | 是 |
| `planning:confirm` | 确认发布计划 | 否（执行已确认状态） |
| `planning:toggle-task` | 切换任务完成状态 | 否 |

所有 IPC 必须有 user/character scope，不信任 renderer 直接传入数据库主键。

## 10. 所有测试的真实 PASS/FAIL 数量

### Mock 测试

| 测试套件 | PASS | FAIL |
|---|---|---|
| `planning-graph.test.ts` | 278 | 0 |
| `calendar-planning.test.ts` | 78 | 0 |
| `calendar-activation.test.ts` | 38 | 0 |
| `database.test.ts` | 56 | 0 |
| `test:packaged-new-arch` | 全部通过 | 0 |

### 真实模型验收

**未执行**。规格第十一节要求使用真实 planningModel 执行 10 个场景，本阶段只完成 Mock 测试。真实模型验收需要用户配置 API Key 后手动执行，记录 traceId/resolvedModel/responseModel 等指标。

## 11. Mock 与真实模型验收分别记录

### Mock 验收（已完成）

- testType: `mock`
- configuredModel: `deepseek-chat`（测试环境默认）
- resolvedModel: `test-planning-model-v6`（mock）
- responseModel: `test-planning-model-v6`（mock）
- 全部 450 项断言通过，0 失败

### 真实模型验收（待执行）

规格要求的 10 个场景：

1. 帮我安排明天的工作
2. 下周三上午写大纲，下午开会
3. 这个月底帮我安排一下
4. 把下周三第二个任务推迟一小时
5. 我之前哪一天安排了健身？
6. 把有论文大纲的那个计划增加资料整理
7. 取消 7 月 20 日的计划
8. 查看昨天的计划
9. 把昨天的任务改到今天
10. 今天计划还有什么没完成？

记录字段：testType、configuredModel、resolvedModel、responseModel、用户输入、模型输出、工具调用顺序、模型调用次数、target_date、planId、traceId、最终数据库状态、是否通过、人工评价、失败原因。

## 12. 已知限制

1. **未实现 Google Calendar / Outlook / 飞书日历同步**（规格第十四节明确不做）
2. **未实现多人共享日历**（规格第十四节明确不做）
3. **未实现复杂 RRULE 重复日程**（规格第十四节明确不做）
4. **未实现云端同步**（规格第十四节明确不做）
5. **未实现自动替用户删除历史计划**（规格第十四节明确不做）
6. **未实现根据普通聊天偷偷创建计划**（规格第十四节明确不做）
7. **真实模型验收未执行**：需要用户配置 API Key 后手动执行
8. **跨日检测间隔 5 分钟**：极少数情况下，应用在跨日后 5 分钟内不会立即激活（可接受）
9. **日历面板与计划面板同时打开时空间竞争**：通过 closeCalendarPanel/enterPlanningMode 互斥切换缓解

## 13. EXE 和 app.asar 的修改时间

```
PetFramework.exe  2026/7/12 11:52:16  180849152 bytes
app.asar          2026/7/12 11:52:15   44986893 bytes
```

## 14. 唯一正确测试入口

```powershell
# 1. TypeScript 类型检查
npm.cmd run typecheck

# 2. 编译 TypeScript
npm.cmd run build:ts

# 3. 运行单元测试
npx tsx tests/unit/planning-graph.test.ts
npx tsx tests/unit/calendar-planning.test.ts
npx tsx tests/unit/calendar-activation.test.ts
npx tsx tests/unit/database.test.ts

# 4. 打包 Electron 应用
npm.cmd run pack

# 5. 打包版新架构验证
npm.cmd run test:packaged-new-arch

# 6. JS 语法检查
node --check app/main.js
node --check app/preload.js
node --check app/renderer.js

# 7. git diff 检查
git diff --check
```

## 15. git status --short

```
 M app/index.html
 M app/main.js
 M app/preload.js
 M app/renderer.js
 M app/styles.css
 M src/agent/graphs/planning/graph.ts
 M src/agent/graphs/planning/nodes/agent-decide.ts
 M src/agent/graphs/planning/nodes/execute-tool.ts
 M src/agent/graphs/planning/nodes/load-planning-context.ts
 M src/agent/graphs/planning/nodes/persist-checkpoint.ts
 M src/agent/graphs/planning/state.ts
 M src/agent/graphs/planning/tools.ts
 M src/agent/graphs/proactive/nodes/receive-event.ts
 M src/agent/graphs/proactive/state.ts
 M src/infrastructure/database/migration-runner.ts
 M src/infrastructure/database/repositories/plan-repository.ts
 M src/main/integration.ts
 M src/services/TimeService.ts
 M tests/unit/database.test.ts
 M tests/unit/planning-graph.test.ts
 M PROJECT_STRUCTURE.md
 M AGENTS.md
?? src/agent/graphs/planning/nodes/load-calendar-context.ts
?? src/services/CalendarActivationService.ts
?? src/services/PlanMemoryRetriever.ts
?? tests/unit/calendar-activation.test.ts
?? tests/unit/calendar-planning.test.ts
?? CALENDAR_PLANNING_IMPLEMENTATION_REPORT.md
?? 日历功能开发.txt
?? scripts/
```

## 16. 当前提交 ID

```
e1dcf26dd3ce0ff3f44ec4ba85b09ca0c6db477a
```

本轮修改尚未提交。上一轮提交（`fix: PlanningGraph 兼容 deepseek-v4-pro 真实模型`）在 e1dcf26，为本轮修改的基线。
