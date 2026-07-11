const { app, BrowserWindow, Menu, ipcMain, safeStorage, screen, protocol, net, dialog } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { loadPetData, updatePetData, atomicWriteJson, readJsonWithFallback } = require('./services/pet-data-store');
const memoryService = require('./services/memory-service');
const affectionService = require('./services/affection-service');
const { SafeShellService } = require('./services/safe-shell-service');
const { buildPetPrompt } = require('./services/prompt-builder');
const petProfile = require('./config/pet-profile');
const {
  handleUserMessage: handleHarnessUserMessage,
  getPersonalityProfile,
  normalizeConversationState,
  runPostCheck,
  rewriteWithPostCheck
} = require('./services/conversation-harness');
const {
  getDefaultTokenBudget,
  trimTextByChars,
  trimMessagesByBudget,
  buildPromptBudgetReport
} = require('./services/token-budget');
const { classifyResponseEmotion } = require('./services/response-emotion-service');

// === 新架构集成（src/ → dist/） ===
// 运行时状态：loading → langgraph_ready | initialization_failed
// initialization_failed 时回退到旧链路，并在 UI 明确提示
let archState = 'loading';
let archInitError = null;
let newArch = null;
try {
  newArch = require('../dist/main/integration.js');
} catch (error) {
  archState = 'initialization_failed';
  archInitError = `Module load failed: ${error?.message || String(error)}`;
  console.error('[integration] new architecture module not loaded:', archInitError);
}

// 加载 IPC Schema 校验器
let ipcSchema = null;
try {
  ipcSchema = require('../dist/shared/schemas/ipc.js');
} catch (error) {
  console.warn('[integration] ipc schema not loaded, validation disabled:', error?.message || error);
}

/**
 * 校验 IPC 输入。校验失败时抛出 Error（含错误详情）。
 * 对应架构计划第 1 节"所有 IPC 输入经过 Schema 校验"。
 */
function validateIpc(channel, input) {
  if (!ipcSchema?.validateIpcInput) return input; // 校验器未加载时放行（开发模式）
  const result = ipcSchema.validateIpcInput(channel, input);
  if (!result.valid) {
    const issues = result.issues.map((i) => `${i.path}: ${i.message}`).join('; ');
    throw new Error(`IPC validation failed for ${channel}: ${issues}`);
  }
  return result.data;
}

let newArchReady = false;

/**
 * 包装旧 readApiConfig/saveApiConfig 为 SecretStore 接口。
 * 新架构 ModelGateway 通过此接口读取 API Key（沿用 safeStorage 加密）。
 */
function createSecretStoreAdapter() {
  return {
    read() {
      const cfg = readApiConfig({ includeSecret: true });
      if (!cfg.apiKey) return null;
      return {
        provider: cfg.provider,
        endpoint: cfg.endpoint,
        model: cfg.model,
        apiKey: cfg.apiKey
      };
    },
    write(nextConfig) {
      saveApiConfig(nextConfig);
    },
    clear() {
      saveApiConfig({ clearApiKey: true });
    },
    isEncrypted() {
      return safeStorage.isEncryptionAvailable();
    }
  };
}

/**
 * 将架构状态写入 userData/architecture-status.json，便于排查初始化失败。
 * 不包含 API Key 等敏感信息。
 */
function saveArchitectureStatus() {
  try {
    const statusFile = path.join(app.getPath('userData'), 'architecture-status.json');
    const status = {
      timestamp: new Date().toISOString(),
      state: archState,
      newArchLoaded: !!newArch,
      newArchReady,
      error: archInitError
    };
    fs.writeFileSync(statusFile, JSON.stringify(status, null, 2), 'utf-8');
  } catch (e) {
    console.error('[integration] failed to save architecture status:', e?.message);
  }
}

/**
 * 初始化新架构。在 app.whenReady 之后调用。
 * 失败时标记 initialization_failed，记录错误，但不阻塞旧链路。
 */
function tryInitNewArchitecture() {
  if (!newArch) {
    archState = 'initialization_failed';
    saveArchitectureStatus();
    return;
  }
  try {
    newArch.initNewArchitecture({
      isPackaged: app.isPackaged,
      userDataDir: app.getPath('userData'),
      resourcesDir: process.resourcesPath,
      appRoot: app.getAppPath(),
      secretStore: createSecretStoreAdapter(),
      onRendererCallback: (dto, channel) => {
        return deliverToRendererWithAck(dto, channel);
      }
    });
    newArch.startScheduler();
    newArchReady = true;
    archState = 'langgraph_ready';
    archInitError = null;
    console.log('[integration] new architecture ready');
    saveArchitectureStatus();
  } catch (error) {
    archState = 'initialization_failed';
    archInitError = `Init failed: ${error?.message || String(error)}`;
    console.error('[integration] init failed:', archInitError);
    newArchReady = false;
    saveArchitectureStatus();
  }
}

// ===== pet-character:// 自定义协议 =====
// 注册为特权协议，允许 renderer 通过 background-image 加载角色包精灵图
// 必须在 app.whenReady() 之前调用
protocol.registerSchemesAsPrivileged([{
  scheme: 'pet-character',
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    stream: true
  }
}]);

/**
 * 注册 pet-character:// 协议处理器。
 * URL 格式：pet-character://<characterId>/<relative-path>
 * 解析为当前激活角色包目录内的文件，限制路径穿越。
 */
function registerCharacterProtocol() {
  protocol.handle('pet-character', (request) => {
    const url = new URL(request.url);
    // url.hostname = characterId, url.pathname = /relative/path
    const relativePath = decodeURIComponent(url.pathname).replace(/^\//, '');

    if (!relativePath) {
      return new Response('Bad Request: no path', { status: 400 });
    }

    // 从新架构获取当前激活角色包路径
    const packPath = newArch?.getActiveCharacterPackPath?.();
    if (!packPath) {
      return new Response('Not Found: no active character pack', { status: 404 });
    }

    const fullPath = path.resolve(packPath, relativePath);
    // 路径穿越检查：确保解析后的路径在角色包目录内
    const relative = path.relative(packPath, fullPath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      return new Response('Forbidden: path escapes pack directory', { status: 403 });
    }

    if (!fs.existsSync(fullPath)) {
      return new Response('Not Found', { status: 404 });
    }

    // 返回文件流
    const fileStream = fs.createReadStream(fullPath);
    return new Response(fileStream, {
      headers: { 'Content-Type': getMimeType(fullPath) }
    });
  });
}

/** 根据文件扩展名返回 MIME 类型 */
function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeMap = {
    '.webp': 'image/webp',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.json': 'application/json',
    '.md': 'text/markdown'
  };
  return mimeMap[ext] || 'application/octet-stream';
}

/**
 * 向 renderer 发送角色渲染配置。
 * 在窗口加载完成后调用，使 renderer 使用角色包的 spritesheet 替代默认 placeholder。
 */
function sendCharacterRenderConfig() {
  if (!newArchReady || !newArch?.getCharacterRenderConfig) return;
  try {
    const config = newArch.getCharacterRenderConfig();
    if (config && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('character-config', config);
      console.log('[integration] character config sent to renderer:', config.characterId);
    }
  } catch (error) {
    console.error('[integration] failed to send character config:', error?.message || error);
  }
}

// === Renderer ACK 机制 ===
// 主动事件（pet_bubble）需要 renderer 确认实际显示后才算投递成功。
// 主进程发送 proactive-event 后，等待 renderer 回调 proactive-event:ack。
// 超时（5 秒）或窗口销毁则视为失败，Dispatcher 会保持 delivered=false 以便重试。
const ACK_TIMEOUT_MS = 5000;
/** @type {Map<string, {resolve: (v: boolean) => void, reject: (e: Error) => void, timer: NodeJS.Timeout}>} */
const pendingAcks = new Map();

/**
 * 将 DTO 发送到 renderer，对于 proactive-event 通道等待 ACK。
 * 返回 Promise<boolean>：true=已确认显示，false=超时/窗口销毁/非主动事件。
 */
function deliverToRendererWithAck(dto, channel) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return Promise.resolve(false);
  }

  // 非主动事件通道直接发送，不等待 ACK
  if (channel !== 'proactive-event') {
    mainWindow.webContents.send(channel, dto);
    return Promise.resolve(true);
  }

  // 主动事件：需要 ACK 确认
  const occurrenceId = dto?.reminderOccurrenceId;
  if (!occurrenceId) {
    // 没有投递 ID，无法追踪 ACK，直接发送并视为成功
    mainWindow.webContents.send(channel, dto);
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    // 如果已存在相同 ID 的 pending ACK，先超时旧的
    const existing = pendingAcks.get(occurrenceId);
    if (existing) {
      clearTimeout(existing.timer);
      pendingAcks.delete(occurrenceId);
      existing.resolve(false);
    }

    const timer = setTimeout(() => {
      if (pendingAcks.has(occurrenceId)) {
        pendingAcks.delete(occurrenceId);
        console.warn(`[ack] timeout for ${occurrenceId}`);
        resolve(false);
      }
    }, ACK_TIMEOUT_MS);

    pendingAcks.set(occurrenceId, { resolve, timer });

    // 发送到 renderer
    try {
      mainWindow.webContents.send(channel, dto);
    } catch (error) {
      clearTimeout(timer);
      pendingAcks.delete(occurrenceId);
      resolve(false);
    }
  });
}

