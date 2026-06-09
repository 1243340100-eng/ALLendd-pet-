# Roxy 桌宠

这是一个可以脱离 Codex 运行的 Electron 桌宠。素材来自本项目内的 `app/assets/roxy-spritesheet.webp`，不依赖 `C:\Users\Administrator\.codex`。

## 开发运行

```powershell
npm install
npm start
```

## 打包给另一台电脑

```powershell
npm run dist
```

本机已经生成可发送压缩包：

```text
release/Roxy桌宠-可发送版.zip
```

把这个 zip 发给另一台 Windows 电脑，对方解压后双击 `Roxy桌宠.exe` 即可，不需要安装 Codex、Node.js 或 Electron。

## 功能

- 透明无边框桌宠窗口
- 鼠标拖拽移动
- 右键菜单切换动作
- 右键菜单立即提醒：`昌昌，喝水啦`
- 默认每 45 分钟提醒一次，可在右键菜单改成 30/45/60/90 分钟
- 悬停右下角显示缩放和立即喝水按钮
- 可以缩到迷你尺寸，右键菜单也可直接选择迷你/小/默认/大
- 拖动桌宠时会按移动方向播放向左或向右跑动动画，松手后回到休息
