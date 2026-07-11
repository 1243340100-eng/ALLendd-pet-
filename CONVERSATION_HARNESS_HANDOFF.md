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
