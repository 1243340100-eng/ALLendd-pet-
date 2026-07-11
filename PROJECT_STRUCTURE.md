# Roxy 桌宠项目结构说明

## 主要目录

- `app/`：Electron 应用源码，打包时会进入 `app.asar`。
- `app/assets/`：桌宠动画资源，目前使用 `roxy-spritesheet.webp`。
- `app/services/`：数据、记忆、Prompt、Token、好感度等服务模块。
- `release/win-unpacked/`：当前 Windows 构建目录，用于本机测试。
- `node_modules/`：依赖目录，不要复制进框架模板。

## 核心文件

- `app/main.js`：Electron 主进程。负责窗口创建、右键菜单、API Key 存储、AI 请求、IPC handler、窗口缩放。
- `app/preload.js`：preload 安全桥。只向渲染进程暴露受控的 `window.petAPI` 方法。
- `app/renderer.js`：渲染进程逻辑。负责动画播放、聊天 UI、状态面板、语言切换、提醒词设置、记忆管理交互。
- `app/index.html`：主界面结构。包含桌宠、按钮、API 设置面板、聊天面板、状态面板。
- `app/styles.css`：界面样式和布局。桌宠缩放、气泡、面板、按钮位置都在这里。
- `package.json`：项目名称、入口、构建脚本和 electron-builder 配置。

## 服务模块

- `app/services/pet-data-store.js`：本地数据底座，使用 Electron `userData` 下的 `pet-data.json`。
- `app/services/memory-service.js`：用户记忆、长期记忆、短期记忆的增删改查和显式记忆意图识别。
- `app/services/prompt-builder.js`：Roxy 的动态 Prompt 构建、相关记忆选择和关系状态提示。
- `app/services/token-budget.js`：Prompt、记忆、history、用户输入和回复长度预算。
- `app/services/affection-service.js`：好感度分数、事件、档位、防刷和 Prompt 提示。
- `app/services/safe-shell-service.js`：自然语言到固定只读命令的本地解析、工作目录限制、白名单复核、一次性确认和受限 PowerShell 执行。

## v1.5.0 通用能力

- 记忆触发覆盖自然计划、目标、偏好、习惯与身份表达。
- “还记得 / 之前 / 上次”允许召回有限长期记忆，“继续刚才”允许召回有限短期记忆。
- 普通聊天可带入一条稳定用户画像，长期和短期记忆仍需相关性或明确召回意图。
- system prompt 字符预算为 9000，聊天 history 条数上限保持不变。
- 记忆写入不再用机械确认回复截断正常角色对话。
- Safe Shell 默认关闭，只执行固定只读白名单命令，并要求逐次确认。

## v1.6.0 回复表情动画

- `app/services/response-emotion-service.js` 在正常 AI 回复后执行可选的独立表情分类。
- 标准标签为 `happy`、`disgusted`、`tsundere`、`shocked`、`angry`、`blushing`、`helpless`。
- `app/config/pet-profile.js` 可配置 `spriteCell`、`spriteSheetSize`、`animationRows` 和 `responseEmotion`。
- 框架默认 `responseEmotion.enabled: false`，未配置表情图集的旧角色继续使用原有 `waving` 动画。
- 分类请求会移除本地路径、代码块和凭据样式文本，并限制上下文长度；分类失败不影响聊天回复。
- personality profile、记忆和 conversation harness 均不能启用该能力或修改动画资产配置。

## V1 LangGraph 新架构

V1 之后框架运行 LangGraph 新架构，相关目录和文件：

- `src/`：TypeScript 源码，包含五个 LangGraph（`ConversationGraph`、`OnboardingGraph`、`ProactiveGraph`、`ReflectionGraph`、`PlanningGraph`）、核心服务和内置技能。
- `dist/`：TypeScript 编译产物，打包后实际运行的 LangGraph 架构代码。
- `src/main/integration.ts` → `dist/main/integration.js`：新架构入口，由 `app/main.js` 通过 `require` 加载。
- `src/main/graph-dispatcher.ts` → `dist/main/graph-dispatcher.js`：Graph 调度器，负责按消息类型路由到对应 LangGraph。
- SQLite 数据库（`pet-data.sqlite`）是新架构的主数据源，包含 `memories`、`reminders`、`sessions`、`messages`、`reflection_jobs`、`event_outbox` 等表。
- `pet-data.json` 仅用于旧数据迁移，首次启动时幂等迁移到 SQLite，不覆盖旧文件。

运行时状态机：

```text
loading → langgraph_ready | initialization_failed
```

状态写入 `userData/architecture-status.json`，可通过 State 面板 "Agent 架构状态" 区域查看，或通过 `architecture:get-status` IPC 读取。新架构采用 no-silent-fallback 行为：加载失败时进入 `initialization_failed` 状态并在 UI 显示红色警告，不会静默回退到旧链路。

