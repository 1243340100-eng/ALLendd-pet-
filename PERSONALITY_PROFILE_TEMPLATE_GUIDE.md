# Personality Profile Template Guide

这份文档用于新开窗口或交接给别人时，生成一个可接入本项目 conversation harness 的人格 profile。

v1.6.0 之后请注意：**人格 profile 不是运行时人格切换功能**。它是打包前角色配置的一部分，用来辅助固定角色的对话节奏、回复深度、边界表达和玩笑频率。真正决定“这个桌宠是谁”的，是 `app/config/pet-profile.js` 里的 `corePrompt` 和 `roleFidelity`。

## 在项目里的作用

本项目里有三层和角色相关的配置：

1. `app/config/pet-profile.js`
   这是角色源头。它决定桌宠名字、核心身份、角色还原约束、固定 `conversationPersonalityId`。

2. `app/services/conversation-harness/personalities/*.js`
   这是人格 profile。它不写角色身份，不写世界观，不写完整人设；它只控制对话行为，例如温柔还是直接、是否爱追问、是否允许轻微玩笑、拒绝时是柔和还是坚定。

3. `app/services/prompt-builder.js`
   它把角色核心设定、角色还原约束、记忆、好感度和 harness 策略组合成最终 Prompt。优先级上，角色核心设定高于人格 profile。

简单理解：

```text
pet-profile.js = 这个桌宠是谁
personality profile = 这个桌宠通常怎么组织回复
conversation harness = 这一轮应该怎么答
```

所以，如果用户要“还原某个角色”，不要只写 personality profile。你必须同时更新 `pet-profile.js`，然后把 `conversationPersonalityId` 指向合适的 profile。

## 文件放置位置

新 profile 放在：

```text
app/services/conversation-harness/personalities/
```

文件名建议使用小写短横线：

```text
gentle-teacher.js
cool-professional.js
playful-companion-soft.js
```

## 注册方式

新建 profile 后，需要在：

```text
app/services/conversation-harness/personalities/index.js
```

中注册：

```js
const warmFriend = require('./warm-friend');
const calmExpert = require('./calm-expert');
const playfulCompanion = require('./playful-companion');
const yourProfile = require('./your-profile-id');

const profiles = {
  [warmFriend.id]: warmFriend,
  [calmExpert.id]: calmExpert,
  [playfulCompanion.id]: playfulCompanion,
  [yourProfile.id]: yourProfile
};
```

然后在：

```text
app/config/pet-profile.js
```

里固定使用它：

```js
conversationPersonalityId: 'your_profile_id',
```

打包后不应该给最终用户暴露 profile 切换入口。

## 基础模板

复制下面模板，新建为：

```text
app/services/conversation-harness/personalities/your-profile-id.js
```

```js
module.exports = {
  id: 'your_profile_id',
  name: 'Your Profile Name',
  description: 'Describe the dialogue behavior in one sentence.',

  baseTone: {
    warmth: 0.7,
    humor: 0.3,
    directness: 0.6,
    formality: 0.3,
    empathy: 0.7,
    assertiveness: 0.5,
    playfulness: 0.3
  },

  dialogueBehavior: {
    prefersShortReplies: false,
    maxMainPointsDefault: 3,
    likesToAskQuestions: true,
    avoidsOverExplaining: true,
    canTakeLead: true,
    leadStyle: 'gentle'
  },

  boundaryStyle: {
    canPushBack: true,
    refusalTone: 'soft',
    maxToleranceForExcessiveRequests: 2,
    allowLightComplaint: true
  },

  playfulnessPolicy: {
    enabled: true,
    minTurnsBetweenPlayfulMoves: 4,
    maxPlayfulnessPerConversation: 2,
    allowedModes: ['warm', 'light_tease'],
    forbiddenModes: [
      'emotional_blackmail',
      'forced_comfort',
      'servile_roleplay'
    ]
  },

  languageStyle: {
    avoidTemplatePhrases: true,
    allowFirstPersonJudgment: true,
    allowMildHesitation: true,
    allowColloquialTransitions: true,
    bannedPhrases: [
      '希望这对你有帮助',
      '这是一个好问题',
      '当然可以'
    ],
    preferredPhrases: [
      '我倾向于',
      '这里真正要抓住的是',
      '我先接住这一点'
    ]
  }
};
```

## 字段要求

`id`

- 唯一且稳定。
- 使用小写英文、数字、下划线。
- 不要使用中文、空格或短横线。

`baseTone`

