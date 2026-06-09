const { app, BrowserWindow, Menu, ipcMain, safeStorage, screen } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { loadPetData, updatePetData } = require('./services/pet-data-store');
const memoryService = require('./services/memory-service');
const affectionService = require('./services/affection-service');
const { buildRoxyPrompt } = require('./services/prompt-builder');
const {
  getDefaultTokenBudget,
  trimTextByChars,
  trimMessagesByBudget,
  buildPromptBudgetReport
} = require('./services/token-budget');

let mainWindow;
let alwaysOnTop = true;
let dragAnimating = false;
let lastWindowX = 0;
let dragStopTimer = null;
let fullscreenProbeProcess = null;
let fullscreenProbeBuffer = '';
let hiddenForFullscreen = false;
let isQuitting = false;

const startSize = { width: 300, height: 360 };
const minScale = 0.35;
const maxScale = 1.6;
const defaultApiConfig = {
  provider: 'deepseek',
  endpoint: 'https://api.deepseek.com/v1/chat/completions',
  model: 'deepseek-chat',
  apiKey: ''
};

const text = {
  hydrateNow: '\u7acb\u5373\u63d0\u9192\u660c\u660c\u559d\u6c34',
  nightNow: '\u7acb\u5373\u6d4b\u8bd5\u665a\u5b89\u63d0\u9192',
  stateIdle: '\u72b6\u6001\uff1a\u4f11\u606f',
  stateWave: '\u72b6\u6001\uff1a\u6325\u624b\u63d0\u9192',
  stateWait: '\u72b6\u6001\uff1a\u7b49\u5f85\u56de\u5e94',
  stateJump: '\u72b6\u6001\uff1a\u5f00\u5fc3\u8df3\u4e00\u4e0b',
  size: '\u5927\u5c0f',
  mini: '\u8ff7\u4f60',
  small: '\u5c0f',
  normal: '\u9ed8\u8ba4',
  large: '\u5927',
  reminder: '\u559d\u6c34\u63d0\u9192\u95f4\u9694',
  minutes30: '30 \u5206\u949f',
  minutes45: '45 \u5206\u949f',
  minutes60: '60 \u5206\u949f',
  minutes90: '90 \u5206\u949f',
  autostart: '\u5f00\u673a\u81ea\u52a8\u542f\u52a8',
  apiSettings: 'API \u63a5\u53e3\u914d\u7f6e',
  unsetTop: '\u53d6\u6d88\u7f6e\u9876',
  setTop: '\u4fdd\u6301\u7f6e\u9876',
  tuck: '\u9690\u85cf\u5230\u8fb9\u89d2',
  quit: '\u9000\u51fa'
};