// 窗口销毁时，拒绝所有 pending ACK
function rejectAllPendingAcks() {
  for (const [id, entry] of pendingAcks) {
    clearTimeout(entry.timer);
    entry.resolve(false);
  }
  pendingAcks.clear();
}

/**
 * 使用新架构处理聊天消息。
 * 抛出 Error 表示本轮处理失败，由调用方决定是否回退。
 * 不再静默返回 null 并回退到旧链路。
 */
async function sendChatMessageNewArch(payload) {
  if (!newArch || !newArchReady) throw new Error('new architecture not ready');
  const userId = newArch.getUserId?.() || 'default-user';
  const characterId = (newArch.getCharacterPackManager?.()?.getActiveCharacterId?.()) || 'default';
  const message = String(payload?.message || '').trim();
  if (!message) throw new Error('empty message');

  const dto = await newArch.handleChatMessage(userId, characterId, message);
  if (!dto) throw new Error('ConversationGraph returned null');

  // 映射 ResponseDTO → 旧 renderer 期望的格式
  return {
    reply: dto.text,
    model: 'new-arch',
    emotion: dto.expression || null,
    emotionSource: dto.expression ? 'new-arch' : null,
    postCheck: null,
    postCheckRewritten: false
  };
}

const NETWORK_TIMEOUT_MS = 30000;

