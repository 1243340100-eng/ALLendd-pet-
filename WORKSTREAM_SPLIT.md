# Roxy Framework 并行施工分工

## 目标

本文件把当前框架拆成两个可以同时施工、尽量不产生文本冲突的工作流：

1. GLM：后端、LangGraph、数据、IPC 和运行时能力。
2. KimiCode：桌宠窗口、面板和交互元素的外观调整。

这是文件所有权协议，不是功能设计文档。施工期间双方都只修改自己拥有的文件；任何跨线需求先走“接口申请”，不要直接修改对方文件。

当前框架工作区已有大量未提交的 V1 / v1.6 在途修改。任何人都不得 reset、checkout、clean、覆盖、批量格式化或删除已有内容。

## 当前真实边界

运行时主链路为：

~~~text
app/index.html + app/styles.css
        ↓
app/renderer.js
        ↓  window.petAPI
app/preload.js
        ↓  IPC
app/main.js
        ↓
dist/main/integration.js
        ↓
src/ 的 LangGraph、SQLite、角色包、技能和调度能力
~~~

注意：app/renderer.js 虽然位于渲染进程，但它同时管理 DOM、聊天、记忆、Onboarding、状态面板和 IPC 调用。它不是纯外观文件，必须由 GLM 作为“受控桥接层”独占，KimiCode 不得修改。

## 文件所有权总表

