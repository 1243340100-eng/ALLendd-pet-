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
const profileSummaryIntervalMs = 3 * 24 * 60 * 60 * 1000;

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

function buildMemoryConfirmation(applied = []) {
  if (applied.length > 1) {
    return '\u6211\u660e\u767d\u4e86\uff0c\u8fd9\u51e0\u4ef6\u4e8b\u6211\u4f1a\u5206\u5f00\u8bb0\u597d\uff0c\u4e0d\u628a\u5b83\u4eec\u6df7\u5728\u4e00\u8d77\u3002';
  }

  const first = applied[0] || {};
  const entry = first.entry || {};
  const reminder = entry.reminder && typeof entry.reminder === 'object' ? entry.reminder : null;

  if (first.action === 'update') {
    return '\u6211\u61c2\u4e86\uff0c\u4e4b\u524d\u90a3\u6761\u6211\u5df2\u7ecf\u66ff\u4f60\u6539\u597d\u4e86\u3002';
  }
  if (first.type === 'longTerm' && reminder?.enabled) {
    return '\u55ef\uff0c\u8fd9\u6761\u63d0\u9192\u6211\u8bb0\u4e0b\u4e86\uff0c\u4e4b\u540e\u4f1a\u6309\u5b83\u6765\u63d0\u9192\u4f60\u3002';
  }
  if (first.type === 'longTerm') {
    return '\u55ef\uff0c\u8fd9\u4ef6\u4e8b\u6211\u8bb0\u4e0b\u6765\u4e86\uff0c\u4ee5\u540e\u804a\u5230\u65f6\u6211\u4f1a\u63a5\u4e0a\u524d\u6587\u3002';
  }
  return '\u597d\u7684\uff0c\u6211\u8bb0\u4f4f\u4e86\u3002\u8fd9\u4f1a\u5e2e\u6211\u4ee5\u540e\u66f4\u597d\u5730\u7406\u89e3\u4f60\u3002';
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
  const response = await fetch(config.endpoint, {
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
  const response = await fetch(config.endpoint, {
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
  const response = await fetch(config.endpoint, {
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
  const response = await fetch(config.endpoint, {
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
  const response = await fetch(config.endpoint, {
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
      message: buildMemoryConfirmation(appliedMemories),
      reason: normalizedDecisions.map((item) => item.reason).filter(Boolean).join('; ')
    };
  } catch (error) {
    console.warn('AI memory analysis failed.', error?.message || error);
    return shouldAnalyzeLongTerm
      ? getMemoryAnalysisUnavailableResult('memory_ai_failed')
      : getMemoryAnalysisSkippedResult('short_term_ai_failed');
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

ipcMain.handle('memory:analyze-and-apply', (_event, textValue) => (
  analyzeAndApplyMemory(String(textValue || ''))
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