function fetchWithTimeout(url, options = {}, timeoutMs = NETWORK_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

let mainWindow;
let alwaysOnTop = true;
let dragAnimating = false;
let lastWindowX = 0;
let dragStopTimer = null;
let fullscreenProbeProcess = null;
let fullscreenProbeBuffer = '';
let hiddenForFullscreen = false;
let isQuitting = false;
let safeShellService = null;

const startSize = { width: 300, height: 360 };
const minScale = 0.35;
const maxScale = 1.6;
const defaultApiConfig = {
  provider: 'deepseek',
  endpoint: 'https://api.deepseek.com/v1/chat/completions',
  model: 'deepseek-chat',
  apiKey: ''
};
const profileSummaryIntervalMs = 3 * 24 * 60 * 60 * 1000;

function getSafeShellService() {
  if (!safeShellService) {
    const workingRoot = process.env.SAFE_SHELL_TEST_ROOT
      ? path.resolve(process.env.SAFE_SHELL_TEST_ROOT)
      : app.isPackaged
        ? path.dirname(process.execPath)
        : app.getAppPath();
    safeShellService = new SafeShellService({ app, workingRoot });
  }
  return safeShellService;
}

const userPetName = petProfile.userPetName || '用户';

const text = {
  hydrateNow: `\u7acb\u5373\u63d0\u9192${userPetName}\u559d\u6c34`,
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

  // 窗口加载完成后发布 startup 事件（触发 Onboarding 或日报）
  mainWindow.webContents.once('did-finish-load', () => {
    // 先发送角色渲染配置，使 renderer 使用角色包 spritesheet
    sendCharacterRenderConfig();
    if (newArchReady && newArch?.publishStartupEvent) {
      newArch.publishStartupEvent();
    }
    // 恢复 active plan 到桌面气泡
    restoreActivePlanOnStartup();
  });

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

  // 窗口关闭/崩溃时，拒绝所有 pending ACK，避免 Dispatcher 永久等待
  mainWindow.on('closed', () => {
    rejectAllPendingAcks();
  });
  mainWindow.webContents.on('render-process-gone', () => {
    rejectAllPendingAcks();
  });
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

const KNOWN_PROVIDER_ENDPOINTS = {
  deepseek: 'https://api.deepseek.com/v1/chat/completions',
  openai: 'https://api.openai.com/v1/chat/completions',
  anthropic: 'https://api.anthropic.com/v1/messages',
  minimax: 'https://api.minimax.chat/v1/text/chatcompletion_v2'
};

let sessionApiKey = '';

function encodeApiKey(apiKey) {
  if (!apiKey) return '';
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.encryptString(apiKey).toString('base64');
  }
  sessionApiKey = apiKey;
  return '';
}

function decodeApiKey(value, encrypted = true) {
  if (!value) return '';
  try {
    if (!encrypted || !safeStorage.isEncryptionAvailable()) {
      return '';
    }
    const buffer = Buffer.from(value, 'base64');
    return safeStorage.decryptString(buffer);
  } catch {
    return '';
  }
}

function getStoredApiKey(saved, options) {
  if (safeStorage.isEncryptionAvailable()) {
    return decodeApiKey(saved.apiKey, saved.encrypted !== false);
  }
  if (options.includeSecret) {
    return sessionApiKey;
  }
  return '';
}

function validateEndpoint(endpoint) {
  const trimmed = String(endpoint || '').trim();
  if (!trimmed) return { valid: false, reason: 'Endpoint is empty.' };

  let url;
  try {
    url = new URL(trimmed);
  } catch {
    return { valid: false, reason: 'Endpoint is not a valid URL.' };
  }

  const isLocalhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1';
  if (url.protocol !== 'https:' && !isLocalhost) {
    return { valid: false, reason: 'Endpoint must use HTTPS. Localhost is allowed for development.' };
  }

  return { valid: true };
}

function readApiConfig(options = {}) {
  const result = readJsonWithFallback(getApiConfigPath());
  const saved = result.data || {};
  const apiKey = getStoredApiKey(saved, options);
  return {
    provider: saved.provider || defaultApiConfig.provider,
    endpoint: saved.endpoint || defaultApiConfig.endpoint,
    model: saved.model || defaultApiConfig.model,
    hasApiKey: Boolean(apiKey),
    apiKey: options.includeSecret ? apiKey : '',
    encryptionAvailable: safeStorage.isEncryptionAvailable()
  };
}

function saveApiConfig(nextConfig = {}) {
  const current = readApiConfig({ includeSecret: true });
  const nextEndpoint = String(nextConfig.endpoint || current.endpoint || defaultApiConfig.endpoint).trim();
  const validation = validateEndpoint(nextEndpoint);
  if (!validation.valid) {
    throw new Error(validation.reason);
  }

  const nextKey = nextConfig.clearApiKey ? '' : String(nextConfig.apiKey || current.apiKey || '').trim();
  const encrypted = safeStorage.isEncryptionAvailable();
  const payload = {
    provider: String(nextConfig.provider || defaultApiConfig.provider).trim(),
    endpoint: nextEndpoint,
    model: String(nextConfig.model || defaultApiConfig.model).trim(),
    encrypted,
    apiKey: encodeApiKey(nextKey)
  };
  atomicWriteJson(getApiConfigPath(), payload);
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

function saveHarnessState(nextState) {
  try {
    updatePetData(app, (data) => {
      data.prompt = {
        ...(data.prompt || {}),
        conversationHarnessState: normalizeConversationState(nextState)
      };
      return data;
    });
  } catch (error) {
    console.warn('Harness state save failed; chat will continue.', error?.message || error);
  }
}

function getFallbackSystemPrompt(warnings = []) {
  const characterName = petProfile.characterName || 'Pet';
  const coreFallback = String(petProfile.corePrompt || '').trim()
    ? String(petProfile.corePrompt).split('\n').map((line) => line.trim()).filter(Boolean)
    : [`你是 ${characterName}，一个小小的桌面宠物和陪伴助手。`];
  const prompt = [
    '\u3010\u89d2\u8272\u6838\u5fc3\u8bbe\u5b9a\u3011',
    ...coreFallback,
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

function getMemoryAnalysisUnavailableResult(reason = 'memory_ai_unavailable') {
  return {
    ok: false,
    remembered: false,
    action: 'skip',
    type: '',
    entry: null,
    message: '\u5f53\u524d\u65e0\u6cd5\u4f7f\u7528 AI \u5224\u65ad\u5e76\u4fdd\u5b58\u8bb0\u5fc6\uff0c\u8bf7\u68c0\u67e5 API \u8bbe\u7f6e\u540e\u518d\u8bd5\u3002',
    reason
  };
}

function getMemoryAnalysisSkippedResult(reason = 'not_memory_worthy') {
  return {
    ok: true,
    remembered: false,
    action: 'skip',
    type: '',
    entry: null,
    message: '',
    reason
  };
}

function summarizeMemoriesForAnalysis(memory = {}) {
  const summarize = (type) => {
    const bucket = Array.isArray(memory[type]) ? memory[type] : [];
    return bucket.slice(-20).map((entry) => ({
      id: String(entry.id || ''),
      type,
      content: String(entry.content || '').slice(0, 180),
      topic: String(entry.topic || '').slice(0, 40),
      category: String(entry.category || '').slice(0, 40),
      key: String(entry.key || '').slice(0, 60),
      value: String(entry.value || '').slice(0, 180),
      confidence: Number(entry.confidence) || 1,
      pinned: Boolean(entry.pinned),
      sourceMessage: String(entry.sourceMessage || '').slice(0, 120),
      profileCandidate: Boolean(entry.profileCandidate),
      profileReason: String(entry.profileReason || '').slice(0, 120),
      tags: Array.isArray(entry.tags) ? entry.tags.slice(0, 8) : [],
      importance: Number(entry.importance) || 1,
      reminder: type === 'longTerm' && entry.reminder ? {
        enabled: Boolean(entry.reminder.enabled),
        frequency: String(entry.reminder.frequency || ''),
        time: String(entry.reminder.time || ''),
        note: String(entry.reminder.note || '').slice(0, 120)
      } : undefined
    }));
  };

  return {
    user: summarize('user'),
    longTerm: summarize('longTerm'),
    shortTerm: summarize('shortTerm')
  };
}

function summarizeActiveShortTermMemories(memory = {}) {
  const bucket = Array.isArray(memory.shortTerm) ? memory.shortTerm : [];
  const now = Date.now();
  return bucket
    .filter((entry) => {
      if (!entry.expiresAt) return true;
      const expiresAt = Date.parse(entry.expiresAt);
      return Number.isNaN(expiresAt) || expiresAt > now;
    })
    .slice(-12)
    .map((entry) => ({
      id: String(entry.id || ''),
      topic: String(entry.topic || '').slice(0, 40),
      content: String(entry.content || '').slice(0, 500),
      tags: Array.isArray(entry.tags) ? entry.tags.slice(0, 8) : [],
      importance: Number(entry.importance) || 1,
      profileCandidate: Boolean(entry.profileCandidate),
      profileReason: String(entry.profileReason || '').slice(0, 120),
      expiresAt: String(entry.expiresAt || '')
    }));
}

function extractJsonObject(textValue) {
  const textContent = String(textValue || '').trim();
  if (!textContent) {
    throw new Error('AI memory response is empty.');
  }
  const fenced = textContent.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : textContent;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('AI memory response did not include JSON.');
  }
  return JSON.parse(candidate.slice(start, end + 1));
}

function buildShortTermAnalysisMessages(userText, activeShortTerm) {
  const schema = {
    shouldRemember: true,
    action: 'create',
    targetId: '',
    topic: '\u5403\u836f',
    content: '\u7528\u6237\u63d0\u5230\u4e00\u4ef6\u4e0e\u5403\u836f\u6709\u5173\u7684\u4e8b\u3002',
    tags: ['\u5403\u836f'],
    importance: 2,
    profileCandidate: false,
    profileReason: '',
    reason: ''
  };

  return [
    {
      role: 'system',
      content: [
        'You curate short-term working memory for a desktop pet.',
        'Short-term memory is grouped by topic segments. It keeps useful conversational facts for 24 hours.',
        'Ignore only meaningless greetings, laughter, acknowledgements, and pure small talk.',
        'For useful information, return exactly one JSON object and no markdown.',
        'If the message belongs to an existing topic segment, use action "update" and targetId.',
        'If it starts a new topic, use action "create".',
        'Do not overwrite distinct facts inside the same topic; merge them into a detailed but readable segment summary.',
        'Topic should be concise, such as "\u5403\u836f", "\u56fe\u4e66\u9986", "\u5b66\u4e60\u82f1\u8bed", or "\u5de5\u4f5c\u8ba1\u5212".',
        'Content should preserve enough detail for later pronouns like "\u8fd9\u4e24\u4e2a", "\u521a\u624d\u90a3\u4e2a", and "\u4e0d\u662f\u540c\u4e00\u4e2a" to be resolved.',
        'Set profileCandidate true only when the message may reveal stable user profile, preference, dislike, identity, birthday, occupation, habit, boundary, or important health self-description.',
        'Do not set profileCandidate true for ordinary reminders, one-time tasks, greetings, or pure scheduling unless they reveal a stable user trait.',
        'Example: if one segment already says the user needs medicine tonight and the new message says daily 9pm medicine, update the same topic segment to include both as separate medicine-related facts.',
        `JSON schema example: ${JSON.stringify(schema)}`
      ].join('\n')
    },
    {
      role: 'user',
      content: JSON.stringify({
        userMessage: userText,
        activeShortTerm
      })
    }
  ];
}

function buildMemoryAnalysisMessages(userText, existingMemories) {
  const schema = {
    shouldRemember: false,
    type: 'user',
    action: 'skip',
    targetId: '',
    content: '',
    tags: [],
    importance: 1,
    reminder: {
      enabled: false,
      frequency: '',
      time: '',
      note: ''
    },
    reason: ''
  };

  return [
    {
      role: 'system',
      content: [
        'You are a memory curator for a desktop pet app.',
        'Decide whether the user message contains durable, useful memory.',
        'Return exactly one JSON object and no markdown.',
        'Do not write stable user profile, preferences, identity, birthday, habits, or dislikes here; those are handled by a separate user-profile memory curator.',
        'Use type "longTerm" for goals, plans, recurring commitments, reminders, medication schedules, and future tasks.',
        'Use type "longTerm" or action "skip" only.',
        'Use action "update" with targetId when the new memory duplicates or conflicts with an existing memory.',
        'Use action "skip" when the message is low value, temporary, unclear, or only small talk.',
        'Write content as a clean natural Chinese sentence. Do not copy the raw message unless it is already optimal.',
        'Tags must be short lowercase English or concise Chinese labels.',
        'Importance must be an integer from 1 to 5.',
        'For reminder memories, set reminder.enabled true and fill frequency, time, and note when available.',
        'Use shortTerm context to resolve references such as "\u8fd9\u4e24\u4e2a", "\u521a\u624d", "\u4e0d\u662f\u540c\u4e00\u4e2a", and related follow-up corrections.',
        'If the user clarifies that two remembered facts are different, preserve or create separate long-term memories rather than merging them.',
        'You may return {"items":[...]} when more than one memory operation is needed, such as updating one memory and creating another.',
        'Temporal precision is critical: never turn one-time wording into recurring wording.',
        'If the user says today, tonight, this evening, this week, or a specific one-time date, use reminder.frequency "once".',
        'Only use "daily" when the user explicitly says every day, daily, every morning, every night, or an equivalent recurring phrase.',
        'Only use "weekly" or "monthly" when the user explicitly says every week or every month.',
        'If wording is ambiguous, preserve uncertainty and choose "once" instead of inventing a routine.',
        'Examples:',
        '- User: "\u4eca\u5929\u665a\u4e0a\u8981\u5403\u836f" => content "\u7528\u6237\u4eca\u5929\u665a\u4e0a\u9700\u8981\u5403\u836f\u3002", type "longTerm", reminder.frequency "once", reminder.time "\u4eca\u5929\u665a\u4e0a".',
        '- User: "\u6bcf\u5929\u665a\u4e0a9\u70b9\u63d0\u9192\u6211\u5403\u836f" => content "\u7528\u6237\u9700\u8981\u6bcf\u5929\u665a\u4e0a9\u70b9\u5403\u836f\u3002", type "longTerm", reminder.frequency "daily", reminder.time "\u665a\u4e0a9\u70b9".',
        '- User: "\u6211\u559c\u6b22\u559d\u51b0\u7f8e\u5f0f" => type "user", content "\u7528\u6237\u559c\u6b22\u559d\u51b0\u7f8e\u5f0f\u3002", action "create".',
        '- User: "\u8fd9\u4e24\u4e2a\u662f\u4e0d\u540c\u7684\u836f" with shortTerm showing tonight medicine and daily 9pm medicine => return items that keep two separate medication memories.',
        `JSON schema example: ${JSON.stringify(schema)}`
      ].join('\n')
    },
    {
      role: 'user',
      content: JSON.stringify({
        userMessage: userText,
        existingMemories
      })
    }
  ];
}

function buildUserProfileAnalysisMessages(userText, existingMemories, profileReason = '') {
  const schema = {
    shouldRemember: true,
    type: 'user',
    action: 'create',
    targetId: '',
    content: '\u7528\u6237\u559c\u6b22\u559d\u51b0\u7f8e\u5f0f\u3002',
    category: 'preference',
    key: 'coffee',
    value: '\u559c\u6b22\u51b0\u7f8e\u5f0f',
    confidence: 4,
    pinned: false,
    tags: ['\u504f\u597d', '\u5496\u5561'],
    importance: 3,
    sourceMessage: '',
    reason: ''
  };

  return [
    {
      role: 'system',
      content: [
        'You curate structured user-profile memory for a desktop pet.',
        'Return exactly one JSON object and no markdown.',
        'Only remember stable or semi-stable user information: identity, preferred name, birthday, occupation, preferences, dislikes, habits, boundaries, relationships, and important health self-descriptions.',
        'Do not store temporary events, one-time tasks, reminders, plans, schedules, or casual small talk as user profile.',
        'Use category only from: identity, preference, dislike, habit, birthday, occupation, relationship, boundary, health, other.',
        'Use a concise stable key such as name, preferred_name, birthday, coffee, sleep_habit, study_habit, communication_boundary.',
        'Use value as a short normalized phrase. Write content as a clean natural Chinese sentence.',
        'If new information conflicts with or replaces an old user memory, use action "update" and targetId.',
        'If the same category and key already exists, prefer update over create.',
        'For uncertain inference, skip instead of inventing a profile.',
        'Never output type other than "user".',
        'Examples:',
        '- User: "\u6211\u53eb\u5c0f\u6797" => category identity, key name, value "\u5c0f\u6797".',
        '- User: "\u4ee5\u540e\u53eb\u6211\u6797\u6797" => category identity, key preferred_name, value "\u6797\u6797".',
        '- User: "\u51b0\u7f8e\u5f0f\u633a\u597d\u559d\u7684" => category preference, key coffee, value "\u559c\u6b22\u51b0\u7f8e\u5f0f".',
        '- User: "\u6211\u4e0d\u559c\u6b22\u5496\u5561\u4e86" with an old coffee preference => update the old coffee memory.',
        '- User: "\u4eca\u5929\u665a\u4e0a\u8981\u5403\u836f" => skip; it is a task/reminder, not profile.',
        `JSON schema example: ${JSON.stringify(schema)}`
      ].join('\n')
    },
    {
      role: 'user',
      content: JSON.stringify({
        userMessage: userText,
        profileReason,
        existingUserMemories: existingMemories.user || [],
        activeShortTerm: existingMemories.shortTerm || []
      })
    }
  ];
}

function buildProfileSummaryMessages(existingMemories) {
  const schema = {
    shouldRemember: true,
    type: 'user',
    action: 'update',
    targetId: '',
    content: '\u7528\u6237\u5c55\u73b0\u51fa\u6301\u7eed\u5b66\u4e60\u3001\u613f\u610f\u7167\u987e\u81ea\u5df1\u548c\u6e05\u6670\u8868\u8fbe\u9700\u6c42\u7684\u4f18\u70b9\u3002',
    category: 'profile_summary',
    key: 'strength_summary',
    value: '\u6301\u7eed\u5b66\u4e60\uff0c\u613f\u610f\u7167\u987e\u81ea\u5df1\uff0c\u6e05\u6670\u8868\u8fbe\u9700\u6c42',
    confidence: 3,
    pinned: true,
    tags: ['\u7528\u6237\u753b\u50cf', '\u4f18\u70b9'],
    importance: 4,
    sourceMessage: '',
    reason: ''
  };

  return [
    {
      role: 'system',
      content: [
        'You update one pinned user-profile strength summary for a desktop pet.',
        'Return exactly one JSON object and no markdown.',
        'Summarize only the user strengths that are supported by saved user memories and recently settled short-term context.',
        'Do not mention flaws, diagnoses, sensitive labels, personality judgments, or unsupported assumptions.',
        'Use warm, concrete Chinese suitable for companion context.',
        'Update the existing profile_summary target when present; otherwise create one.',
        'Always use type "user", category "profile_summary", key "strength_summary", pinned true, and tags ["\u7528\u6237\u753b\u50cf","\u4f18\u70b9"].',
        'If there is not enough positive evidence, return shouldRemember false and action skip.',
        `JSON schema example: ${JSON.stringify(schema)}`
      ].join('\n')
    },
    {
      role: 'user',
      content: JSON.stringify({
        existingUserMemories: existingMemories.user || [],
        recentShortTerm: (existingMemories.shortTerm || []).filter((entry) => entry.profileCandidate).slice(-8)
      })
    }
  ];
}

function hasRecurringTimeIntent(textValue) {
  return /(\u6bcf\u5929|\u6bcf\u65e5|\u6bcf\u665a|\u6bcf\u65e9|\u6bcf\u5468|\u6bcf\u661f\u671f|\u6bcf\u6708|\u957f\u671f|\u4ee5\u540e\u90fd|\u4ee5\u540e\u6bcf|\bdaily\b|\bevery day\b|\bweekly\b|\bmonthly\b)/iu.test(String(textValue || ''));
}

function hasOneTimeTimeIntent(textValue) {
  return /(\u4eca\u5929|\u4eca\u665a|\u4eca\u5929\u665a\u4e0a|\u4eca\u591c|\u660e\u5929|\u660e\u665a|\u8fd9\u5468|\u672c\u5468|\u8fd9\u4e2a\u6708|\u672c\u6708|\btonight\b|\btoday\b|\btomorrow\b)/iu.test(String(textValue || ''));
}

function correctOneTimeReminderDecision(decision, userText) {
  const next = decision && typeof decision === 'object' ? { ...decision } : {};
  const reminder = next.reminder && typeof next.reminder === 'object' ? { ...next.reminder } : null;
  const shouldCorrect = next.type === 'longTerm'
    && reminder
    && hasOneTimeTimeIntent(userText)
    && !hasRecurringTimeIntent(userText);

  if (!shouldCorrect) {
    return next;
  }

  reminder.frequency = 'once';
  if (!String(reminder.time || '').trim()) {
    reminder.time = /\u4eca\u665a|\u4eca\u5929\u665a\u4e0a|\u4eca\u591c/u.test(userText)
      ? '\u4eca\u5929\u665a\u4e0a'
      : '\u4eca\u5929';
  }
  if (typeof reminder.note === 'string') {
    reminder.note = reminder.note
      .replace(/\u6bcf\u5929\u665a\u4e0a|\u6bcf\u665a/gu, '\u4eca\u5929\u665a\u4e0a')
      .replace(/\u6bcf\u5929|\u6bcf\u65e5/gu, '\u4eca\u5929');
  }
  next.reminder = reminder;
  if (typeof next.content === 'string') {
    next.content = next.content
      .replace(/\u6bcf\u5929\u665a\u4e0a|\u6bcf\u665a/gu, '\u4eca\u5929\u665a\u4e0a')
      .replace(/\u6bcf\u5929|\u6bcf\u65e5/gu, '\u4eca\u5929');
  }
  next.reason = String(next.reason || '')
    ? `${next.reason}; corrected one-time temporal wording`
    : 'corrected one-time temporal wording';
  return next;
}

async function callMemoryAnalysisApi(config, userText, existingMemories) {
  const response = await fetchWithTimeout(config.endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: config.model,
      messages: buildMemoryAnalysisMessages(userText, existingMemories),
      temperature: 0,
      max_tokens: 700,
      stream: false
    })
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Memory analysis API failed: ${response.status} ${detail.slice(0, 160)}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  return extractJsonObject(content);
}

async function callUserProfileAnalysisApi(config, userText, existingMemories, profileReason = '') {
  const response = await fetchWithTimeout(config.endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: config.model,
      messages: buildUserProfileAnalysisMessages(userText, existingMemories, profileReason),
      temperature: 0,
      max_tokens: 700,
      stream: false
    })
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`User profile memory API failed: ${response.status} ${detail.slice(0, 160)}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  return extractJsonObject(content);
}

async function callShortTermAnalysisApi(config, userText, activeShortTerm) {
  const response = await fetchWithTimeout(config.endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: config.model,
      messages: buildShortTermAnalysisMessages(userText, activeShortTerm),
      temperature: 0,
      max_tokens: 650,
      stream: false
    })
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Short-term memory API failed: ${response.status} ${detail.slice(0, 160)}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  return extractJsonObject(content);
}

async function callProfileSummaryApi(config, existingMemories) {
  const response = await fetchWithTimeout(config.endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: config.model,
      messages: buildProfileSummaryMessages(existingMemories),
      temperature: 0,
      max_tokens: 650,
      stream: false
    })
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Profile summary API failed: ${response.status} ${detail.slice(0, 160)}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  return extractJsonObject(content);
}

function buildShortTermSedimentationMessages(segment, existingMemories) {
  const schema = {
    items: [
      {
        shouldRemember: true,
        type: 'longTerm',
        action: 'create',
        targetId: '',
        content: '\u7528\u6237\u67d0\u5929\u53bb\u4e86\u56fe\u4e66\u9986\u5e76\u9605\u8bfb\u4e86\u67d0\u672c\u4e66\u3002',
        tags: ['\u56fe\u4e66\u9986', '\u4e66\u540d'],
        importance: 2,
        reminder: {
          enabled: false,
          frequency: '',
          time: '',
          note: ''
        },
        reason: ''
      }
    ]
  };

  return [
    {
      role: 'system',
      content: [
        'You condense expired short-term topic memory into durable long-term memory.',
        'Return exactly one JSON object and no markdown.',
        'Keep only durable, useful facts. Drop incidental details that are not useful later.',
        'Preserve dates, places, books, goals, recurring tasks, preferences, and important outcomes.',
        'Use concise Chinese natural sentences and clear tags.',
        'If nothing is worth long-term storage, return {"items":[{"shouldRemember":false,"action":"skip"}]}.',
        'Use action "update" with targetId when the condensed memory overlaps or conflicts with existing memory.',
        `JSON schema example: ${JSON.stringify(schema)}`
      ].join('\n')
    },
    {
      role: 'user',
      content: JSON.stringify({
        shortTermSegment: segment,
        existingMemories
      })
    }
  ];
}

async function callSedimentationApi(config, segment, existingMemories) {
  const response = await fetchWithTimeout(config.endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: config.model,
      messages: buildShortTermSedimentationMessages(segment, existingMemories),
      temperature: 0,
      max_tokens: 720,
      stream: false
    })
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Short-term sedimentation API failed: ${response.status} ${detail.slice(0, 160)}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  return extractJsonObject(content);
}

async function applyShortTermWorkingMemory(config, userText, petData) {
  if (!memoryService.shouldAnalyzeShortTermMemory(userText)) {
    return { remembered: false, reason: 'low_value_short_term' };
  }

  const activeShortTerm = summarizeActiveShortTermMemories(petData.memory);
  const rawDecision = await callShortTermAnalysisApi(config, userText, activeShortTerm);
  const normalizedDecision = memoryService.normalizeShortTermDecision(rawDecision, activeShortTerm);
  return memoryService.applyShortTermMemory(app, normalizedDecision, userText);
}

async function settleExpiredShortTermMemories(config) {
  const expired = memoryService.getExpiredShortTermMemories(app);
  if (!expired.length) {
    return { settled: 0, removed: 0 };
  }

  let settled = 0;
  const removableIds = [];
  for (const segment of expired.slice(0, 5)) {
    const petData = loadPetData(app);
    const existingMemories = summarizeMemoriesForAnalysis(petData.memory);
    const rawDecision = await callSedimentationApi(config, {
      id: segment.id,
      topic: segment.topic || '',
      content: segment.content || '',
      tags: Array.isArray(segment.tags) ? segment.tags : [],
      createdAt: segment.createdAt || '',
      updatedAt: segment.updatedAt || '',
      sourceMessage: segment.sourceMessage || ''
    }, existingMemories);
    const normalizedDecisions = memoryService.normalizeAiMemoryDecisions(rawDecision, existingMemories);
    const applied = memoryService.applyAnalyzedMemories(app, normalizedDecisions);
    settled += applied.length;
    removableIds.push(segment.id);
  }

  const removed = memoryService.deleteShortTermMemoriesByIds(app, removableIds).removed;
  return { settled, removed };
}

function shouldUpdateProfileSummary(petData = {}) {
  const lastUpdatedAt = String(petData.prompt?.profileSummaryLastUpdatedAt || '');
  if (!lastUpdatedAt) return true;
  const timestamp = Date.parse(lastUpdatedAt);
  return Number.isNaN(timestamp) || Date.now() - timestamp >= profileSummaryIntervalMs;
}

function markProfileSummaryChecked() {
  updatePetData(app, (data) => {
    data.prompt = {
      ...(data.prompt || {}),
      profileSummaryLastUpdatedAt: new Date().toISOString()
    };
    return data;
  });
}

async function updatePinnedProfileSummaryIfNeeded(config, petData) {
  if (!shouldUpdateProfileSummary(petData)) {
    return { remembered: false, reason: 'profile_summary_not_due' };
  }

  try {
    const existingMemories = summarizeMemoriesForAnalysis(petData.memory);
    const rawDecision = await callProfileSummaryApi(config, existingMemories);
    const existingSummary = (existingMemories.user || []).find((entry) => (
      entry.category === 'profile_summary' && entry.key === 'strength_summary'
    ));
    if (rawDecision && typeof rawDecision === 'object') {
      rawDecision.type = 'user';
      rawDecision.category = 'profile_summary';
      rawDecision.key = 'strength_summary';
      rawDecision.pinned = true;
      rawDecision.tags = ['\u7528\u6237\u753b\u50cf', '\u4f18\u70b9'];
      if (existingSummary && rawDecision.action !== 'skip') {
        rawDecision.action = 'update';
        rawDecision.targetId = existingSummary.id;
      }
    }
    const normalizedDecision = memoryService.normalizeAiMemoryDecision(rawDecision, existingMemories);
    const applied = memoryService.applyAnalyzedMemory(app, normalizedDecision);
    markProfileSummaryChecked();
    return applied;
  } catch (error) {
    console.warn('Profile summary update failed.', error?.message || error);
    markProfileSummaryChecked();
    return { remembered: false, reason: 'profile_summary_failed' };
  }
}

async function analyzeAndApplyUserProfileMemory(config, userText, petData, profileReason = '') {
  const existingMemories = summarizeMemoriesForAnalysis(petData.memory);
  const rawDecision = await callUserProfileAnalysisApi(config, userText, existingMemories, profileReason);
  if (rawDecision && typeof rawDecision === 'object') {
    rawDecision.type = 'user';
    rawDecision.sourceMessage = userText;
  }
  const normalizedDecision = memoryService.normalizeAiMemoryDecision(rawDecision, existingMemories);
  return memoryService.applyAnalyzedMemory(app, normalizedDecision);
}

async function analyzeAndApplyMemory(textValue) {
  const rawUserText = String(textValue || '').trim();
  const userText = trimTextByChars(rawUserText, getDefaultTokenBudget().userInputMaxChars);
  const shouldAnalyzeShortTerm = memoryService.shouldAnalyzeShortTermMemory(userText);
  const shouldAnalyzeLongTerm = memoryService.shouldAnalyzeMemory(userText);
  const shouldAnalyzeProfileExplicit = memoryService.shouldAnalyzeUserProfileMemory(userText);

  if (!userText || (!shouldAnalyzeShortTerm && !shouldAnalyzeLongTerm && !shouldAnalyzeProfileExplicit)) {
    return getMemoryAnalysisSkippedResult('memory_keyword_not_matched');
  }

  const config = readApiConfig({ includeSecret: true });
  if (!config.apiKey) {
    return shouldAnalyzeLongTerm || shouldAnalyzeProfileExplicit
      ? getMemoryAnalysisUnavailableResult('missing_api_key')
      : getMemoryAnalysisSkippedResult('short_term_ai_unavailable');
  }

  try {
    await settleExpiredShortTermMemories(config).catch((error) => {
      console.warn('Short-term memory sedimentation failed.', error?.message || error);
    });

    let petData = loadPetData(app);
    await updatePinnedProfileSummaryIfNeeded(config, petData);
    petData = loadPetData(app);

    let shortTermResult = { remembered: false, entry: null };
    if (shouldAnalyzeShortTerm) {
      shortTermResult = await applyShortTermWorkingMemory(config, userText, petData).catch((error) => {
        console.warn('Short-term working memory update failed.', error?.message || error);
        return { remembered: false, entry: null };
      });
      petData = loadPetData(app);
    }

    const appliedMemories = [];
    const profileCandidate = Boolean(shortTermResult?.entry?.profileCandidate);
    const profileReason = shortTermResult?.entry?.profileReason || '';
    if (shouldAnalyzeProfileExplicit || profileCandidate) {
      const profileApplied = await analyzeAndApplyUserProfileMemory(
        config,
        userText,
        petData,
        profileReason || (shouldAnalyzeProfileExplicit ? 'explicit_profile_trigger' : '')
      ).catch((error) => {
        console.warn('User profile memory analysis failed.', error?.message || error);
        return { remembered: false, reason: 'profile_ai_failed' };
      });
      if (profileApplied.remembered) {
        appliedMemories.push(profileApplied);
        petData = loadPetData(app);
      }
    }

    let normalizedDecisions = [];
    if (shouldAnalyzeLongTerm) {
      const existingMemories = summarizeMemoriesForAnalysis(petData.memory);
      const rawDecision = await callMemoryAnalysisApi(config, userText, existingMemories).catch((error) => {
        console.warn('Long-term memory analysis failed.', error?.message || error);
        return null;
      });
      if (rawDecision) {
        const rawItems = rawDecision && typeof rawDecision === 'object' && Array.isArray(rawDecision.items)
          ? rawDecision.items
          : [rawDecision];
        const correctedDecision = { items: rawItems.map((item) => correctOneTimeReminderDecision(item, userText)) };
        normalizedDecisions = memoryService.normalizeAiMemoryDecisions(correctedDecision, existingMemories)
          .filter((item) => item.type === 'longTerm' || item.action === 'skip');
        appliedMemories.push(...memoryService.applyAnalyzedMemories(app, normalizedDecisions));
      }
    }

    if (!appliedMemories.length) {
      const reason = normalizedDecisions.find((item) => item.reason)?.reason || 'ai_skipped_memory';
      return getMemoryAnalysisSkippedResult(reason);
    }

    const first = appliedMemories[0];
    return {
      ok: true,
      remembered: true,
      action: appliedMemories.length > 1 ? 'multiple' : first.action,
      type: appliedMemories.length > 1 ? 'mixed' : first.type,
      entry: first.entry,
      entries: appliedMemories.map((item) => ({
        action: item.action,
        type: item.type,
        entry: item.entry
      })),
      reason: normalizedDecisions.map((item) => item.reason).filter(Boolean).join('; ')
    };
  } catch (error) {
    console.warn('AI memory analysis failed.', error?.message || error);
    return shouldAnalyzeLongTerm
      ? getMemoryAnalysisUnavailableResult('memory_ai_failed')
      : getMemoryAnalysisSkippedResult('short_term_ai_failed');
  }
}

function applyFinalPostCheck(reply, harnessResult) {
  if (!harnessResult) {
    return { reply, postCheck: null, rewritten: false };
  }
  try {
    const postCheck = runPostCheck(
      reply,
      harnessResult.analysis,
      harnessResult.policy,
      harnessResult.plan
    );
    if (!postCheck.shouldRewrite) {
      return { reply, postCheck, rewritten: false };
    }
    const rewritten = rewriteWithPostCheck(reply, postCheck, harnessResult.policy);
    return { reply: rewritten, postCheck, rewritten: true };
  } catch (error) {
    console.warn('Final reply post-check failed; returning original reply.', error?.message || error);
    return { reply, postCheck: null, rewritten: false };
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
  let harnessResult = null;
  const harnessPersonalityId = petProfile.conversationPersonalityId || 'warm_friend';
  try {
    const petData = loadPetData(app);
    harnessResult = await handleHarnessUserMessage(
      userText,
      petData.prompt?.conversationHarnessState,
      getPersonalityProfile(harnessPersonalityId)
    ).catch((error) => {
      console.warn('Conversation harness failed; chat will continue.', error?.message || error);
      return null;
    });
    if (harnessResult?.newState) {
      saveHarnessState(harnessResult.newState);
    }
    const affectionState = {
      ...petData.affection,
      promptHint: affectionService.getAffectionPromptHint(petData.affection)
    };
    promptBuild = buildPetPrompt({
      userText,
      memories: petData.memory,
      affection: affectionState,
      historyMessages,
      harness: harnessResult,
      limits: tokenBudget
    });
  } catch {
    try {
      promptBuild = buildPetPrompt({
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
    harness: harnessResult ? {
      personalityId: harnessPersonalityId,
      personalitySource: 'pet-profile',
      leadMode: harnessResult.policy.leadMode,
      responseDepth: harnessResult.policy.responseDepth,
      boundaryAction: harnessResult.policy.boundaryAction,
      playfulness: harnessResult.policy.playfulness,
      maxMainPoints: harnessResult.policy.maxMainPoints
    } : null,
    warnings: Array.from(new Set([...(promptBuild.stats.warnings || []), ...budgetWarnings]))
  };
  savePromptStats(promptBuild.stats);

  const messages = [
    { role: 'system', content: promptBuild.prompt },
    ...historyMessages,
    { role: 'user', content: userText.slice(0, 1000) }
  ];

  const response = await fetchWithTimeout(config.endpoint, {
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

  const normalizedReply = String(reply).trim().slice(0, 600);
  const { reply: finalReply, postCheck: finalPostCheck, rewritten: finalRewritten } = applyFinalPostCheck(
    normalizedReply,
    harnessResult
  );
  const emotionResult = petProfile.responseEmotion?.enabled
    ? await classifyResponseEmotion(config, userText, finalReply, (url, opts) => fetchWithTimeout(url, opts, 8000))
    : null;

  return {
    reply: finalReply,
    model: data.model || config.model,
    emotion: emotionResult?.emotion || null,
    emotionSource: emotionResult?.source || null,
    postCheck: finalPostCheck,
    postCheckRewritten: finalRewritten
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
  // 同步全屏状态到新架构的 FullscreenAdapter（供 ProactiveGraph 使用）
  try { newArch?.getFullscreenAdapter?.()?.setFullscreen?.(shouldHide); } catch { /* 忽略 */ }
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
  const validated = validateIpc('set-window-scale', scale);
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const next = Math.max(minScale, Math.min(maxScale, Number(validated) || 1));

  // 记录当前已扩展的空间，缩放后需要保持
  const currentBounds = mainWindow.getBounds();
  const planningExtra = planningSpaceOriginalBounds
    ? currentBounds.height - planningSpaceOriginalBounds.height
    : 0;
  const bubbleExtra = bubbleSpaceOriginalBounds
    ? currentBounds.width - bubbleSpaceOriginalBounds.width
    : 0;

  // 先恢复到未扩展的基础 bounds，避免缩放计算被扩展后的尺寸干扰
  if (planningSpaceOriginalBounds) {
    mainWindow.setBounds(planningSpaceOriginalBounds);
    planningSpaceOriginalBounds = null;
  }
  if (bubbleSpaceOriginalBounds) {
    mainWindow.setBounds(bubbleSpaceOriginalBounds);
    bubbleSpaceOriginalBounds = null;
  }

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
  const newBaseBounds = { x, y, width: nextWidth, height: nextHeight };
  mainWindow.setBounds(newBaseBounds);

  // 若缩放前存在计划/气泡扩展，按新的基础尺寸重新应用，防止聊天栏/计划栏错位或被遮挡
  if (planningExtra > 0) {
    planningSpaceOriginalBounds = { ...newBaseBounds };
    const newY = Math.max(workArea.y, newBaseBounds.y - planningExtra);
    const newHeight = newBaseBounds.height + (newBaseBounds.y - newY);
    mainWindow.setBounds({ ...newBaseBounds, y: newY, height: newHeight });
  }
  if (bubbleExtra > 0) {
    bubbleSpaceOriginalBounds = { ...newBaseBounds };
    const newX = Math.max(workArea.x, newBaseBounds.x - bubbleExtra);
    const newWidth = newBaseBounds.width + (newBaseBounds.x - newX);
    mainWindow.setBounds({ ...newBaseBounds, x: newX, width: newWidth });
  }
});

ipcMain.handle('window:focus', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  return mainWindow.isFocused();
});

// Renderer ACK：确认主动事件气泡已显示，解除 pending ACK 等待
ipcMain.handle('proactive-event:ack', (_event, occurrenceId) => {
  const validated = validateIpc('proactive-event:ack', occurrenceId);
  if (!validated || typeof validated !== 'string') return false;
  const entry = pendingAcks.get(validated);
  if (!entry) return false;
  clearTimeout(entry.timer);
  pendingAcks.delete(validated);
  entry.resolve(true);
  return true;
});

ipcMain.handle('api-config-get', () => readApiConfig());

ipcMain.handle('api-config-save', (_event, nextConfig) => {
  const validated = validateIpc('api-config-save', nextConfig);
  return saveApiConfig(validated);
});

ipcMain.handle('chat-send', async (_event, payload) => {
  const validated = validateIpc('chat-send', payload);
  // 新架构就绪时，ConversationGraph 单轮报错不得静默改走旧 sendChatMessage
  if (archState === 'langgraph_ready' && newArchReady) {
    try {
      const result = await sendChatMessageNewArch(validated);
      return { ...result, runtime: 'langgraph' };
    } catch (error) {
      console.error('[chat-send] langgraph error:', error?.message);
      // 返回结构化错误，不回退到旧链路
      return {
        reply: `LangGraph 处理失败：${error?.message || '未知错误'}`,
        model: 'new-arch-error',
        runtime: 'langgraph_error',
        error: error?.message || String(error)
      };
    }
  }
  // 新架构初始化失败时才回退到旧链路
  const legacyResult = await sendChatMessage(validated);
  return { ...legacyResult, runtime: 'legacy' };
});

// Onboarding 偏好提交：保存用户偏好，调用 OnboardingGraph 恢复流程
ipcMain.handle('onboarding-submit', async (_event, preferences) => {
  const validated = validateIpc('onboarding-submit', preferences);
  if (!newArchReady || !newArch) {
    return { ok: false, reason: 'new-arch-not-ready' };
  }
  try {
    // 同时保存到旧 pet-data（兼容旧 UI）
    if (validated?.nickname) {
      const petData = loadPetData(app);
      if (!petData.profile) petData.profile = {};
      petData.profile.userName = String(validated.nickname);
      petData.profile.preferredName = String(validated.preferredName || validated.nickname);
      updatePetData(app, petData);
    }
    // 调用 OnboardingGraph.resumeWithPreferences 完成剩余流程
    const completed = await newArch.resumeOnboardingWithPreferences?.(validated || {});
    return { ok: true, completed: !!completed };
  } catch (error) {
    console.error('[onboarding-submit] failed:', error?.message || error);
    return { ok: false, reason: String(error?.message || 'unknown') };
  }
});

// V1 不包含命令执行（架构计划明确禁止）。
// Safe Shell IPC 保留接口但始终返回禁用状态，避免渲染进程调用时崩溃。
ipcMain.handle('safe-shell:interpret', () => ({
  reply: '命令执行功能在 V1 中不可用。',
  action: null,
  ok: false
}));

ipcMain.handle('safe-shell:confirm', () => ({ ok: false, reply: '命令执行功能在 V1 中不可用。' }));

ipcMain.handle('safe-shell:cancel', () => ({ ok: true }));

ipcMain.handle('safe-shell:get-settings', () => ({
  enabled: false,
  whitelist: [],
  confirmationRequired: true,
  available: false
}));

ipcMain.handle('safe-shell:set-enabled', () => ({
  ok: false,
  reply: 'V1 不支持启用命令执行。'
}));

// ===== 架构状态 IPC =====
// 供 Renderer 查询当前运行时状态，确认 LangGraph 新架构是否真正运行
ipcMain.handle('architecture:get-status', () => {
  if (!newArch) {
    return {
      runtime: 'legacy',
      state: archState,
      initialized: false,
      databaseReady: false,
      databasePathExists: false,
      databasePath: null,
      activeCharacterId: '',
      schedulerRunning: false,
      reflectionWorkerRunning: false,
      registeredSkills: [],
      lastInitializationError: archInitError
    };
  }
  const status = newArch.getArchitectureStatus?.(archInitError) ?? {
    runtime: 'legacy',
    initialized: false,
    databaseReady: false,
    databasePathExists: false,
    databasePath: null,
    activeCharacterId: '',
    schedulerRunning: false,
    reflectionWorkerRunning: false,
    registeredSkills: [],
    lastInitializationError: archInitError
  };
  return { ...status, state: archState };
});

// 立即生成今日摘要：通过 publishStartupEvent 走正式 GraphDispatcher 链路
ipcMain.handle('architecture:trigger-digest', () => {
  if (!newArchReady || !newArch) return { ok: false, reason: 'not-ready' };
  try {
    newArch.publishStartupEvent?.();
    return { ok: true };
  } catch (e) {
    console.error('[trigger-digest]', e?.message);
    return { ok: false, reason: e?.message || 'failed' };
  }
});

ipcMain.handle('reminder:list', () => {
  if (!newArchReady || !newArch) return [];
  try {
    return newArch.getActiveReminders?.() ?? [];
  } catch (e) {
    console.error('[reminder:list]', e?.message);
    return [];
  }
});

ipcMain.handle('reminder:delete', (_event, id) => {
  validateIpc('reminder:delete', id);
  if (!newArchReady || !newArch) return { deleted: false };
  try {
    return newArch.deleteReminder?.(id) ?? { deleted: false };
  } catch (e) {
    console.error('[reminder:delete]', e?.message);
    return { deleted: false };
  }
});

ipcMain.handle('pet-data:get', () => loadPetData(app));

ipcMain.handle('pet-data:update', (_event, nextData) => updatePetData(app, () => nextData));

ipcMain.handle('memory:list', (_event, type) => {
  const validated = validateIpc('memory:list', type);
  const memType = String(validated || '');
  if (newArchReady && newArch?.getMemories) {
    try { return newArch.getMemories(memType); } catch (e) { console.error('[memory:list]', e?.message); }
  }
  return memoryService.listMemories(app, memType);
});

ipcMain.handle('memory:add', (_event, ...args) => {
  const validated = validateIpc('memory:add', args);
  const memType = String(validated[0] || '');
  const content = String(validated[1] || '');
  const options = asPlainObject(validated[2]);
  if (newArchReady && newArch?.addMemory) {
    try { return newArch.addMemory(memType, content, options); } catch (e) { console.error('[memory:add]', e?.message); throw e; }
  }
  return memoryService.addMemory(app, memType, content, options);
});

ipcMain.handle('memory:update', (_event, type, id, patch) => {
  const validated = validateIpc('memory:update', [type, id, patch]);
  const memType = String(validated[0] || '');
  const memId = String(validated[1] || '');
  const memPatch = asPlainObject(validated[2]);
  if (newArchReady && newArch?.updateMemory) {
    try { return newArch.updateMemory(memType, memId, memPatch); } catch (e) { console.error('[memory:update]', e?.message); throw e; }
  }
  return memoryService.updateMemory(app, memType, memId, memPatch);
});

ipcMain.handle('memory:delete', (_event, type, id) => {
  const validated = validateIpc('memory:delete', [type, id]);
  const memType = String(validated[0] || '');
  const memId = String(validated[1] || '');
  if (newArchReady && newArch?.deleteMemory) {
    try { return newArch.deleteMemory(memType, memId); } catch (e) { console.error('[memory:delete]', e?.message); throw e; }
  }
  return memoryService.deleteMemory(app, memType, memId);
});

ipcMain.handle('memory:clear-expired-short-term', () => {
  // 新架构中短期记忆不持久化，无需清理
  if (newArchReady) return { removed: 0 };
  return memoryService.clearExpiredShortTermMemories(app);
});

ipcMain.handle('memory:clear-type', (_event, type) => {
  const validated = validateIpc('memory:clear-type', type);
  const memType = String(validated || '');
  if (newArchReady && newArch?.clearMemoriesByType) {
    try { return newArch.clearMemoriesByType(memType); } catch (e) { console.error('[memory:clear-type]', e?.message); throw e; }
  }
  return memoryService.clearMemories(app, memType);
});

ipcMain.handle('memory:clear-all', () => {
  if (newArchReady && newArch?.clearAllMemoriesNewArch) {
    try { return newArch.clearAllMemoriesNewArch(); } catch (e) { console.error('[memory:clear-all]', e?.message); throw e; }
  }
  return memoryService.clearAllMemories(app);
});

// 记忆导出：弹出保存对话框，写入不含密钥的 JSON
ipcMain.handle('memory:export', async () => {
  validateIpc('memory:export', null); // 校验通过则继续，失败则抛异常
  if (!newArchReady || !newArch?.exportUserData) {
    throw new Error('Export not available: architecture not initialized');
  }
  try {
    const exportData = newArch.exportUserData();
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '导出记忆数据',
      defaultPath: `pet-memories-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (result.canceled || !result.filePath) {
      return { success: false, reason: 'cancelled' };
    }
    fs.writeFileSync(result.filePath, JSON.stringify(exportData, null, 2), 'utf-8');
    console.log('[memory:export] exported to', result.filePath);
    return { success: true, path: result.filePath };
  } catch (e) {
    console.error('[memory:export]', e?.message);
    return { success: false, error: e?.message || String(e) };
  }
});