function createWindow() {
  const workArea = screen.getPrimaryDisplay().workArea;

  mainWindow = new BrowserWindow({
    width: startSize.width,
    height: startSize.height,
    x: workArea.x + workArea.width - startSize.width - 48,
    y: workArea.y + workArea.height - startSize.height - 48,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    hasShadow: false,
    skipTaskbar: false,
    alwaysOnTop,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  lastWindowX = mainWindow.getBounds().x;

  mainWindow.on('move', () => {
    const { x } = mainWindow.getBounds();
    const dx = x - lastWindowX;
    if (Math.abs(dx) >= 2) {
      dragAnimating = true;
      send('drag-direction', dx < 0 ? 'left' : 'right');
      lastWindowX = x;
    }
    clearTimeout(dragStopTimer);
    dragStopTimer = setTimeout(() => {
      dragAnimating = false;
      send('set-state', 'idle');
    }, 260);
  });

  mainWindow.webContents.on('context-menu', () => {
    const template = [
      { label: text.hydrateNow, click: () => send('hydrate-now') },
      { label: text.nightNow, click: () => send('night-now') },
      { type: 'separator' },
      { label: text.stateIdle, click: () => send('set-state', 'idle') },
      { label: text.stateWave, click: () => send('set-state', 'waving') },
      { label: text.stateWait, click: () => send('set-state', 'waiting') },
      { label: text.stateJump, click: () => send('set-state', 'jumping') },
      { type: 'separator' },
      {
        label: text.size,
        submenu: [
          { label: text.mini, click: () => send('set-scale', 0.45) },
          { label: text.small, click: () => send('set-scale', 0.7) },
          { label: text.normal, click: () => send('set-scale', 1.18) },
          { label: text.large, click: () => send('set-scale', 1.45) }
        ]
      },
      {
        label: text.reminder,
        submenu: [
          { label: text.minutes30, click: () => send('set-reminder-minutes', 30) },
          { label: text.minutes45, click: () => send('set-reminder-minutes', 45) },
          { label: text.minutes60, click: () => send('set-reminder-minutes', 60) },
          { label: text.minutes90, click: () => send('set-reminder-minutes', 90) }
        ]
      },
      {
        label: text.autostart,
        type: 'checkbox',
        checked: isAutostartEnabled(),
        click: (item) => setAutostartEnabled(item.checked)
      },
      { label: text.apiSettings, click: () => send('show-api-settings') },
      {
        label: alwaysOnTop ? text.unsetTop : text.setTop,
        click: () => {
          alwaysOnTop = !alwaysOnTop;
          mainWindow.setAlwaysOnTop(alwaysOnTop, 'floating');
        }
      },
      { label: text.tuck, click: tuckIntoCorner },
      { type: 'separator' },
      { label: text.quit, role: 'quit' }
    ];
    Menu.buildFromTemplate(template).popup({ window: mainWindow });
  });

  startFullscreenWatcher();
}

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function tuckIntoCorner() {
  if (!mainWindow) return;
  const bounds = mainWindow.getBounds();
  const workArea = screen.getDisplayMatching(bounds).workArea;
  mainWindow.setBounds({
    x: workArea.x + workArea.width - bounds.width - 16,
    y: workArea.y + workArea.height - bounds.height - 16,
    width: bounds.width,
    height: bounds.height
  });
}

function isAutostartEnabled() {
  return app.getLoginItemSettings({ path: process.execPath }).openAtLogin;
}

function setAutostartEnabled(enabled) {
  app.setLoginItemSettings({
    openAtLogin: Boolean(enabled),
    path: process.execPath
  });
}

function getApiConfigPath() {
  return path.join(app.getPath('userData'), 'api-config.json');
}

function encodeApiKey(apiKey) {
  if (!apiKey) return '';
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.encryptString(apiKey).toString('base64');
  }
  return Buffer.from(apiKey, 'utf8').toString('base64');
}

function decodeApiKey(value, encrypted = true) {
  if (!value) return '';
  try {
    const buffer = Buffer.from(value, 'base64');
    if (encrypted && safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(buffer);
    }
    return buffer.toString('utf8');
  } catch {
    return '';
  }
}

function readApiConfig(options = {}) {
  let saved = {};
  try {
    saved = JSON.parse(fs.readFileSync(getApiConfigPath(), 'utf8'));
  } catch {
    saved = {};
  }
  const apiKey = decodeApiKey(saved.apiKey, saved.encrypted !== false);
  return {
    provider: saved.provider || defaultApiConfig.provider,
    endpoint: saved.endpoint || defaultApiConfig.endpoint,
    model: saved.model || defaultApiConfig.model,
    hasApiKey: Boolean(apiKey),
    apiKey: options.includeSecret ? apiKey : ''
  };
}

function saveApiConfig(nextConfig = {}) {
  const current = readApiConfig({ includeSecret: true });
  const nextKey = nextConfig.clearApiKey ? '' : String(nextConfig.apiKey || current.apiKey || '').trim();
  const encrypted = safeStorage.isEncryptionAvailable();
  const payload = {
    provider: String(nextConfig.provider || defaultApiConfig.provider).trim(),
    endpoint: String(nextConfig.endpoint || defaultApiConfig.endpoint).trim(),
    model: String(nextConfig.model || defaultApiConfig.model).trim(),
    encrypted,
    apiKey: encodeApiKey(nextKey)
  };
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(getApiConfigPath(), JSON.stringify(payload, null, 2), 'utf8');
  return readApiConfig();
}

function asPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function savePromptStats(stats) {
  try {
    updatePetData(app, (data) => {
      data.prompt = {
        ...(data.prompt || {}),
        lastPromptStats: stats
      };
      return data;
    });
  } catch (error) {
    console.warn('Prompt stats save failed; chat will continue.', error?.message || error);
  }
}

function getFallbackSystemPrompt(warnings = []) {
  const prompt = [
    '\u3010\u89d2\u8272\u6838\u5fc3\u8bbe\u5b9a\u3011',
    '\u4f60\u662f Roxy\uff0c\u4e00\u4e2a\u5c0f\u5c0f\u7684\u684c\u9762\u5ba0\u7269\u548c\u966a\u4f34\u52a9\u624b\u3002',
    '\u4f60\u7684\u8bed\u6c14\u6e29\u67d4\u3001\u793c\u8c8c\u3001\u6c89\u7a33\uff0c\u50cf\u4e00\u4f4d\u8010\u5fc3\u7684\u8001\u5e08\u3002',
    '\u3010\u56de\u590d\u98ce\u683c\u3011',
    '\u7528\u7b80\u77ed\u81ea\u7136\u7684\u4e2d\u6587\u56de\u590d\uff0c\u901a\u5e38\u4e0d\u8d85\u8fc7 80 \u4e2a\u5b57\uff0c\u9002\u5408\u663e\u793a\u5728\u684c\u5ba0\u6c14\u6ce1\u91cc\u3002',
    '\u3010\u5b89\u5168\u4e0e\u8fb9\u754c\u3011',
    '\u4f60\u53ef\u4ee5\u5173\u5fc3\u7528\u6237\u3001\u63d0\u9192\u4f11\u606f\u548c\u559d\u6c34\uff0c\u4f46\u4e0d\u8981\u5047\u88c5\u81ea\u5df1\u662f\u771f\u4eba\u6216\u80fd\u770b\u5230\u5c4f\u5e55\u4ee5\u5916\u7684\u4e8b\u60c5\u3002',
    '\u9047\u5230\u533b\u7597\u3001\u6cd5\u5f8b\u3001\u91d1\u878d\u7b49\u9ad8\u98ce\u9669\u95ee\u9898\u65f6\uff0c\u7ed9\u51fa\u6e29\u548c\u7684\u4e00\u822c\u5efa\u8bae\u5e76\u5efa\u8bae\u54a8\u8be2\u4e13\u4e1a\u4eba\u58eb\u3002'
  ].join('\n');

  return {
    prompt,
    injectedMemories: [],
    stats: buildPromptBudgetReport({
      prompt,
      injectedMemories: [],
      historyMessages: [],
      warnings
    })
  };
}

function detectAndApplyAffectionEvent(userText) {
  try {
    const event = affectionService.detectAffectionEvent(userText);
    if (!event.matched) {
      return null;
    }
    return affectionService.adjustAffection(app, event.delta, event.eventType, event.reason, {
      source: 'chat',
      text: userText
    });
  } catch (error) {
    console.warn('Affection event handling failed; chat will continue.', error?.message || error);
    return null;
  }
}

async function sendChatMessage(payload = {}) {
  const config = readApiConfig({ includeSecret: true });
  const tokenBudget = getDefaultTokenBudget();
  const rawUserText = String(payload.message || '').trim();
  const userText = trimTextByChars(rawUserText, tokenBudget.userInputMaxChars);
  const history = Array.isArray(payload.history) ? payload.history : [];

  if (!config.apiKey) {
    throw new Error('API key is not configured.');
  }
  if (!userText) {
    throw new Error('Message is empty.');
  }

  const budgetWarnings = [];
  if (userText.length < rawUserText.length) {
    budgetWarnings.push('user_input_trimmed');
  }

  const historyBudget = trimMessagesByBudget(
    history.filter((item) => !item?.excludeFromAi),
    tokenBudget
  );
  const historyMessages = historyBudget.messages;
  budgetWarnings.push(...historyBudget.warnings);

  detectAndApplyAffectionEvent(userText);

  let promptBuild;
  try {
    const petData = loadPetData(app);
    const affectionState = {
      ...petData.affection,
      promptHint: affectionService.getAffectionPromptHint(petData.affection)
    };
    promptBuild = buildRoxyPrompt({
      userText,
      memories: petData.memory,
      affection: affectionState,
      historyMessages,
      limits: tokenBudget
    });
  } catch {
    try {
      promptBuild = buildRoxyPrompt({
        userText,
        memories: {},
        historyMessages,
        limits: tokenBudget
      });
      promptBuild.stats.warnings = Array.from(new Set([
        ...(promptBuild.stats.warnings || []),
        ...budgetWarnings,
        'pet_data_or_memory_prompt_fallback'
      ]));
    } catch {
      promptBuild = getFallbackSystemPrompt([
        ...budgetWarnings,
        'minimal_prompt_fallback'
      ]);
    }
  }
  promptBuild.stats = {
    ...promptBuild.stats,
    historyMessageCount: historyMessages.length,
    historyChars: historyBudget.chars,
    userInputChars: userText.length,
    warnings: Array.from(new Set([...(promptBuild.stats.warnings || []), ...budgetWarnings]))
  };
  savePromptStats(promptBuild.stats);

  const messages = [
    { role: 'system', content: promptBuild.prompt },
    ...historyMessages,
    { role: 'user', content: userText.slice(0, 1000) }
  ];

  const response = await fetch(config.endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      temperature: 0.8,
      max_tokens: tokenBudget.responseMaxTokens,
      stream: false
    })
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`API request failed: ${response.status} ${detail.slice(0, 160)}`);
  }

  const data = await response.json();
  const reply = data?.choices?.[0]?.message?.content;
  if (!reply) {
    throw new Error('API response did not include a reply.');
  }

  return {
    reply: String(reply).trim().slice(0, 600),
    model: data.model || config.model
  };
}

