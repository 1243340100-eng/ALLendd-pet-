# v1.6 Conversation Harness Handoff

## What This Architecture Is

This project adds a reusable AI conversation harness for an Electron desktop pet framework. The harness is not a fixed character chatbot. It is a control layer that decides how the assistant should respond before the final LLM reply is generated.

The core flow is:

```text
user_message
-> Conversation Analyzer
-> Boundary Engine
-> Policy / Persona Controller
-> Playfulness Gate
-> Dialogue Planner
-> Response Generator / Prompt Builder
-> Post-check / Rewrite
-> assistant_message
-> update conversation state
```

The goal is to let different personality profiles share the same safety, boundary, pacing, and planning logic while expressing themselves differently.

## Main Entry Point

The core API is:

```js
const {
  handleUserMessage,
  createDefaultConversationState,
  getPersonalityProfile
} = require('./app/services/conversation-harness');

const result = await handleUserMessage(
  userMessage,
  conversationState,
  getPersonalityProfile('warm_friend')
);
```

The returned object includes:

```js
{
  message,
  newState,
  analysis,
  policy,
  plan,
  postCheck,
  prompt
}
```

## Directory Map

```text
app/services/conversation-harness/
  index.js
  types.js
  core/handle-user-message.js
  state/conversation-state.js
  analyzer/conversation-analyzer.js
  analyzer/boundary-engine.js
  policy/policy-controller.js
  policy/playfulness-gate.js
  planner/dialogue-planner.js
  generator/response-generator.js
  generator/prompt-builder.js
  generator/llm-client.js
  postcheck/post-check.js
  personalities/
  demo/run-demo.js
  tests/
```

## Implemented Modules

### Conversation State

`state/conversation-state.js` maintains turn-level state:

- turn index
- current topic and topic history
- lead mode
- user energy, emotion, and task pressure
- boundary pressure
- repeated revision count
- playfulness budget and last playful turn
- current response depth
- pending topic seeds
- recent assistant moves

The state is normalized before use and updated after each harness turn.

### Personality Profiles

Three profiles are included:

- `warm_friend`: warm, friendly, lightly opinionated.
- `calm_expert`: rational, concise, bounded, almost never playful.
- `playful_companion`: relaxed, lightly teasing at low frequency, still serious when needed.

Profiles control tone and behavior through:

- base tone values
- dialogue behavior
- boundary style
- playfulness policy
- language style

The harness reads the profile instead of hardcoding one personality.

### Conversation Analyzer

`analyzer/conversation-analyzer.js` classifies the user message:

- intent strength: weak, medium, strong
- user mode: asking, requesting task, sharing idea, agreeing, venting, correcting direction, casual chat
- task type: coding, architecture design, writing, analysis, emotional support, brainstorming, etc.
- wanted depth
- direct-answer need
- user energy and emotion
- task pressure
- safety risk

It is rule-based in v1.6 and leaves room for a future LLM classifier.

### Boundary Engine

`analyzer/boundary-engine.js` detects:

- reasonable requests
- heavy but acceptable requests
- excessive requests
- abusive/commanding requests
- unsafe requests

This allows the assistant to narrow scope, push back, or refuse before the final LLM generates text.

### Policy Controller

`policy/policy-controller.js` combines:

- analysis
- state
- personality profile

It outputs:

- lead mode
- response depth
- boundary action
- playfulness decision
- max main points
- whether to ask a question
- tone hints

### Playfulness Gate

`policy/playfulness-gate.js` prevents high-frequency or inappropriate playful behavior.

It blocks playfulness when:

- safety risk exists
- task pressure is high
- user is distressed or frustrated
- request is excessive or abusive
- playfulness budget is exhausted
- not enough turns have passed since the last playful move

Playfulness is never treated as a condition for completing the user task.

### Dialogue Planner

`planner/dialogue-planner.js` creates a plan instead of generating the final answer directly.

The plan includes:

- goal
- opening style
- response structure
- pacing
- required inclusions
- things to avoid
- whether to ask a question at the end

### Response Generator Interface

`generator/response-generator.js` provides an MVP generator. It can use a mock/template response or be wired to an external LLM later.

`generator/prompt-builder.js` builds a prompt containing:

- user message
- analysis
- policy
- plan
- personality profile

The final model is instructed to follow the upstream policy instead of deciding playfulness, refusal, or lead mode freely.

### Post-check

`postcheck/post-check.js` detects:

- response too long
- template-like phrasing
- ignored user intent
- unwanted playfulness
- missing boundary action
- too many questions

It can perform a simple rewrite when needed.

## Electron Integration

The harness is integrated into `app/main.js` inside the chat path.

Current behavior:

