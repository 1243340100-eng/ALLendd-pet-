# Electron 桌宠框架 (Pet Framework)

一个基于 Electron + LangGraph 的可复用 AI 桌宠框架，支持角色初始化、智能对话、记忆系统、主动消息、日程计划、反思学习等能力。默认搭载 Blue 桌宠角色包。

## 核心功能

### 五大 LangGraph Agent

| Agent | 功能 |
|-------|------|
| **ConversationGraph** | 智能对话：意图识别、提醒创建、日程查询、表情动画、记忆召回 |
| **OnboardingGraph** | 角色初始化：问题卡片采集（V9）、草稿合并、覆盖率校验、角色锁定 |
| **PlanningGraph** | 日程计划：自然语言建计划、跨日期日历、每日自动激活、任务管理 |
| **ProactiveGraph** | 主动消息：每日问候、定时提醒、计划到期、DND 时段、多通道投递 |
| **ReflectionGraph** | 反思学习：对话后记忆抽取、敏感信息过滤、用户画像更新、去重 |

### 桌宠交互

- 透明无边框窗口，鼠标拖拽移动（拖动时按方向播放跑动动画）
- 右键菜单切换动作、立即提醒、调整提醒间隔、缩放尺寸
- 悬停显示缩放和快捷按钮，支持迷你/小/默认/大四档
- AI 回复后可选触发表情动画（happy/disgusted/tsundere/shocked/angry/blushing/helpless）

### 角色初始化（OnboardingGraph V9）

- 问题卡片模式：结构化选项 + 自由文本混合采集
- 四阶段采集：基础信息 → 说话风格 → 关系边界 → 角色禁区
- 局部修改：review 阶段可定向返回某个阶段修改，不影响其他阶段数据
- 临时保存：未提交的卡片选择自动保存（600ms debounce），重启后恢复
- 安全约束：不信任前端选项值，后端从可信 question.options 重新映射
- 角色锁定后生成 CompiledCharacterProfile，持久化到 SQLite

### 日程计划（PlanningGraph V7）

- 自然语言建计划："明天下午 3 点开会"、"每周一 9 点周会"
- 跨日期日历：月视图、日期详情、未来日期计划、过去日期拒绝
- 每日自动激活：scheduled → active，原子 SQL + 事件去重保证幂等
- 计划状态机：draft → scheduled → active → completed/cancelled/expired
- scope 隔离：按 userId + characterId 隔离，不互相干扰

### 记忆系统

- SQLite MemoryStore：长期记忆、短期记忆、用户画像
- 反思任务持久化到 reflection_jobs 表，崩溃可恢复
- 记忆条目包含 source_occurred_at、write_timezone、source_role
- 记忆导出使用 memory:export IPC，用户选择保存路径，排除 API keys
- evidenceQuote 程序化校验：反思记忆候选必须是用户消息的非空子串

### 主动消息

- 每日问候（09:00）、定时提醒、计划到期提醒
- DND 时段免打扰、每日配额限制、忽略阈值
- 多通道投递：系统通知（返回 Promise<boolean>）→ 桌宠气泡 → Renderer ACK
- 通知/声音/天气适配器只在 settings 显式等于 'true' 时启用（默认禁用）

## 技术栈

- **前端**：Electron 31 + 原生 HTML/CSS/JS（无框架）
- **后端**：Node.js + TypeScript 7 + LangGraph.js
- **数据库**：SQLite (better-sqlite3) — V1 新架构主数据源
- **AI**：ModelGateway 统一网关，支持 fastModel / balancedModel / reasoningModel / planningModel 多模型切换
- **校验**：Zod schema 严格校验所有 IPC 和模型输入
- **打包**：electron-builder (Windows)

## 快速开始

### 环境要求

- Node.js 18+
- Windows 10+（当前仅支持 Windows）
- npm

### 安装与运行

```powershell
# 安装依赖（会自动 rebuild better-sqlite3）
npm install

# 启动开发版
npm start

# 编译 TypeScript（修改 src/ 后必须运行）
npm run build:ts
```

启动后：
1. 在设置面板填入 AI 服务商 API Key
2. 选择模型别名（fastModel/balancedModel/reasoningModel/planningModel）
3. 完成角色初始化向导（问题卡片采集）
4. 开始对话

### 打包

```powershell
# 打包测试版（生成 release-ui-fix/win-unpacked/PetFramework.exe）
npm run pack

# 打包便携版（生成 release/PetFramework 1.6.0.exe）
npm run dist
```

## 项目结构

