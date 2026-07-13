# 桌宠框架自定义指南

这是可复用 Electron 桌宠框架；当前默认角色包为 Blue，采用九行基础动作 spritesheet。

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

4. 构建框架测试版：

```powershell
npm.cmd run pack
```

5. 打开：

```text
release-ui-fix/win-unpacked/PetFramework.exe
```

框架默认使用 Blue 的真实 spritesheet；在角色包或资源加载失败时会降级为 placeholder pet，仍可测试 API 设置、聊天、状态面板、记忆、好感度、语言切换和提醒词设置。

v1.6.0 还可以测试更主动但有预算限制的记忆召回、默认关闭的 Safe Shell 自然语言只读诊断，以及按角色资产配置的 AI 回复表情动画。

## 配置回复表情动画

先准备包含标准表情行的透明 spritesheet，再在 `app/config/pet-profile.js` 中配置：

```js
spriteCell: { width: 192, height: 208 },
spriteSheetSize: { width: 1536, height: 3328 },
animationRows: {
  happy: { row: 9, frames: 6, fps: 6 },
  disgusted: { row: 10, frames: 6, fps: 5 },
  tsundere: { row: 11, frames: 6, fps: 5 },
  shocked: { row: 12, frames: 6, fps: 7 },
  angry: { row: 13, frames: 6, fps: 7 },
  blushing: { row: 14, frames: 6, fps: 5 },
  helpless: { row: 15, frames: 6, fps: 5 }
},
responseEmotion: {
  enabled: true,
  durationMs: 6500,
  fallbackState: 'waving'
}
```

只有图集尺寸、行号和帧数全部核对后才开启 `enabled`。表情分类会增加一次小型 AI 请求，但失败时会自动使用本地兜底并继续聊天。

## 无动画资产时的行为

如果 `app/config/pet-profile.js` 中：

```js
usePlaceholderPet: true
```

或者 `spriteSheet` 为空，框架会显示内置占位桌宠：

```text
app/assets/placeholder-pet.svg
```

界面会显示“桌宠框架测试版 / Pet Framework Test Mode”提示，不会崩溃。

## 创建新桌宠的步骤

v1.6 之后角色配置收敛到 `app/config/pet-profile.js` 作为单一来源。换皮步骤：

1. 复制 `roxy-electron-pet-framework` 为新目录。
2. 修改 `package.json` 的 `name`、`build.appId`、`build.productName`。
3. 替换 `app/assets` 中的动画资源。
4. 修改 `app/config/pet-profile.js`：角色名、`userPetName`、`localStorageNamespace`、`spriteSheet`、`spriteCell`、`spriteSheetSize`、`animationRows`、`responseEmotion`、`corePrompt`、`roleFidelity`、默认提醒词和语言。
5. 如需新增 personality，在 `app/services/conversation-harness/personalities/` 下新增文件，并在 `pet-profile.js` 的 `conversationPersonalityId` 中引用。
6. 执行 `npm.cmd install`。
7. 执行 `npm.cmd run test:character`、`test:harness`、`test:emotion`、`test:character-residual`、`test:sprite-config` 全部通过。
8. 执行 `npm.cmd start` 手动测试。
9. 执行 `npm.cmd run pack` 构建。
10. 打开 `release-ui-fix/win-unpacked/*.exe` 做 smoke test。
11. 验证 `app.asar` 的修改时间和内容大小，确认构建产物包含新角色配置。

不要复制 API Key、`pet-data.json`、`api-config.json`、用户记忆、用户聊天数据、`node_modules` 或旧 `release`。

不要直接修改 `app/renderer.js`、`app/main.js`、`app/services/prompt-builder.js`、`app/services/affection-service.js` 中的角色名、用户称呼、动画图集路径或 localStorage 前缀；这些值都应通过 `pet-profile.js` 注入。`test:character-residual` 会扫描 Roxy/昌昌 残留。

## 1. 更换桌宠动画资产

默认动画文件由 `pet-profile.js` 的 `spriteSheet` 字段指定。占位资产：

```text
app/assets/placeholder-pet.svg
```

替换方式：

1. 准备新的透明背景 spritesheet。
2. 放入 `app/assets/`。
3. 在 `app/config/pet-profile.js` 中修改：
   - `spriteSheet`：指向新资源路径（相对 `app/`）
   - `usePlaceholderPet`：设为 `false`
   - `spriteCell`：`{ width, height }` 单帧尺寸
   - `spriteSheetSize`：`{ width, height }` 整图尺寸
   - `animationRows`：每行动画的 `row`、`frames`、`fps`

