# 桌宠框架自定义指南

这个目录是从当前 Roxy 桌宠复制出来的可复用 Electron 桌宠框架。  
其中 Roxy 的图片和角色设定只是示例资产，创建新桌宠时应替换。

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
release/win-unpacked/PetFramework.exe
```

框架默认使用 placeholder pet，可以在没有真实动画资产时测试 API 设置、聊天、状态面板、记忆、好感度、语言切换和提醒词设置。

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

1. 复制 `roxy-electron-pet-framework` 为新目录。
2. 修改 `package.json` 的 `name`、`build.appId`、`build.productName`。
3. 替换 `app/assets` 中的动画资源。
4. 修改 `app/config/pet-profile.js` 的角色名称、资源路径和默认提醒词。
5. 修改 `app/services/prompt-builder.js` 中的角色 Prompt 或 `pet-profile.js` 的 `corePrompt`。
6. 执行 `npm.cmd install`。
7. 执行 `npm.cmd start` 测试。
8. 执行 `npm.cmd run pack` 构建。
9. 打开 `release/win-unpacked/*.exe` 做 smoke test。

不要复制 API Key、`pet-data.json`、`api-config.json`、用户记忆、用户聊天数据、`node_modules` 或旧 `release`。

## 1. 更换桌宠动画资产

默认动画文件：

```text
app/assets/roxy-spritesheet.webp
```

替换方式：

1. 准备新的透明背景 spritesheet。
2. 放入 `app/assets/`。
3. 在 `app/styles.css` 的 `.pet` 中修改 `background-image`。
4. 在 `app/renderer.js` 中修改：
   - `cell.width`
   - `cell.height`
   - `rows` 每行动画的帧数和 fps

当前 `rows` 约定：

- `idle`
- `running-right`
- `running-left`
- `waving`
- `jumping`
- `failed`
- `waiting`
- `running`
- `review`

如果新 spritesheet 的行顺序不同，要同步修改 `rows`。

## 2. 修改角色名称

常见位置：

- `app/index.html`：界面标题、aria-label。
- `app/renderer.js`：i18n 文案、输入框 placeholder、启动气泡。
- `app/services/prompt-builder.js`：角色核心设定。
- `package.json`：`name`、`description`、`build.productName`、`build.appId`。

## 3. 修改角色 Prompt

文件：

```text
app/services/prompt-builder.js
```

建议只改角色核心设定和回复风格，不要删除：

- 安全边界
- 记忆注入限制
- 好感度关系提示
- 输出限制

Prompt 体积控制在：

```text
app/services/token-budget.js
```

不要随意扩大 `historyMaxMessages` 或记忆注入数量。

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

文件：

```text
app/renderer.js
```

在 `i18n.zh` 和 `i18n.en` 中修改：

- `drinkReminderDefault`
- `nightReminderDefault`

用户在设置面板中自定义的提醒词会存入：

- `localStorage.roxyDrinkReminderText`
- `localStorage.roxyNightReminderText`

自定义提醒词不会自动翻译。

## 6. 修改语言文案

文件：

```text
app/renderer.js
```

修改 `i18n` 字典即可。  
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
release/win-unpacked/
```

不要在未确认前生成 zip / rar / 7z。

## 9. 新桌宠检查清单

- 已替换 spritesheet。
- 已检查 `cell` 尺寸和 `rows` 帧数。
- 已修改角色名称。
- 已修改角色 Prompt。
- 已修改 `package.json` 产品名和 appId。
- 已确认 API Key 不在源码里。
- 已确认 `pet-data.json` 没有复制进模板。
- 已运行 `node --check`。
- 已运行 `npm.cmd run pack`。
- 已打开 `release/win-unpacked/*.exe` 做 smoke test。