ipcMain.handle('memory:detect-explicit-intent', (_event, textValue) => (
  memoryService.detectExplicitMemoryIntent(String(textValue || ''))
));

ipcMain.handle('memory:analyze-and-apply', (_event, textValue) => {
  // 新架构就绪时，记忆由 ConversationGraph 和 Reflection 统一处理（SQLite），
  // 不再调用旧版记忆分析（写入 pet-data.json），避免双系统数据分裂。
  if (newArchReady) {
    return { skipped: true, reason: 'new-arch-active' };
  }
  return analyzeAndApplyMemory(String(textValue || ''));
});

ipcMain.handle('affection:get', () => affectionService.getAffectionState(app));

ipcMain.handle('affection:set-score', (_event, score, reason) => {
  const validated = validateIpc('affection:set-score', [score, reason]);
  return affectionService.setAffectionScore(app, Number(validated[0]), String(validated[1] || 'Manual score update.'));
});

ipcMain.handle('affection:adjust', (_event, delta, eventType, reason, options) => {
  const validated = validateIpc('affection:adjust', [delta, eventType, reason, options]);
  return affectionService.adjustAffection(
    app,
    Number(validated[0]),
    String(validated[1] || ''),
    String(validated[2] || ''),
    asPlainObject(validated[3])
  );
});

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