renderer 内置的 `baseRows` 提供以下默认行布局，可通过 `animationRows` 覆盖或新增：

- `idle` (row 0)
- `running-right` (row 1)
- `running-left` (row 2)
- `waving` (row 3)
- `jumping` (row 4)
- `failed` (row 5)
- `waiting` (row 6)
- `running` (row 7)
- `review` (row 8)

如果新 spritesheet 的行顺序不同，在 `animationRows` 中覆盖即可，无需修改 `renderer.js`。`test:sprite-config` 会校验尺寸整除、行号/帧数越界和 `fallbackState` 真实存在。

## 状态面板导入临时动作素材

当需要在不修改默认角色包的情况下验收或试用一套动作图时：

1. 打开桌宠的“状态”面板，点击“打开素材库”。
2. 在“应用方式”中保留“导入后立即应用”，点击带加号的导入卡片。
3. 选择 PNG 或 WebP 动作图集。当前版本要求尺寸为 `1536 × 1872`，即 `8 × 9` 格、单格 `192 × 208`，动作行顺序与默认 Blue 一致。
4. 素材会复制到 Electron `userData/runtime-materials/`，而不是写入 `app/assets/` 或 `character-packs/default/`；可在列表中切换，也可“还原默认 Blue”。

“清除所有数据并重新初始化”会删除上述用户导入素材，以及 SQLite、聊天、记忆、计划、提醒、初始化记录和 API 配置，随后重启并从 LangGraph 首次初始化开始。它不会删除打包在应用资源中的默认 Blue 动作素材。

## 2. 修改角色名称

只修改 `app/config/pet-profile.js`：

- `displayName`：界面标题、`document.title`
- `characterName`：Prompt 中的角色名、好感度提示、菜单文案
- `userPetName`：主进程菜单中使用的用户称呼
- `localStorageNamespace`：localStorage 命名空间前缀

`package.json` 中的 `name`、`description`、`build.productName`、`build.appId` 仍需单独修改。

## 3. 修改角色 Prompt

文件：

```text
app/config/pet-profile.js
```

修改 `corePrompt` 和 `roleFidelity` 即可。`prompt-builder.js` 会自动读取这些字段。

建议只改角色核心设定和回复风格，不要删除 `roleFidelity` 中的：

- 安全边界
- 记忆注入限制
- 好感度关系提示
- 输出限制

Prompt 体积控制在：

```text
app/services/token-budget.js
```

不要随意扩大 `historyMaxMessages` 或记忆注入数量。

当前 system prompt 字符预算为 9000，用于容纳固定角色设定、角色还原约束、harness 和少量相关记忆。换皮后如角色档案明显变长，应先查看 State 面板中的 Prompt 警告，不要直接扩大聊天 history。

记忆召回约定：

- “还记得 / 之前 / 上次”可以放宽长期记忆的精确关键词要求。
- “继续刚才”可以放宽短期记忆的精确关键词要求。
- 普通聊天只额外带入少量稳定用户画像，不注入全部记忆。
- 记忆写入后仍由当前角色自然回复，不使用机械确认话术。

## 3.1 Safe Shell

文件：

```text
app/services/safe-shell-service.js
```

默认关闭；首次执行和后续每条命令都需要用户确认。所有命令均为只读诊断，分为两类：

- **项目诊断**：仅作用于应用工作目录内的非敏感路径，例如 `Get-ChildItem`、`Get-Item`、`Test-Path`、`node --check`、`git status`、`git log`、`git diff`、`node --version`、`npm --version`、`Get-Location`。
- **系统诊断**：会读取整机范围的只读信息，但不修改任何系统状态，例如 `Get-Process | Select-Object Name,Id`、`Get-Service`、`Get-Service | Where-Object Status -eq Running | Format-Table Name,Status`。

`git diff` 输出在送入 LLM 之前会经过脱敏处理，掩码形如密钥、令牌、本地路径与网络路径的字符串，避免源码或敏感改动直接被 AI 看到。

可识别的自然语言示例：

- “帮我看看当前目录有哪些文件”
- “查看正在运行的进程”
- “看看 Git 仓库有什么改动”
- “Node 是什么版本”
- “检查这个 JS 文件的语法”

