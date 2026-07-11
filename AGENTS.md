# AGENTS.md — 工作区 AI Agent 指南

本文件为在本工作区作业的 AI Agent（Claude Code / Codex / Trae 等）提供统一约束。所有 agent 在修改代码前必须先阅读本文件。

## 项目概览

- Electron 桌宠框架，双轨架构：旧 `app/` JS + 新 `src/` TS LangGraph。
- 主数据源：SQLite `pet-data.sqlite`（V1 新架构）。`pet-data.json` 仅用于旧数据迁移。
- 五个 LangGraph：`ConversationGraph`、`OnboardingGraph`、`ProactiveGraph`、`ReflectionGraph`、`PlanningGraph`。
- 打包产物：`release/win-unpacked/PetFramework.exe`。

## 硬约束（不可违反）

- Memory panel CRUD 必须使用 SQLite MemoryStore，不得读写 `pet-data.json`。
- Reminder AppEvents 需要 `dedupeKey: reminder:${reminderId}:${occurrenceId}`。
- 每日问候事件必须安排在 09:00。
- 反思任务必须持久化到 `reflection_jobs` 表，不得用内存数组。
- 天气城市必须从 Onboarding settings 读取，不得硬编码 `'Shanghai'`。
- 系统通知必须返回 `Promise<boolean>`；失败回退到 `pet_bubble` + Renderer ACK。
- Onboarding 完成需要非空 characterId、有效 persona、零错误；验证失败阻止推进。
- Memory 导出必须使用 `memory:export` IPC，用户选择保存路径，排除 API keys。
- Notification/sound/weather adapters 只在 settings 显式等于 `'true'` 时启用（默认禁用）。
- Memory 条目必须包含 `source_occurred_at`、`write_timezone`、`source_role`。
- Reminder 解析必须支持相对时间表达式（N 分钟/小时后、今天/明天）。
- Persona 配置必须使用 `{{user_display_name}}` 模板变量，不得硬编码名字。
- 反思记忆候选需要 `evidenceQuote` 作为非空用户消息子串，程序化校验。
- 时间敏感操作必须使用 `TimeService` 进行时区感知处理。
- 模型配置必须从 `app_settings` 读取 `fastModel` / `balancedModel` / `reasoningModel` / `planningModel`，不得硬编码。

## PlanningGraph 专属约束

- 所有 planning 请求必须经过 `ModelGateway`，不得直接 `fetch`。
- 模型只能通过七种 `AgentActionType` 表达意图，不能直接操作 repository 或执行 SQL。
- 所有写操作必须通过经过 Zod 校验的 Planning Tools。
- `publish_plan` 必须要求明确用户确认；不能由模型擅自发布。
- 用户反馈优先 patch 当前草案，不得默认删除全部任务重建。
- 计划模式使用独立消息历史，草案卡片与对话同时显示。
- 输入框反馈、确认按钮、手动改时间都进入同一个 PlanningGraph。
- 保留 Planning Bubble 的 renderer 展示职责，不把 UI 放进 Graph。
- 不修改已有 migration V4，使用新的幂等 V5 migration。
- 状态面板必须显示 `planningModel` 实际解析值（`resolvedModel`）和 `response.model`（`responseModel`），不允许显示别名冒充实际模型。
- 同时只能有一个 active 计划（部分唯一索引 `idx_plans_active_unique_per_date`）。
- plan status 只允许 `draft` / `active` / `completed`。

## 文件所有权协议

详见 `WORKSTREAM_SPLIT.md`。关键规则：

- `app/main.js`、`app/preload.js`、`app/renderer.js`、`app/index.html`、`app/styles.css` 属于旧轨，可由 agent 修改但需保持 IPC 契约。
- `src/` 下 TypeScript 文件属于新轨，修改后必须运行 `npm run build:ts`。
- `app/config/pet-profile.js` 是角色配置单一来源，换皮只改此文件。
- 不要在 `app/renderer.js`、`app/main.js`、`app/services/prompt-builder.js`、`app/services/affection-service.js` 中硬编码角色名、用户称呼、动画路径或 localStorage 前缀。

## 构建、测试与打包命令

```powershell
# 安装依赖
npm.cmd install

# TypeScript 类型检查
npx tsc --noEmit

# 编译 TypeScript（修改 src/ 后必须运行）
npm.cmd run build:ts

# 打包 Electron 应用（修改后必须运行，使改动进入 PetFramework.exe）
npm.cmd run pack

# 启动开发版
npm.cmd start

# 运行所有测试
npm.cmd test

# 关键测试套件
npx tsx tests/unit/planning-graph.test.ts        # PlanningGraph 13 场景
npx tsx tests/unit/database.test.ts              # 数据库 + migration
npx tsx tests/unit/conversation-graph.test.ts    # ConversationGraph
npx tsx tests/unit/proactive.test.ts             # ProactiveGraph
npx tsx tests/unit/reflection.test.ts            # ReflectionGraph
npx tsx tests/unit/onboarding.test.ts            # OnboardingGraph
npm.cmd run test:packaged-new-arch               # 打包版新架构验证
```

## 常见陷阱

- **PowerShell 不支持 bash 语法**：不要使用 `tail`、`$(cat <<'EOF'...EOF)` 等。改用 `Select-Object -Last N` 和临时文件 + `git commit -F`。
- **database.test.ts 版本号**：V4/V5 migration 加入后，测试中 `version === 3` 的断言会失败，需更新为 `version === 5`。
- **打包版缺少新 migration**：修改 `src/infrastructure/database/migration-runner.ts` 后必须 `npm run build:ts` + `npm run pack`，否则打包版仍是旧 migration。
- **`@langchain/core` / `@langchain/langgraph` / `zod-to-json-schema` 必须在 `dependencies` 中**：否则打包后新架构无法加载，进入 `initialization_failed` 状态。
- **no-silent-fallback**：新架构加载失败时必须显示红色警告，不得静默回退到旧链路。

## 文档维护

修改架构后需同步更新以下文档：

- `PROJECT_STRUCTURE.md`：目录结构、核心文件、新架构说明。
- `CUSTOMIZE_GUIDE.md`：自定义指南、配置说明、使用流程。
- `CONVERSATION_HARNESS_HANDOFF.md`：LangGraph handoff 文档。
- `AGENTS.md`（本文件）：agent 工作指南。

## Git 提交规范

- 只在用户明确要求时提交。
- 不要提交 API Key、`pet-data.json`、`api-config.json`、用户数据、`node_modules`、`release/`。
- 多行 commit 消息使用临时文件 + `git commit -F`（PowerShell 不支持 heredoc）。
- 不要 `git push --force` 到 main/master。