// 气泡空间扩展：reminder bubble 显示时向左扩大窗口宽度，消失后恢复
let bubbleSpaceOriginalBounds = null;

ipcMain.on('request-bubble-space', (_event, extraWidth) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  // 第一次请求时保存原始 bounds，后续请求不覆盖
  if (!bubbleSpaceOriginalBounds) {
    bubbleSpaceOriginalBounds = { ...mainWindow.getBounds() };
  }
  const workArea = screen.getDisplayMatching(bubbleSpaceOriginalBounds).workArea;
  const safetyMargin = 16;
  const totalExtra = Math.round(Number(extraWidth) || 0) + safetyMargin;
  // 向左扩展窗口（reminder bubble 在桌宠左侧）
  let newX = bubbleSpaceOriginalBounds.x - totalExtra;
  let newWidth = bubbleSpaceOriginalBounds.width + totalExtra;
  // 不能超出屏幕左边界
  if (newX < workArea.x) {
    newWidth -= (workArea.x - newX);
    newX = workArea.x;
  }
  mainWindow.setBounds({
    x: newX,
    y: bubbleSpaceOriginalBounds.y,
    width: newWidth,
    height: bubbleSpaceOriginalBounds.height
  });
});

ipcMain.on('release-bubble-space', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (bubbleSpaceOriginalBounds) {
    mainWindow.setBounds(bubbleSpaceOriginalBounds);
    bubbleSpaceOriginalBounds = null;
  }
});