禁止通过换皮、角色 Prompt 或 personality profile 增加删除、写入、下载、提权、系统控制或任意命令执行能力。

## 4. 修改产品名和图标

产品名：

```text
package.json
```

重点字段：

- `name`
- `description`
- `build.appId`
- `build.productName`

图标：当前未设置应用图标。需要图标时，可在 `package.json` 的 `build.win.icon` 中增加 `.ico` 路径。

## 5. 修改提醒词默认值

默认提醒词在 `app/config/pet-profile.js` 中：

- `defaultDrinkReminderText`
- `defaultNightReminderText`

用户在设置面板中自定义的提醒词会存入 localStorage，键名基于 `localStorageNamespace`：

- `${namespace}-drinkReminderText`
- `${namespace}-nightReminderText`

例如 `localStorageNamespace: 'roxy'` 时键为 `roxy-drinkReminderText`。换皮后修改 `localStorageNamespace` 即可避免与旧角色数据串扰。

自定义提醒词不会自动翻译。

## 6. 修改语言文案

默认语言在 `pet-profile.js` 的 `defaultLanguage` 中设置。i18n 文案在 `app/renderer.js` 的 `i18n.zh` / `i18n.en` 中。

修改 `i18n` 字典即可，文案中可用 `{name}` 等占位符引用 `petProfile.characterName`。  
不要翻译用户保存的记忆内容，也不要强制翻译 AI 回复内容。

## 7. 数据与隐私

不要复制或打包这些运行时数据：

- API Key
- `api-config.json`
- `pet-data.json`
- 用户记忆
- 用户聊天数据
- 用户好感度数据
- `release/`
- `node_modules/`
- zip / rar / 7z

Electron 运行时数据位于系统的 `userData` 目录，不在本框架目录中。

## 8. 安装和构建

复制框架后先安装依赖：

```powershell
npm.cmd install
```

本地启动：

```powershell
npm.cmd start
```

更新 Windows 构建目录：

```powershell
npm.cmd run pack
```

构建结果在：

```text
release-ui-fix/win-unpacked/
```

不要在未确认前生成 zip / rar / 7z。

## 9. 新桌宠检查清单

- 已替换 spritesheet。
- 已在 `pet-profile.js` 中检查 `spriteCell`、`spriteSheetSize`、`animationRows`、`responseEmotion.fallbackState`。
- 已在 `pet-profile.js` 中修改 `displayName`、`characterName`、`userPetName`、`localStorageNamespace`。
- 已在 `pet-profile.js` 中修改 `corePrompt` 和 `roleFidelity`。
- 已修改 `package.json` 产品名和 appId。
- 已确认 API Key 不在源码里。
- 已确认 `pet-data.json` 没有复制进模板。
- 已运行 `npm.cmd run test:character`（角色 fidelity 与示例对话结构）。
- 已运行 `npm.cmd run test:harness`（含 final-reply post-check 集成测试）。
- 已运行 `npm.cmd run test:emotion`（含表情行为集成测试）。
- 已运行 `npm.cmd run test:character-residual`（Roxy/昌昌 残留扫描）。
- 已运行 `npm.cmd run test:sprite-config`（图集尺寸与 fallbackState 校验）。
- 已运行 `npm.cmd run test:memory-flow`。
- 已运行 `npm.cmd run test:shell`。
- 已运行 `npm.cmd run test:crash-recovery`。
- 已运行 `npm.cmd run test:api-security`。
- 已运行 `npm.cmd run pack`。
- 已验证 `release-ui-fix/win-unpacked/resources/app.asar` 修改时间与大小（确认包含新角色配置）。
- 已打开 `release-ui-fix/win-unpacked/*.exe` 做 smoke test。

## 新架构状态查看

框架在 V1 之后运行 LangGraph 新架构，可通过以下方式确认新架构是否正常工作：

1. 打开 State 面板（点击"状态"按钮）。
2. 查看 "Agent 架构状态" 区域。
3. 正常情况下显示：
   - LangGraph 已启用
   - SQLite 已连接
   - 调度器已运行
   - 反思 Worker 已运行
   - 当前角色
   - 已注册技能
4. 如果新架构降级，会显示红色警告和错误摘要。

### State 面板新增区域

V1 新架构在 State 面板中新增以下区域：