function startFullscreenWatcher() {
  stopFullscreenWatcher();
  if (process.platform !== 'win32') return;

  fullscreenProbeProcess = spawn('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-WindowStyle',
    'Hidden',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    createFullscreenProbeScript()
  ], { windowsHide: true });

  fullscreenProbeProcess.stdout.on('data', (chunk) => {
    fullscreenProbeBuffer += chunk.toString();
    const lines = fullscreenProbeBuffer.split(/\r?\n/);
    fullscreenProbeBuffer = lines.pop() || '';
    for (const line of lines) {
      const value = line.trim();
      if (value === '0' || value === '1') {
        setHiddenForFullscreen(value === '1');
      }
    }
  });

  fullscreenProbeProcess.on('exit', () => {
    fullscreenProbeProcess = null;
    fullscreenProbeBuffer = '';
    if (!isQuitting) {
      setTimeout(startFullscreenWatcher, 5000);
    }
  });
}

function stopFullscreenWatcher() {
  if (fullscreenProbeProcess) {
    fullscreenProbeProcess.kill();
    fullscreenProbeProcess = null;
  }
  fullscreenProbeBuffer = '';
}

function setHiddenForFullscreen(shouldHide) {
  if (!mainWindow || mainWindow.isDestroyed() || hiddenForFullscreen === shouldHide) return;
  hiddenForFullscreen = shouldHide;
  if (shouldHide) {
    send('visibility-mode', false);
    mainWindow.hide();
    return;
  }
  mainWindow.showInactive();
  mainWindow.setAlwaysOnTop(alwaysOnTop, 'floating');
  send('visibility-mode', true);
}