| 工作线 | 独占文件 / 目录 | 可以做什么 | 不得修改 |
| --- | --- | --- | --- |
| GLM 后端 | src/** | LangGraph、SQLite、模型网关、技能、角色包加载、调度、反思、TypeScript 测试 | app/index.html、app/styles.css、app/assets/ui/** |
| GLM 后端 | tests/**、app/services/** | 新架构和旧链路兼容、服务测试、回归测试 | 仅为“好看”而改 renderer 或 CSS |
| GLM 后端 | app/main.js、app/preload.js、app/renderer.js | IPC、行为接线、数据加载、事件订阅和 UI 行为；保持现有视觉结构 | 改变 Kimi 正在施工的 HTML 布局或样式 |
| GLM 后端 | app/config/pet-profile.js、character-packs/default/manifest.json、persona.json、prompt.md、motion-map.json、spritesheet/spritesheet.json | 角色身份、动作语义、角色包配置、动画元数据 | 像素美术重绘 |
| GLM 后端 | package.json、package-lock.json、tsconfig.json | 依赖、构建和 TypeScript 配置 | 未经必要性说明增加依赖 |
| KimiCode 外观 | app/index.html、app/styles.css | 布局、视觉层级、颜色、排版、动效、面板外观、无行为的辅助 DOM | app/renderer.js、app/preload.js、app/main.js、src/**、tests/** |
| KimiCode 外观 | app/assets/ui/**（新建且独占） | 图标、背景、装饰性图片、主题资产 | 改动角色包的逻辑或配置 |
| KimiCode 外观 | app/assets/placeholder-pet.svg、app/assets/roxy-spritesheet.webp、character-packs/default/spritesheet/atlas.webp（仅像素资产例外） | 仅在文件名、画布尺寸、格子布局和帧数完全不变时替换美术 | spritesheet.json、motion-map.json、manifest.json，或任何尺寸 / 行列变化 |
| 集成负责人 | dist/**、release/**、node_modules/**、asar-list.txt、app.asar | 合并后统一编译、打包、验收 | 手工编辑生成物；两条线并行时运行 pack |

dist 是由 src 编译产生的结果，任何人都不得手工编辑。release、app.asar、node_modules 和打包清单也不是施工文件。

## KimiCode 的外观安全边界

KimiCode 可以重做界面视觉，但必须保留 renderer 当前依赖的所有 id、表单类型、提交按钮和脚本顺序。可以添加 wrapper、class、装饰元素和新的纯 CSS 动画；不能删除、改名或复制既有 id。

至少必须保留以下分组：

| 分组 | 必须保留的 DOM 契约 |
| --- | --- |
| 桌宠舞台 | stage、pet、bubble、controls、frameworkNotice |
| API 面板 | apiPanel、apiSettings、apiClose、apiEndpoint、apiModel、apiKey、apiSave、apiClearKey、apiStatus、drinkReminderText、nightReminderText |
| 聊天面板 | chatToggle、chatPanel、chatClose、chatLog、chatForm、chatInput、chatSend |
| 状态与记忆 | stateToggle、statePanel、stateClose、stateStatus、affectionView、promptStatsView、archStatusView、userMemoryList、longTermMemoryList、shortTermMemoryList、shortTermMemoryNote、各 clear / export 按钮 |
| 提醒 | reminderList、refreshReminders、triggerDailyDigest、triggerReminderCheck |
| Onboarding | onboardingPanel、onboardingMessage、onboardingForm，以及全部以 ob 开头的输入控件 |
| 语言与标签 | languageToggle、drinkReminderLabel、nightReminderLabel |

下列选择器也由 renderer 用于语言切换或行为定位，不能删改其语义：.api-panel__head、.chat-panel__head、.state-panel__head、.state-block、API 面板中 label 的顺序、Onboarding 表单中的 submit 按钮。

app/index.html 中的加载顺序必须保持为：

~~~text
styles.css
→ config/pet-profile.js
→ renderer.js
~~~

外观线新增的元素默认只能是静态或 CSS 驱动的。若新元素需要读取数据、发送 IPC、显示加载状态或响应点击，KimiCode 先提出接口申请，不能自行修改 renderer.js。

## GLM 的接口变更规则

GLM 新增运行时能力时，必须完整维护以下同一条链路：

~~~text
src/shared/schemas/ipc.ts（输入校验）
→ app/main.js（IPC handler）
→ app/preload.js（最小化 window.petAPI 暴露）
→ app/renderer.js（实际行为接线）
~~~

如涉及类型或公开 DTO，还要同步 src/preload/api-contract.ts、src/shared/contracts/** 或 src/shared/dto/**。

接口必须保持旧调用兼容；不得为了后端重构而重命名现有 window.petAPI 方法、IPC channel 或上述受保护 DOM id。新增接口完成后，GLM 向 KimiCode 提供一份不超过六项的接口说明：

1. 功能名和可用场景。
2. window.petAPI 方法名或事件名。
3. 请求字段。
4. 成功返回值。
5. 失败 / 不可用时的返回值。
6. Kimi 需要呈现的 loading、empty 或 error 状态。

KimiCode 根据这份说明只改 HTML/CSS；GLM 负责 renderer 行为接线。

## 并行前的必须准备

不要让两个人在同一个物理目录中同时运行。当前工作树并不干净，先由项目负责人把当前 V1 / v1.6 状态做成可恢复的基线提交，或保存一份完整补丁；这一步需要保留所有当前已修改和未跟踪文件。

基线存在后，在框架子仓库中建立两个独立 worktree 或两个独立副本：

~~~powershell
cd "D:\Documents\展示项目内容\roxy-electron-pet-framework"
git worktree add ..\roxy-framework-glm -b glm/backend
git worktree add ..\roxy-framework-kimi -b kimi/ui
~~~

GLM 只在 roxy-framework-glm 施工，KimiCode 只在 roxy-framework-kimi 施工。不要共享 node_modules、Electron userData、release 目录或一个正在运行的应用实例。

框架是独立 Git 仓库；各自先在框架仓库完成提交。两个分支合并到框架主线后，最后再由集成负责人更新根仓库中的框架指针。

## 每条线的执行与验收

### GLM 后端

每个小功能只触及自己的文件。建议按能力分支拆分，例如：

- 对话和模型：src/agent/graphs/conversation/**、src/services/ModelGateway.ts。
- 提醒和主动事件：src/agent/graphs/proactive/**、src/services/SchedulerService.ts。
- 记忆和反思：src/agent/graphs/reflection/**、src/services/MemoryStore.ts、相关 repository。
- Onboarding 和角色包：src/agent/graphs/onboarding/**、src/services/CharacterPackManager.ts。

每次提交至少运行与改动相称的检查，例如：

~~~powershell
npm.cmd run typecheck
npm.cmd run test:contracts
npm.cmd run test:conversation
npm.cmd run test:database
~~~

不要在 KimiCode 施工期间运行 npm install、npm run build:ts、npm run pack 或改 package-lock，除非该任务确实是 GLM 的依赖 / 构建任务并已通知集成负责人。

### KimiCode 外观

外观任务应按页面区域分拆在同一份 styles.css 中的独立注释区，或新建 app/assets/ui/** 与由 index.html 引入的额外样式文件。推荐区域：

1. 桌宠舞台与气泡。
2. API / Chat / State 三类面板。
3. Onboarding 表单。
4. 状态、记忆和提醒列表。
5. 响应式尺寸、动效与无障碍对比度。

KimiCode 只需要用隔离的 userData 启动视觉预览；不得为视觉调试改动 API Key、用户记忆、聊天记录或数据库。不得运行 pack，也不得修改生成物。

## 集成顺序

1. 先合并 GLM 的纯后端提交。
2. 检查 IPC 契约没有破坏现有 renderer。
3. 再合并 KimiCode 的 HTML / CSS / 视觉资产提交。
4. 由集成负责人一次性运行 TypeScript 编译、相关单测和打包版新架构测试。
5. 最后运行 npm.cmd run pack，并确认 release-ui-fix/win-unpacked/resources/app.asar 和 PetFramework.exe 已更新。

若同一功能既需要新后端数据又需要新控件，采用“两阶段交付”：

1. KimiCode 先交付静态占位的视觉组件，不接行为。
2. GLM 交付固定 IPC 契约并在 renderer.js 接线。
3. KimiCode 只补齐 CSS 状态，不触及行为代码。

## 可直接交给模型的任务提示

### 给 GLM

~~~text
你负责 Roxy Electron Pet Framework 的后端工作。先阅读 WORKSTREAM_SPLIT.md。
你只能修改：src/**、tests/**、app/services/**、app/main.js、app/preload.js、app/renderer.js（仅行为/IPC）、app/config/pet-profile.js、角色包配置文件、package*.json 和 tsconfig.json。
不要修改 app/index.html、app/styles.css、app/assets/ui/**，也不要手工编辑 dist、release、node_modules 或 app.asar。
新增 UI 能力时保持 window.petAPI 和已有 IPC 兼容，并提供简短的接口说明给前端。不要清理或覆盖现有未提交修改。
~~~

### 给 KimiCode

~~~text
你负责 Roxy Electron Pet Framework 的纯前端外观。先阅读 WORKSTREAM_SPLIT.md。
你只能修改：app/index.html、app/styles.css、app/assets/ui/**，以及在不改变尺寸、格子、文件名和帧数前提下的指定像素资产。
严禁修改 app/renderer.js、app/preload.js、app/main.js、src/**、tests/**、package*.json、角色包 JSON 或生成物。
你可以重做视觉，但必须保留所有既有 id、表单语义、受保护 class 和脚本加载顺序。新元素默认只做静态/CSS 效果；需要数据或点击行为时提出接口申请，不要自己接 IPC。
~~~

## 出现冲突时的裁决

1. 角色身份、数据、安全、权限、IPC、数据库和动画元数据优先级高于外观。
2. 已有 window.petAPI、IPC channel、DOM id 和脚本加载顺序视为兼容性契约。
3. 外观需求可以改变布局，但不能破坏 renderer 依赖；后端需求不能以方便为由重排或重命名视觉 DOM。
4. 不确定某文件归属时，停止修改并交由集成负责人决定；不要“顺手修一下”对方文件。