- **提醒与日程**：查看当前提醒、触发时间、启用状态，支持删除。可验证通过对话创建的提醒是否进入 SQLite。
- **Agent 架构状态**：显示运行时、初始化状态、数据库连接、调度器、反思 Worker、角色和技能等信息。
- 记忆区域标注 **SQLite** 标签，明确数据来源为新架构数据库。
- 新增 **"生成今日摘要"** 和 **"检查到期提醒"** 测试按钮，调用真实 `GraphDispatcher` 链路，用于验证新架构端到端可用性。

### 数据架构

- SQLite 数据库（`pet-data.sqlite`）是 V1 新架构的主数据源，存储记忆、提醒、会话、消息等。
- `pet-data.json` 仅用于旧数据迁移，首次启动时幂等迁移到 SQLite，不会覆盖旧文件。
- 迁移完成后，所有新增数据写入 SQLite，`pet-data.json` 不再更新。

### 打包版新架构验证

如果需要确认打包后的 EXE 实际运行了新架构，运行：

```powershell
npm.cmd run test:packaged-new-arch
```

该测试会启动真实的 `PetFramework.exe`，使用隔离的 `--user-data-dir`，验证 LangGraph 已实际运行。架构状态保存在 `userData/architecture-status.json`，正常应为 `langgraph_ready`。

## PlanningGraph 计划模式

V1 之后桌宠的"计划模式"由独立的 `PlanningGraph` LangGraph Agent 驱动。这是一个真正的 Agent，可以询问澄清、生成草案、局部修改任务、请求确认并在明确确认后发布计划。

### planningModel 别名配置

PlanningGraph 使用的模型通过 `planningModel` 别名配置，映射到服务商真实 API model ID。配置位置：

```text
src/shared/constants/index.ts → MODEL_ALIAS.PLANNING = 'planningModel'
```

实际解析值从 `app_settings` 表读取（键名 `planningModel`），不再硬编码。如果未配置，则回退到 `balancedModel`。

配置方法：在 State 面板或 `app_settings` 表中设置：

```text
planningModel = deepseek-chat   # 或其他服务商真实模型 ID
```

### 状态面板模型信息

State 面板新增 `#planningModelView` 区域，显示：

- `planningModel` 别名解析到的实际模型 ID（`resolvedModel`）。
- 模型 API 返回的 `response.model`（`responseModel`，真实调用模型）。

不允许显示别名冒充实际模型。如果两者不一致，以 `responseModel` 为准。

### 计划模式使用流程

1. 用户在输入框中描述目标（例如"帮我安排明天的学习计划"）。
2. PlanningGraph 首先判断信息是否充分：
   - 如果目标模糊（如"安排点事情"），Agent 会先询问关键问题，不直接编造时间表。
   - 如果信息充分（包含时间范围、主题、约束），Agent 直接生成草案。
3. 草案以卡片形式显示在 `#planningConversation` 区域，与对话消息同时显示。
4. 用户可以反馈：
   - "下午不要太满" → 按约束修改草案。
   - "把第二项推迟半小时" → 只修改目标任务。
   - "删除代码审查" → 只删除指定任务，不改变其他任务。
5. 确认发布：
   - 在对话中说"就这样"、"可以了"、"确认"等关键词。
   - 或点击确认按钮。
   - 两种方式产生相同发布结果。
6. 未明确确认时，模型不能发布计划。

### 计划模式独立消息历史

计划模式拥有独立的消息历史（`#planningConversation`），与普通聊天历史分离。重启后可恢复规划对话、草案版本和 active 气泡。

### 数据库约束

- 同一时间只允许一个 active 计划（部分唯一索引 `idx_plans_active_unique_per_date`）。
- plan status 只允许 `draft` / `active` / `completed`（CHECK 触发器）。
- 草案版本 `draft_version` 每次 patch 递增。
- 并发保护通过 `lock_version` 乐观锁实现。
- 模型输出非法参数时不写入数据库（Zod 校验）。

### PlanningGraph 测试

运行 PlanningGraph 相关测试：

```powershell
npx tsx tests/unit/planning-graph.test.ts
```

测试覆盖 13 个场景：模糊目标询问、信息充分直接生成、约束修改、局部修改、删除任务、对话确认与按钮确认一致、未确认不能发布、未来时间校验、重启恢复、非法参数拒绝、并发唯一 active、模型显示真实值、打包版验证。