打包依赖：

- `@langchain/core` 和 `zod-to-json-schema` 必须在 `package.json` 的 `dependencies` 中，否则打包后新架构无法加载（会进入 `initialization_failed` 状态）。
- `app.asar` 内必须包含 `node_modules/@langchain/core/`、`node_modules/@langchain/langgraph/`、`node_modules/zod-to-json-schema/`。
- 可通过 `npm.cmd run test:packaged-new-arch` 自动验证打包产物是否包含上述依赖并实际启动新架构。

## V1 PlanningGraph 计划模式

V1 之后桌宠的"计划模式"由独立的 `PlanningGraph` LangGraph Agent 驱动，不再使用 `app/main.js` 中的 `callPlanningAI()` 直接 fetch + 强制 JSON 数组方案。相关目录和文件：

- `src/agent/graphs/planning/`：PlanningGraph 实现。
  - `state.ts`：`PlanningState` Annotation、`AgentAction`、`AgentActionType`（七种动作：`ask_clarification`、`create_draft`、`patch_tasks`、`delete_task`、`add_task`、`request_confirmation`、`publish_plan`）、`PlanningResponseDTO`。
  - `graph.ts`：StateGraph 定义与 `PlanningGraphRunner`。流程：`START → load_planning_context → agent_decide → execute_tool → build_response → persist_checkpoint → END`。
  - `tools.ts`：Zod 校验的 Planning Tools，所有写操作经此进入 repository，模型不得直接操作数据库或执行 SQL。
  - `nodes/load-planning-context.ts`：注入 TimeService 当前时间、时区、用户资料和现有计划上下文。
  - `nodes/agent-decide.ts`：调用 `ModelGateway`（使用 `planningModel` 别名），解析模型输出的动作 JSON。
  - `nodes/execute-tool.ts`：执行经 Zod 校验的动作；非法参数不写入数据库。
  - `nodes/build-response.ts`：构造 `PlanningResponseDTO`，包含 `resolvedModel` 和 `responseModel`。
  - `nodes/persist-checkpoint.ts`：使用持久化 checkpoint 保存完整规划对话；`publish_plan` 仅在 `userConfirmed === true` 时执行，否则保留 `draft` 状态。
  - `index.ts`：导出 `PlanningGraphRunner`。
- `src/infrastructure/database/repositories/plan-repository.ts`：plans / plan_tasks 仓库，支持 `lock_version` 乐观锁。
- `src/infrastructure/database/repositories/checkpoint-repository.ts`：planning checkpoint upsert（`INSERT OR REPLACE`）和消费。
- `src/infrastructure/database/migration-runner.ts` → V5 `planning_graph_constraints`：幂等增强 plans/plan_tasks 表，不修改 V4 已建表结构，只追加列、约束和触发器。
- `src/shared/constants/index.ts` → `MODEL_ALIAS.PLANNING = 'planningModel'`：新增可配置 planningModel 别名，映射到服务商真实 API model ID。
- `src/infrastructure/config/config-loader.ts` / `settings-repository.ts`：从 `app_settings` 读取 `planningModel` 解析值，不再硬编码。
- `app/main.js`：planning IPC handler 已替换为 `newArch.*` 调用，不再直接 fetch。
- `app/preload.js`：新增 `getPlanningModelInfo` IPC。
- `app/renderer.js`：计划模式独立消息历史，草案卡片与对话同时显示；模型信息显示实际解析值和 `response.model`。
- `app/index.html`：`#planningConversation` 和 `#planningModelView` 元素。
- `app/styles.css`：planning-conversation 样式。

### V5 Migration 字段说明

- `plans.draft_version`：草案版本号，每次 patch 递增。
- `plans.lock_version`：乐观锁版本，防止并发覆盖。
- `plans.resolved_model`：planningModel 别名解析到的实际模型 ID。
- `plans.response_model`：模型 API 返回的 `response.model`（真实调用模型）。
- `plans.user_confirmed`：用户是否明确确认发布（0/1）。
- `plan_tasks.draft_version`：任务级草案版本。
- 部分唯一索引 `idx_plans_active_unique_per_date`：同一日期只允许一个 active 计划。
- 触发器 `trg_plans_status_check_insert / _update`：status 只允许 `draft` / `active` / `completed`。

### PlanningGraph 设计约束