```
.
├── app/                          # Electron 应用源码（旧轨，JS）
│   ├── main.js                   # 主进程：窗口、IPC、API Key
│   ├── preload.js                # preload 安全桥
│   ├── renderer.js               # 渲染进程：UI、动画、聊天
│   ├── index.html                # 主界面结构
│   ├── styles.css                # 界面样式
│   ├── config/pet-profile.js     # 角色配置单一来源（换皮只改此文件）
│   ├── services/                 # 旧轨服务（记忆、Prompt、Token、好感度等）
│   └── assets/                   # 桌宠动画资源
├── src/                          # TypeScript 源码（新轨，LangGraph）
│   ├── agent/graphs/             # 五大 LangGraph
│   │   ├── conversation/         # 对话 Graph
│   │   ├── onboarding/           # 角色初始化 Graph
│   │   ├── planning/             # 日程计划 Graph
│   │   ├── proactive/            # 主动消息 Graph
│   │   └── reflection/           # 反思学习 Graph
│   ├── services/                 # 新架构服务
│   │   ├── ModelGateway.ts       # 模型统一网关
│   │   ├── MemoryStore.ts        # SQLite 记忆存储
│   │   ├── SchedulerService.ts   # 调度器
│   │   ├── TimeService.ts        # 时区感知时间服务
│   │   └── character-onboarding/ # 角色初始化服务集群
│   ├── main/                     # 新架构入口与 IPC 集成
│   ├── infrastructure/database/  # SQLite 连接、migration、repositories
│   └── shared/                   # 共享契约、schema、常量
├── dist/                         # TypeScript 编译产物（打包实际运行）
├── character-packs/default/      # 默认角色包（manifest + persona + spritesheet）
├── tests/                        # 测试套件
│   ├── unit/                     # 单元测试（tsx）
│   ├── packaged/                 # 打包版验证
│   └── ui/                       # UI 冒烟测试
└── package.json
```

## 测试

### 核心测试套件

```powershell
# TypeScript 类型检查
npm run typecheck

# OnboardingGraph 测试（V8 角色初始化）
npm run test:onboarding

# Onboarding E2E（初始化到启动）
npm run test:onboarding-e2e

# 数据库 + migration 测试
npm run test:database

# 契约测试
npm run test:contracts

# 打包版新架构验证（需先 npm run pack）
npm run test:packaged-new-arch
```

### 新增测试（V9 问题卡片 + P2 pendingAnswers）

```powershell
# AnswerProcessor：选项值篡改、数量限制、题型不匹配、混合回答合并
npx tsx tests/unit/answer-processor.test.ts

# SuggestionGenerator：80 字截断、模型失败回退
npx tsx tests/unit/suggestion-generator.test.ts

# pendingAnswers：重启恢复、过期拒绝、指纹校验、清除时机
npx tsx tests/unit/pending-answers.test.ts

# targetStage：局部修改路由、全字段卡片、隔离性
npx tsx tests/unit/target-stage.test.ts

# Onboarding 关键路径
npx tsx tests/unit/onboarding-critical-paths.test.ts
```

## 自定义

### 换皮（角色配置）

角色配置的单一来源是 `app/config/pet-profile.js`，修改此文件即可换皮：

- `spriteSheet`：spritesheet 图片路径
- `spriteCell`：单格尺寸（默认 192×208）
- `animationRows`：各动作的行号、帧数、fps
- `responseEmotion`：回复表情动画配置（默认关闭）

### 角色包

角色包位于 `character-packs/`，包含：
- `manifest.json`：角色元数据
- `persona.json`：角色人设
- `prompt.md`：角色 Prompt
- `spritesheet/atlas.webp`：动画图集

### 模型配置

在设置面板配置四个模型别名，映射到服务商真实 model ID：
- `fastModel`：快速模型（意图识别、表情分类）
- `balancedModel`：均衡模型（对话、角色初始化）
- `reasoningModel`：推理模型（复杂任务）
- `planningModel`：计划模型（日程规划）

## 数据与隐私

- **API Key**：存储在 Electron `userData/api-config.json`
- **用户数据**：V1 新架构主数据源为 SQLite `pet-data.sqlite`
- **旧数据迁移**：`pet-data.json` 仅用于首次启动时幂等迁移到 SQLite
- 运行时文件不在源码目录中，不会提交到仓库
- 不要把 API Key、用户记忆、聊天数据打包或分享给他人

## 运行时状态

```text
loading → langgraph_ready | initialization_failed
```

新架构采用 no-silent-fallback 策略：加载失败时进入 `initialization_failed` 状态并在 UI 显示红色警告，不会静默回退到旧链路。状态可通过 State 面板的"Agent 架构状态"区域查看。

## 版本

当前版本：**1.6.0**

- V1：LangGraph 新架构（SQLite + 五大 Graph）
- V5：PlanningGraph 计划模式
- V7：跨日期日历计划
- V8：OnboardingGraph 角色初始化（多轮交互 + 角色锁定）
- V9：问题卡片模式 + pendingAnswers 临时保存 + targetStage 局部修改

## License

UNLICENSED (Private)