1. User sends a normal chat message.
2. Existing memory system runs independently.
3. `sendChatMessage()` calls the conversation harness.
4. Harness output is saved in `pet-data.prompt.conversationHarnessState`.
5. Harness policy and plan are passed into the existing Prompt Builder.
6. The existing configured API/model still generates the final chat response.

The harness does not replace:

- API config
- memory system
- affection system
- token budget
- existing chat IPC
- Safe Shell local intent parsing and command policy

## Memory Recall Integration

v1.6.0 keeps memory selection outside the harness:

- recall phrases such as “还记得 / 之前 / 上次” can retrieve bounded long-term memories;
- continuation phrases such as “继续刚才” can retrieve bounded short-term memories;
- ordinary chat may include one stable user-profile memory;
- the harness still cannot write memory or change memory budgets directly.

Memory writes continue into the normal character reply path and do not produce a scripted confirmation that bypasses the configured character.

## Safe Shell Integration

Safe Shell runs before memory analysis and normal AI chat:

```text
user message
-> local Safe Shell intent parser
-> fixed read-only allowlist
-> one-time user confirmation
-> local restricted execution
```

If the message is not a supported command request, it proceeds to memory analysis and the conversation harness normally. The harness and personality profile cannot expand the command allowlist or remove confirmation.

## Prompt Integration

`app/services/prompt-builder.js` adds a section named:

```text
【对话策略控制】
```

This section includes:

- leadMode
- responseDepth
- boundaryAction
- playfulness
- maxMainPoints
- openingStyle
- pacing
- mustInclude
- mustAvoid
- toneHints

The model is told to follow these controls and not freely add playfulness, refusal, or topic-leading outside the policy.

## Commands

Install dependencies after extracting:

```powershell
npm.cmd install
```

Run harness tests:

```powershell
npm.cmd run test:harness
```

Run memory and Safe Shell tests:

```powershell
npm.cmd run test:memory-flow
npm.cmd run test:shell
```

Run harness demo:

```powershell
npm.cmd run demo:harness
```

Run the Electron app from source:

```powershell
npm start
```

Build unpacked Windows test app:

```powershell
npm.cmd run pack
```

## Current Test Coverage

The harness tests cover:

- strong architecture request -> `user_leads`
- weak continuation like "嗯，对" -> `ai_soft_leads`
- high pressure forbids playfulness
- distressed emotion forbids playfulness
- excessive request narrows scope
- different profiles produce different tone/playfulness policy
- playfulness cannot appear too frequently
- tease depth forces `maxMainPoints = 1`
- safety risk forces `refuse_and_redirect`
- post-check detects unwanted playfulness

## Extension Points

Future developers can extend:

- new personality profiles under `personalities/` (only for new packaged characters; do not add runtime switching UI, see `CHARACTER_PACKAGING_GUIDE.md`)
- richer analyzer rules or LLM classification
- more detailed boundary detection
- real LLM-backed response generation
- State panel display for harness analysis/policy
- improved post-check rewrite logic

Do not add a UI that lets the end user switch `conversationPersonalityId` at runtime. A packaged build must correspond to exactly one fixed character; runtime personality switching is explicitly forbidden by `CHARACTER_PACKAGING_GUIDE.md`.

## v1.6.0 Response Emotion Boundary

`app/services/response-emotion-service.js` runs after the normal character reply has already been generated. It selects only an animation label and does not rewrite the reply, change harness policy, store memory, or grant capabilities.

The main process calls it only when `petProfile.responseEmotion.enabled` is true. The renderer accepts the returned label only when that label exists in `petProfile.animationRows`; otherwise it uses the configured fallback animation.

## Development Principles

- Harness controls hard decisions.
- Personality profile controls soft style.
- Safety and boundary rules are shared by all profiles.
- Playfulness is low-frequency seasoning, not a bargaining condition.
- Weak user intent lets AI gently continue.
- Strong user intent makes AI complete the task directly.
- Information should be paced, not dumped all at once.

## V1 PlanningGraph Handoff

V1 之后框架新增第五个 LangGraph：`PlanningGraph`。它独立于 Conversation Harness，专门负责"计划模式"的多轮规划对话。Conversation Harness 仍处理普通聊天；当用户进入计划模式时，消息路由到 PlanningGraph，不经过 Conversation Analyzer / Boundary Engine / Playfulness Gate。

### 定位

PlanningGraph 是一个真正的 LangGraph Agent，不是直接 fetch + 强制 JSON 数组的旧方案。它能够：