// 计划面板空间扩展：进入计划模式时向上扩大窗口高度，退出后恢复
let planningSpaceOriginalBounds = null;

ipcMain.on('request-planning-space', (_event, extraHeight) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (!planningSpaceOriginalBounds) {
    planningSpaceOriginalBounds = { ...mainWindow.getBounds() };
  }
  const workArea = screen.getDisplayMatching(planningSpaceOriginalBounds).workArea;
  const safetyMargin = 24;
  const totalExtra = Math.round(Number(extraHeight) || 0) + safetyMargin;
  let newY = planningSpaceOriginalBounds.y - totalExtra;
  let newHeight = planningSpaceOriginalBounds.height + totalExtra;
  if (newY < workArea.y) {
    newHeight -= (workArea.y - newY);
    newY = workArea.y;
  }
  mainWindow.setBounds({
    x: planningSpaceOriginalBounds.x,
    y: newY,
    width: planningSpaceOriginalBounds.width,
    height: newHeight
  });
});

ipcMain.on('release-planning-space', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (planningSpaceOriginalBounds) {
    mainWindow.setBounds(planningSpaceOriginalBounds);
    planningSpaceOriginalBounds = null;
  }
});

// ===== 计划任务（Planning Bubble）=====
// 已重构为独立 PlanningGraph：所有规划请求统一经过 ModelGateway（planningModel 别名），
// 不得直接 fetch。Zod 校验的 Planning Tools 保证写操作安全。
// 详见 src/agent/graphs/planning/。