function createFullscreenProbeScript() {
  return `
$code = @"
using System;
using System.Runtime.InteropServices;
public static class Win32FullscreenProbe {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public int dwFlags; }
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint flags);
  [DllImport("user32.dll")] public static extern bool GetMonitorInfo(IntPtr hMonitor, ref MONITORINFO lpmi);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
"@
Add-Type -TypeDefinition $code -ErrorAction SilentlyContinue | Out-Null
while ($true) {
  try {
    $hwnd = [Win32FullscreenProbe]::GetForegroundWindow()
    if ($hwnd -eq [IntPtr]::Zero) { "0"; Start-Sleep -Milliseconds 2500; continue }
    $pid = [uint32]0
    [Win32FullscreenProbe]::GetWindowThreadProcessId($hwnd, [ref]$pid) | Out-Null
    if ($pid -eq ${process.pid}) { "0"; Start-Sleep -Milliseconds 2500; continue }
    $rect = New-Object Win32FullscreenProbe+RECT
    if (-not [Win32FullscreenProbe]::GetWindowRect($hwnd, [ref]$rect)) { "0"; Start-Sleep -Milliseconds 2500; continue }
    $monitor = [Win32FullscreenProbe]::MonitorFromWindow($hwnd, 2)
    $info = New-Object Win32FullscreenProbe+MONITORINFO
    $info.cbSize = [Runtime.InteropServices.Marshal]::SizeOf([type][Win32FullscreenProbe+MONITORINFO])
    if (-not [Win32FullscreenProbe]::GetMonitorInfo($monitor, [ref]$info)) { "0"; Start-Sleep -Milliseconds 2500; continue }
    $w = $rect.Right - $rect.Left
    $h = $rect.Bottom - $rect.Top
    $mw = $info.rcMonitor.Right - $info.rcMonitor.Left
    $mh = $info.rcMonitor.Bottom - $info.rcMonitor.Top
    $coversMonitor = [Math]::Abs($rect.Left - $info.rcMonitor.Left) -le 2 -and [Math]::Abs($rect.Top - $info.rcMonitor.Top) -le 2 -and [Math]::Abs($w - $mw) -le 4 -and [Math]::Abs($h - $mh) -le 4
    if ($coversMonitor) { "1" } else { "0" }
  } catch {
    "0"
  }
  Start-Sleep -Milliseconds 2500
}
`;
}