- `ask_clarification`：目标模糊时先询问关键问题，不编造时间表。
- `create_draft`：信息充分时直接生成草案。
- `patch_tasks`：按用户反馈局部修改任务（"下午不要太满"、"把第二项推迟半小时"）。
- `delete_task`：删除指定任务，不改变其他任务。
- `add_task`：追加新任务。
- `request_confirmation`：请求用户确认。
- `publish_plan`：在明确用户确认后发布计划。

模型不能直接操作 repository 或执行 SQL；所有写操作通过经过 Zod 校验的 Planning Tools。`publish_plan` 必须要求明确用户确认，不能由模型擅自发布。

### 目录映射

```text
src/agent/graphs/planning/
  state.ts                          # PlanningState Annotation、AgentAction、PlanningResponseDTO
  graph.ts                          # StateGraph 定义与 PlanningGraphRunner
  tools.ts                          # Zod 校验的 Planning Tools
  index.ts                          # 导出
  nodes/
    load-planning-context.ts        # 注入 TimeService、用户资料、现有计划
    agent-decide.ts                 # 调用 ModelGateway（planningModel 别名）
    execute-tool.ts                 # 执行经 Zod 校验的动作
    build-response.ts               # 构造 PlanningResponseDTO
    persist-checkpoint.ts           # 持久化 checkpoint，条件发布
```

### 流程

```text
START
→ load_planning_context   # TimeService 当前时间、时区、用户资料、现有计划
→ agent_decide            # ModelGateway 调用，解析动作 JSON
→ execute_tool            # Zod 校验后执行写操作
→ build_response          # 构造 DTO（含 resolvedModel / responseModel）
→ persist_checkpoint      # checkpoint upsert，条件 publish_plan
→ END
```

### 模型配置

PlanningGraph 使用 `planningModel` 别名，映射到服务商真实 API model ID：

```text
src/shared/constants/index.ts → MODEL_ALIAS.PLANNING = 'planningModel'
```

实际解析值从 `app_settings` 表读取。状态面板 `#planningModelView` 显示 `resolvedModel`（别名解析值）和 `responseModel`（API 返回的 `response.model`），不允许显示别名冒充实际模型。

### 持久化与恢复

- PlanningGraph 使用持久化 checkpoint 保存完整规划对话（`checkpointRepository`，`INSERT OR REPLACE` 语义）。
- 重启后可恢复规划对话、草案版本和 active 气泡。
- 草案版本 `draft_version` 每次 patch 递增。
- 并发保护通过 `lock_version` 乐观锁实现。

### 数据库约束（V5 migration）

V5 `planning_graph_constraints` 是幂等 migration，不修改 V4 已建表结构，只追加：

- `plans.draft_version` / `plans.lock_version` / `plans.resolved_model` / `plans.response_model` / `plans.user_confirmed`
- `plan_tasks.draft_version`
- 部分唯一索引 `idx_plans_active_unique_per_date`（同一日期只允许一个 active 计划）
- 触发器 `trg_plans_status_check_insert / _update`（status 只允许 `draft` / `active` / `completed`）

### UI 职责分离

PlanningGraph 保留 Planning Bubble 的 renderer 展示职责，不把 UI 放进 Graph：

- `app/index.html`：`#planningConversation`（独立消息历史）和 `#planningModelView`（模型信息）。
- `app/renderer.js`：草案卡片与对话同时显示；输入框反馈、确认按钮、手动改时间都进入同一个 PlanningGraph。
- `app/styles.css`：planning-conversation 样式。

### 与 Conversation Harness 的关系

- 普通聊天仍走 Conversation Harness（Analyzer → Boundary → Policy → Planner → Generator）。
- 计划模式消息路由到 PlanningGraph，不经过 Conversation Harness。
- 两者共享 `ModelGateway`、`TimeService`、`UserContextService` 等基础设施，但状态和消息历史独立。
- PlanningGraph 不修改 Conversation Harness 的 policy、playfulness 或 boundary 规则。

### 测试覆盖

`tests/unit/planning-graph.test.ts` 覆盖 13 个场景：

1. 模糊目标会先询问关键问题，不直接编造时间表。
2. 信息充分时不进行多余询问，直接生成草案。
3. "下午不要太满"能按约束修改。
4. "把第二项推迟半小时"只修改目标任务。
5. "删除代码审查"不会改变其他任务。
6. 对话中说"就这样"与点击确认按钮产生相同发布结果。
7. 未明确确认时模型不能发布计划。
8. 当前时间之后才允许安排未开始任务。
9. 重启后恢复规划对话、草案版本和 active 气泡。
10. 模型输出非法参数时不能写入数据库。
11. 同时确认两次只能产生一个 active 计划。
12. 状态面板能看到实际调用的模型，不允许显示别名冒充实际模型。
13. 打包版通过真实 PetFramework.exe 验证 PlanningGraph 已接入。