- 所有 planning 请求统一经过 `ModelGateway`，不得直接 fetch。
- 模型只能通过七种 `AgentActionType` 之一表达意图，不能直接操作 repository 或执行 SQL。
- 所有写操作通过经过 Zod 校验的 Planning Tools。
- `publish_plan` 必须要求明确用户确认；不能由模型擅自发布。
- 用户反馈优先 patch 当前草案，不得默认删除全部任务重建。
- 计划模式增加独立消息历史，草案卡片与对话同时显示。
- 输入框反馈、确认按钮、手动改时间都进入同一个 PlanningGraph。
- 保留 Planning Bubble 的 renderer 展示职责，不把 UI 放进 Graph。
- 不修改已有 migration V4，使用新的幂等 V5 migration。

## 数据与隐私

- API Key 存储在 Electron `userData` 下的 `api-config.json`，由 `app/main.js` 管理。
- 用户数据存储在 Electron `userData` 下的 `pet-data.json`，由 `pet-data-store.js` 管理。
- **V1 新架构主数据源为 SQLite 数据库 `pet-data.sqlite`**，位于 Electron `userData` 目录下，由 `dist/` 中的新架构服务管理；`pet-data.json` 仅用于旧数据迁移和兼容，不是主数据源。
- 这些运行时文件不在项目源码目录中，不应复制进框架模板。
- 不要把 API Key、用户记忆、聊天数据或好感度数据提交、打包或复制给别人。

## 不建议随便修改

- `app/main.js` 中的 API Key 加密/读取逻辑。
- `app/preload.js` 中的 IPC 暴露范围。
- `app/services/token-budget.js` 中的预算上限。
- `app/services/safe-shell-service.js` 中的只读白名单、工作目录和硬编码拒绝规则。
- `app/services/prompt-builder.js` 中的核心角色边界。
- `app/services/memory-service.js` 中的受控写入逻辑。

## 适合换皮时修改

v1.6 之后角色配置收敛为单一来源。换皮时优先只改 `app/config/pet-profile.js`：

- `displayName` / `characterName`：界面标题、Prompt 中的角色名。
- `userPetName`：菜单文案里使用的用户称呼。
- `localStorageNamespace`：localStorage 命名空间，避免角色之间数据串扰。
- `spriteSheet` / `usePlaceholderPet` / `spriteCell` / `spriteSheetSize` / `animationRows`：动画与图集配置。
- `responseEmotion`：回复表情开关、fallbackState 与持续时间。
- `conversationPersonalityId`：指向 `app/services/conversation-harness/personalities/` 下的固定 personality；如有需要可新增一个 personality 文件并在此处引用。
- `corePrompt` / `roleFidelity`：角色核心设定与角色还原约束。
- `defaultLanguage` / `defaultDrinkReminderText` / `defaultNightReminderText`：默认语言和提醒文案。

只在以下情况才需要修改其他文件：

- 调整面板视觉、按钮排版：`app/styles.css`、`app/index.html`。
- 修改应用名、appId：`package.json`。
- 增加全新的 personality 实现：`app/services/conversation-harness/personalities/`。

不要在 `app/renderer.js`、`app/main.js`、`app/services/prompt-builder.js`、`app/services/affection-service.js` 中直接硬编码角色名、用户称呼、动画图集路径或 localStorage 前缀。`test:character-residual` 会扫描这些文件中的 Roxy/昌昌 残留。

## 如何单独测试框架

1. 进入框架目录：

```powershell
cd D:\Documents\展示项目内容\roxy-electron-pet-framework
```

2. 安装依赖：

```powershell
npm.cmd install
```

3. 启动框架测试版：

```powershell
npm.cmd start
```

4. 如果要构建：

```powershell
npm.cmd run pack
```

5. 打开构建产物：

```text
release/win-unpacked/PetFramework.exe
```

框架默认使用 placeholder pet，不需要真实 spritesheet 也能启动。

## 无动画资产时的行为

框架读取：

```text
app/config/pet-profile.js
```

当 `usePlaceholderPet: true` 或 `spriteSheet` 为空时，界面会显示内置占位桌宠和“桌宠框架测试版”提示，不会白屏或崩溃。

创建新桌宠时只需替换：

- `app/assets/` 中的动画资源。
- `app/config/pet-profile.js` 中的角色配置。
- 如需新增 personality，在 `app/services/conversation-harness/personalities/` 下新增文件并在 `pet-profile.js` 中引用。

Safe Shell 是否展示为角色能力由产品文案决定，但角色配置不能扩大其白名单或绕过用户确认。

## 构建

更新正常构建目录：

```powershell
npm.cmd run pack
```

构建后必须验证 `app.asar` 修改时间和大小，确认新角色配置已经打入构建产物：

```powershell
Get-Item release\win-unpacked\resources\app.asar | Select-Object Name,Length,LastWriteTime
```

构建后测试：

```text
release/win-unpacked/PetFramework.exe
```

不要把旧 zip 当作最新版本发送。