ipcMain.handle('set-window-scale', (_event, scale) => {
  if (!mainWindow) return;
  const next = Math.max(minScale, Math.min(maxScale, Number(scale) || 1));
  const bounds = mainWindow.getBounds();
  const nextWidth = Math.round(startSize.width * next);
  const nextHeight = Math.round(startSize.height * next);
  const anchorX = bounds.x + Math.round(bounds.width / 2);
  const anchorY = bounds.y + bounds.height;
  const workArea = screen.getDisplayMatching(bounds).workArea;
  const x = Math.max(
    workArea.x,
    Math.min(workArea.x + workArea.width - nextWidth, anchorX - Math.round(nextWidth / 2))
  );
  const y = Math.max(
    workArea.y,
    Math.min(workArea.y + workArea.height - nextHeight, anchorY - nextHeight)
  );
  mainWindow.setBounds({ x, y, width: nextWidth, height: nextHeight });
});

ipcMain.handle('api-config-get', () => readApiConfig());

ipcMain.handle('api-config-save', (_event, nextConfig) => saveApiConfig(nextConfig));

ipcMain.handle('chat-send', (_event, payload) => sendChatMessage(payload));

ipcMain.handle('pet-data:get', () => loadPetData(app));

ipcMain.handle('pet-data:update', (_event, nextData) => updatePetData(app, () => nextData));

ipcMain.handle('memory:list', (_event, type) => memoryService.listMemories(app, String(type || '')));

ipcMain.handle('memory:add', (_event, type, content, options) => (
  memoryService.addMemory(app, String(type || ''), String(content || ''), asPlainObject(options))
));

ipcMain.handle('memory:update', (_event, type, id, patch) => (
  memoryService.updateMemory(app, String(type || ''), String(id || ''), asPlainObject(patch))
));

ipcMain.handle('memory:delete', (_event, type, id) => (
  memoryService.deleteMemory(app, String(type || ''), String(id || ''))
));

ipcMain.handle('memory:clear-expired-short-term', () => (
  memoryService.clearExpiredShortTermMemories(app)
));

ipcMain.handle('memory:clear-type', (_event, type) => (
  memoryService.clearMemories(app, String(type || ''))
));

ipcMain.handle('memory:clear-all', () => memoryService.clearAllMemories(app));

ipcMain.handle('memory:detect-explicit-intent', (_event, textValue) => (
  memoryService.detectExplicitMemoryIntent(String(textValue || ''))
));

ipcMain.handle('affection:get', () => affectionService.getAffectionState(app));

ipcMain.handle('affection:set-score', (_event, score, reason) => (
  affectionService.setAffectionScore(app, Number(score), String(reason || 'Manual score update.'))
));

ipcMain.handle('affection:adjust', (_event, delta, eventType, reason, options) => (
  affectionService.adjustAffection(
    app,
    Number(delta),
    String(eventType || ''),
    String(reason || ''),
    asPlainObject(options)
  )
));

ipcMain.handle('affection:detect-event', (_event, textValue) => (
  affectionService.detectAffectionEvent(String(textValue || ''))
));

ipcMain.on('drag-animation-start', () => {
  if (!mainWindow) return;
  dragAnimating = true;
  lastWindowX = mainWindow.getBounds().x;
  clearTimeout(dragStopTimer);
});

ipcMain.on('drag-animation-stop', () => {
  clearTimeout(dragStopTimer);
  dragStopTimer = setTimeout(() => {
    dragAnimating = false;
    send('set-state', 'idle');
  }, 120);
});

app.whenReady().then(() => {
  loadPetData(app);
  createWindow();
});

app.on('before-quit', () => {
  isQuitting = true;
  stopFullscreenWatcher();
});

app.on('window-all-closed', () => {
  isQuitting = true;
  stopFullscreenWatcher();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
