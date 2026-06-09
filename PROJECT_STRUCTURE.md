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

## 数据与隐私

- API Key 存储在 Electron `userData` 下的 `api-config.json`，由 `app/main.js` 管理。
- 用户数据存储在 Electron `userData` 下的 `pet-data.json`，由 `pet-data-store.js` 管理。
- 这些运行时文件不在项目源码目录中，不应复制进框架模板。
- 不要把 API Key、用户记忆、聊天数据或好感度数据提交、打包或复制给别人。

## 不建议随便修改

- `app/main.js` 中的 API Key 加密/读取逻辑。
- `app/preload.js` 中的 IPC 暴露范围。
- `app/services/token-budget.js` 中的预算上限。
- `app/services/prompt-builder.js` 中的核心角色边界。
- `app/services/memory-service.js` 中的受控写入逻辑。

## 适合换皮时修改

- `app/assets/roxy-spritesheet.webp`：替换为新的桌宠 spritesheet。
- `app/renderer.js` 中的 `rows` 和 `cell`：修改动画行、帧数、单帧尺寸。
- `app/services/prompt-builder.js`：修改角色名称、角色核心设定和回复风格。
- `app/index.html`：修改界面标题或少量展示文案。
- `package.json`：修改应用名、产品名、appId。
- `app/styles.css`：微调面板和按钮样式。

## 构建

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

创建新桌宠时可替换：

- `app/assets/` 中的动画资源。
- `app/config/pet-profile.js` 中的角色配置。
- `app/services/prompt-builder.js` 中的角色 Prompt。

## 构建

更新正常构建目录：

```powershell
npm.cmd run pack
```

构建后测试：

```text
release/win-unpacked/Roxy桌宠.exe
```

不要把旧 zip 当作最新版本发送。