function planningArchReady() {
  return newArchReady && newArch && typeof newArch.handlePlanningMessage === 'function';
}

ipcMain.handle('planning:start', async () => {
  if (!planningArchReady()) {
    return { ok: false, reason: 'architecture-not-ready' };
  }
  const activePlan = newArch.getActivePlan();
  if (activePlan) {
    return { ok: true, activePlan };
  }
  // 修复 5：返回持久化的 messages、phase、awaitingConfirmation
  // renderer 恢复真实计划对话，不显示一条虚假的通用提示代替历史
  const planningState = newArch.getPlanningState();
  if (planningState.draftPlan) {
    return {
      ok: true,
      draftPlan: planningState.draftPlan,
      messages: planningState.messages,
      phase: planningState.phase,
      awaitingConfirmation: planningState.awaitingConfirmation
    };
  }
  return { ok: true, messages: planningState.messages, phase: planningState.phase };
});

ipcMain.handle('planning:submit-message', async (_event, text) => {
  if (!planningArchReady()) {
    return { ok: false, reason: 'architecture-not-ready' };
  }
  const userInput = String(text || '').trim();
  if (!userInput) {
    return { ok: false, reason: 'empty-message' };
  }
  try {
    const dto = await newArch.handlePlanningMessage(userInput, false);
    return dto;
  } catch (error) {
    return { ok: false, reason: error?.message || 'unknown-error' };
  }
});