- 所有数值必须在 `0` 到 `1` 之间。
- `warmth` 控制温暖程度。
- `humor` 控制幽默程度。
- `directness` 控制直接程度。
- `formality` 控制正式程度。
- `empathy` 控制共情程度。
- `assertiveness` 控制坚定程度。
- `playfulness` 控制轻松玩笑倾向。

`dialogueBehavior`

- `prefersShortReplies`: 是否偏短回复。
- `maxMainPointsDefault`: 默认最多几个主要点。
- `likesToAskQuestions`: 是否喜欢适度追问。
- `avoidsOverExplaining`: 是否避免解释过长。
- `canTakeLead`: 用户意图弱时是否能轻轻接管话题。
- `leadStyle`: 可用 `gentle`、`confident`、`teasing`、`teacherly`、`minimal`。

`boundaryStyle`

- `canPushBack`: 是否允许设边界。
- `refusalTone`: 可用 `soft`、`firm`、`playful`、`serious`。
- `maxToleranceForExcessiveRequests`: 对过量请求的容忍度。
- `allowLightComplaint`: 是否允许轻微抱怨式表达。

`playfulnessPolicy`

- 专业、冷静、严肃型角色建议 `enabled: false`。
- 陪伴型角色可以开启，但要限制频率。
- 高压任务、痛苦情绪、安全风险场景中必须禁止 playful。
- 不允许情绪勒索，不允许把撒娇当完成任务的条件。

`languageStyle`

- 只放表达偏好和禁用话术。
- 不要在这里写角色身份、背景故事或世界观。
- 角色身份必须写入 `pet-profile.js` 的 `corePrompt` 和 `roleFidelity`。

## v1.5.0 能力边界

- 人格 profile 不能决定是否写入或召回记忆，只能影响最终回复风格。
- “还记得 / 继续刚才”等召回逻辑位于通用 Prompt/记忆服务，不写进 personality profile。
- personality profile 不能增加 Safe Shell 命令、扩大工作目录、关闭确认或启用写入/提权能力。
- 角色如果表现出“会操作电脑”的设定，也只能描述框架真实提供的固定只读能力。

## 生成新 profile 的推荐流程

当用户描述想要的角色时，先拆成两部分：

1. 角色身份和还原要求
   写入 `app/config/pet-profile.js`：
   - `characterName`
   - `corePrompt`
   - `roleFidelity`
   - `conversationPersonalityId`

2. 对话行为偏好
   写入 personality profile：
   - 温柔还是直接
   - 是否正式
   - 是否喜欢追问
   - 是否允许玩笑
   - 边界表达方式
   - 模板化话术禁用列表

## 给新窗口的生成提示词

可以把下面这段发给新窗口：

```text
请根据以下用户需求，生成一个适用于 roxy-electron-pet-framework v1.6.0 的 conversation harness personality profile。

注意：
1. 这个 profile 不是完整角色人设，也不是运行时人格切换功能。
2. profile 只控制对话行为：语气强弱、回复长短、是否追问、边界方式、playful 频率。
3. 角色身份、世界观、称呼、还原约束必须写入 app/config/pet-profile.js 的 corePrompt 和 roleFidelity。
4. 输出 CommonJS module.exports 对象。
5. 必须包含 id/name/description/baseTone/dialogueBehavior/boundaryStyle/playfulnessPolicy/languageStyle。
6. id 使用小写英文、数字、下划线。
7. baseTone 所有数值必须在 0 到 1。
8. 不允许关闭安全边界。
9. 不允许情绪勒索式 playful。
10. 最后说明文件应放到哪里、如何注册到 personalities/index.js、如何在 pet-profile.js 中固定 conversationPersonalityId。

用户需求：
<在这里粘贴用户想要的角色和对话风格>
```

## 检查命令

注册并绑定到 `pet-profile.js` 后运行：

```powershell
cd "D:\Documents\展示项目内容\roxy-electron-pet-framework"
npm.cmd run test:character
npm.cmd run test:harness
node --check .\app\config\pet-profile.js
```

框架测试入口：

```text
D:\Documents\展示项目内容\roxy-electron-pet-framework\release\win-unpacked\PetFramework.exe
```

## v1.6.0 表情能力边界

- personality profile 只能影响回复风格，不能选择 spritesheet 行号、开启 `responseEmotion` 或修改表情分类标签。
- 表情资产和动画行必须在 `app/config/pet-profile.js` 中于打包前固定。
- 表情分类发生在角色回复生成之后，不会改写回复、写入记忆或改变 conversation harness 策略。