ipcMain.handle('planning:confirm', async () => {
  if (!planningArchReady()) {
    return { ok: false, reason: 'architecture-not-ready' };
  }
  try {
    const dto = await newArch.handlePlanningConfirm();
    return dto;
  } catch (error) {
    return { ok: false, reason: error?.message || 'unknown-error' };
  }
});

/**
 * 手动修改草案（时间调整、删除任务、移动任务等）。
 * 要求 12：输入框反馈、确认按钮、手动改时间都进入同一个 PlanningGraph。
 * 重构：renderer 发送明确的 patch_task/delete_task/move_task 事件，
 * 不再把完整任务数组交给模型解释。UI 手动操作经过 PlanningGraph Tool 节点，但不调用模型。
 * isManualEdit 必须实际传入并使用。
 */
ipcMain.handle('planning:update-draft', async (_event, payload) => {
  if (!planningArchReady()) {
    return { ok: false, reason: 'architecture-not-ready' };
  }
  try {
    const dto = await newArch.handlePlanningManualEdit(payload);
    return dto;
  } catch (error) {
    return { ok: false, reason: error?.message || 'manual-edit-failed' };
  }
});

ipcMain.handle('planning:toggle-task', async (_event, taskId) => {
  if (!planningArchReady()) {
    return { ok: false, reason: 'architecture-not-ready' };
  }
  return newArch.handlePlanningToggleTask(String(taskId || ''));
});

ipcMain.handle('planning:get-active', async () => {
  if (!planningArchReady()) {
    return { ok: false, reason: 'architecture-not-ready' };
  }
  const activePlan = newArch.getActivePlan();
  return { ok: true, plan: activePlan };
});

/**
 * 获取 planningModel 解析信息（供状态面板显示）。
 * 要求 3：状态面板必须显示 planningModel 实际解析值和 response.model。
 */
ipcMain.handle('planning:get-model-info', async () => {
  if (!planningArchReady()) {
    return { ok: false, reason: 'architecture-not-ready' };
  }
  return { ok: true, info: newArch.getPlanningModelInfo() };
});

/**
 * 设置 planningModel 配置值（持久化到 app_settings.model_alias_planning）。
 * 配置更新后实际 ModelGateway 会立即使用新值。
 */
ipcMain.handle('planning:set-model', async (_event, modelId) => {
  if (!planningArchReady()) {
    return { ok: false, reason: 'architecture-not-ready' };
  }
  return newArch.setPlanningModel(String(modelId || ''));
});

/**
 * 获取最近一轮 Planning Trace（供状态面板诊断显示）。
 * 不包含 API Key 和敏感内容。
 */
ipcMain.handle('planning:get-trace', async () => {
  if (!planningArchReady()) {
    return { ok: false, reason: 'architecture-not-ready' };
  }
  return { ok: true, trace: newArch.getPlanningTrace() };
});

/** 启动时恢复 active plan 到桌面气泡 */
function restoreActivePlanOnStartup() {
  if (!planningArchReady() || !mainWindow) return;
  const activePlan = newArch.getActivePlan();
  if (activePlan) {
    send('planning:plan-published', activePlan);
  }
}

app.whenReady().then(() => {
  loadPetData(app);
  // 先初始化新架构，再创建窗口，确保 did-finish-load 时 newArchReady 已就绪
  tryInitNewArchitecture();

  // 注册 pet-character:// 协议处理器
  // 将 pet-character://<characterId>/<relative-path> 解析为角色包目录内的文件
  // 限制访问在当前激活角色包目录内，防止路径穿越
  registerCharacterProtocol();

  createWindow();
});

app.on('before-quit', () => {
  isQuitting = true;
  stopFullscreenWatcher();
  safeShellService?.shutdown();
  if (newArch) {
    try { newArch.shutdownNewArchitecture(); } catch { /* 忽略关闭错误 */ }
  }
});

app.on('window-all-closed', () => {
  isQuitting = true;
  stopFullscreenWatcher();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
