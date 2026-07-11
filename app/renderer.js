const stage = document.getElementById('stage');
const pet = document.getElementById('pet');
const bubble = document.getElementById('bubble');
const reminderBubble = document.getElementById('reminderBubble');
const reminderStack = document.getElementById('reminderStack');
let reminderBubbleTimer = null;
let activeBubbleCount = 0;
const frameworkNotice = document.getElementById('frameworkNotice');
const apiSettings = document.getElementById('apiSettings');
const apiPanel = document.getElementById('apiPanel');
const apiClose = document.getElementById('apiClose');
const apiEndpoint = document.getElementById('apiEndpoint');
const apiModel = document.getElementById('apiModel');
const apiKey = document.getElementById('apiKey');
const drinkReminderText = document.getElementById('drinkReminderText');
const nightReminderText = document.getElementById('nightReminderText');
const apiStatus = document.getElementById('apiStatus');
const apiClearKey = document.getElementById('apiClearKey');
const apiSave = document.getElementById('apiSave');
const chatToggle = document.getElementById('chatToggle');
const chatPanel = document.getElementById('chatPanel');
const chatClose = document.getElementById('chatClose');
const chatLog = document.getElementById('chatLog');
const chatForm = document.getElementById('chatForm');
const chatInput = document.getElementById('chatInput');
const chatSend = document.getElementById('chatSend');
const stateToggle = document.getElementById('stateToggle');
const languageToggle = document.getElementById('languageToggle');
const statePanel = document.getElementById('statePanel');
const stateClose = document.getElementById('stateClose');
const stateStatus = document.getElementById('stateStatus');
const affectionView = document.getElementById('affectionView');
const promptStatsView = document.getElementById('promptStatsView');
const userMemoryList = document.getElementById('userMemoryList');
const longTermMemoryList = document.getElementById('longTermMemoryList');
const shortTermMemoryList = document.getElementById('shortTermMemoryList');
const shortTermMemoryNote = document.getElementById('shortTermMemoryNote');
const clearExpiredShortTerm = document.getElementById('clearExpiredShortTerm');
const clearUserMemory = document.getElementById('clearUserMemory');
const clearLongTermMemory = document.getElementById('clearLongTermMemory');
const clearShortTermMemory = document.getElementById('clearShortTermMemory');
const clearAllMemory = document.getElementById('clearAllMemory');
const exportMemory = document.getElementById('exportMemory');
// 架构状态与提醒区域
const archStatusView = document.getElementById('archStatusView');
const reminderList = document.getElementById('reminderList');
const refreshReminders = document.getElementById('refreshReminders');
const triggerDailyDigestBtn = document.getElementById('triggerDailyDigest');
const triggerReminderCheckBtn = document.getElementById('triggerReminderCheck');
// Onboarding 首次配置面板
const onboardingPanel = document.getElementById('onboardingPanel');
const onboardingMessage = document.getElementById('onboardingMessage');
const onboardingForm = document.getElementById('onboardingForm');
const obNickname = document.getElementById('obNickname');
const obPreferredName = document.getElementById('obPreferredName');
const obReplyLength = document.getElementById('obReplyLength');
const obProactiveLevel = document.getElementById('obProactiveLevel');
const obWeatherCity = document.getElementById('obWeatherCity');
const obDndEnabled = document.getElementById('obDndEnabled');
const obNotificationEnabled = document.getElementById('obNotificationEnabled');
const obSoundEnabled = document.getElementById('obSoundEnabled');
const obMemoryEnabled = document.getElementById('obMemoryEnabled');
const petProfile = window.petProfile || {
  displayName: 'Pet Framework',
  characterName: 'Pet',
  spriteSheet: '',
  usePlaceholderPet: true,
  spriteCell: { width: 192, height: 208 },
  spriteSheetSize: { width: 1536, height: 1872 },
  animationRows: {},
  responseEmotion: { enabled: false, durationMs: 6500, fallbackState: 'waving' },
  defaultLanguage: 'zh',
  defaultDrinkReminderText: '\u8be5\u559d\u6c34\u5566\uff0c\u7167\u987e\u597d\u81ea\u5df1\u54e6\u3002',
  defaultNightReminderText: '\u5f88\u665a\u5566\uff0c\u65e9\u70b9\u4f11\u606f\uff0c\u665a\u5b89\u3002',
  userPetName: 'Pet',
  localStorageNamespace: 'pet'
};

const i18n = {
  zh: {
    api: '\u63a5\u53e3',
    apiSettings: 'API \u8bbe\u7f6e',
    chat: '\u804a\u5929',
    state: '\u72b6\u6001',
    frameworkNotice: '\u684c\u5ba0\u6846\u67b6\u6d4b\u8bd5\u7248\n\u8bf7\u66ff\u6362\u52a8\u753b\u8d44\u4ea7\u548c\u89d2\u8272\u914d\u7f6e',
    languageToggle: '\u4e2d / EN',
    endpoint: '\u63a5\u53e3\u5730\u5740',
    model: '\u6a21\u578b',
    drinkReminderLabel: '\u559d\u6c34\u63d0\u9192\u8bcd',
    nightReminderLabel: '\u665a\u5b89\u63d0\u9192\u8bcd',
    drinkReminderDefault: petProfile.defaultDrinkReminderText || '\u8be5\u559d\u6c34\u5566\uff0c\u7167\u987e\u597d\u81ea\u5df1\u54e6\u3002',
    nightReminderDefault: petProfile.defaultNightReminderText || '\u5f88\u665a\u5566\uff0c\u65e9\u70b9\u4f11\u606f\uff0c\u665a\u5b89\u3002',
    drinkReminderPlaceholder: '\u7559\u7a7a\u5219\u4f7f\u7528\u9ed8\u8ba4\u559d\u6c34\u63d0\u9192\u8bcd',
    nightReminderPlaceholder: '\u7559\u7a7a\u5219\u4f7f\u7528\u9ed8\u8ba4\u665a\u5b89\u63d0\u9192\u8bcd',
    save: '\u4fdd\u5b58',
    cancel: '\u53d6\u6d88',
    clear: '\u6e05\u7a7a',
    clearExpired: '\u6e05\u7406\u8fc7\u671f',
    clearAllMemories: '\u6e05\u7a7a\u5168\u90e8\u8bb0\u5fc6',
    exportMemory: '导出个人数据',
    exportSuccess: '已导出到 {path}',
    exportFailed: '导出失败',
    exportCancelled: '已取消导出',
    archRuntime: '运行时',
    archLanggraph: 'LangGraph 新架构',
    archLegacy: '旧架构（降级）',
    archInitialized: '已初始化',
    archDatabase: 'SQLite 数据库',
    archConnected: '已连接',
    archScheduler: '调度器',
    archReflection: '反思 Worker',
    archCharacter: '当前角色',
    archSkills: '已注册技能',
    archNone: '无',
    archError: '错误',
    archStatusUnknown: '查询中...',
    noReminders: '暂无提醒',
    reminderDelete: '删除',
    reminderRefresh: '刷新',
    digestTriggered: '已触发今日摘要生成',
    digestFailed: '触发失败，请检查架构状态',
    reminderChecked: '已刷新提醒列表',
    triggerDigestLabel: '生成今日摘要',
    triggerReminderCheckLabel: '检查到期提醒',
    chatPlaceholder: '\u8f93\u5165\u4f60\u60f3\u5bf9 {name} \u8bf4\u7684\u8bdd',
    send: '\u53d1\u9001',
    loading: '\u52a0\u8f7d\u4e2d...',
    ready: '\u5df2\u5c31\u7eea',
    affection: '\u597d\u611f\u5ea6',
    relationship: '\u5173\u7cfb\u72b6\u6001',
    promptStats: 'Prompt \u7edf\u8ba1',
    systemPromptChars: 'System Prompt \u5b57\u7b26\u6570',
    injectedMemories: '\u6ce8\u5165\u8bb0\u5fc6\u6570',
    historyMessages: '\u5386\u53f2\u6d88\u606f\u6570',
    userInputChars: '\u7528\u6237\u8f93\u5165\u5b57\u7b26\u6570',
    warnings: '\u8b66\u544a',
    none: '\u65e0',
    userMemory: '\u7528\u6237\u8bb0\u5fc6',
    longTermMemory: '\u957f\u671f\u8bb0\u5fc6',
    shortTermMemory: '\u77ed\u671f\u8bb0\u5fc6',
    shortTermNote: '\u77ed\u671f\u8bb0\u5fc6\u7528\u4e8e\u4e34\u65f6\u4e0a\u4e0b\u6587\uff0c\u666e\u901a\u804a\u5929\u4e0d\u4f1a\u81ea\u52a8\u4fdd\u5b58\u5230\u8fd9\u91cc\u3002',
    noMemories: '\u6682\u65e0\u8bb0\u5fc6',
    empty: '(\u7a7a)',
    edit: '\u7f16\u8f91',
    delete: '\u5220\u9664',
    savedApiKey: '\u5df2\u4fdd\u5b58 API Key',
    apiKeySaved: 'API Key \u5df2\u4fdd\u5b58',
    noApiKey: '\u672a\u914d\u7f6e API Key',
    saving: '\u4fdd\u5b58\u4e2d...',
    apiSavedWithKey: '\u5df2\u4fdd\u5b58\uff0cAPI Key \u5df2\u914d\u7f6e\u3002',
    apiSavedEmpty: '\u5df2\u4fdd\u5b58\uff0cAPI Key \u4e3a\u7a7a\u3002',
    apiSaveBubble: 'API \u914d\u7f6e\u5df2\u4fdd\u5b58',
    apiSaveEmptyBubble: 'API \u914d\u7f6e\u5df2\u4fdd\u5b58\uff0c\u8bf7\u7a0d\u540e\u586b\u5199 Key',
    saveFailed: '\u4fdd\u5b58\u5931\u8d25',
    apiSaveFailedBubble: 'API \u914d\u7f6e\u4fdd\u5b58\u5931\u8d25',
    editMemoryPrompt: '\u7f16\u8f91\u8bb0\u5fc6\u5185\u5bb9\uff1a',
    memoryCannotBeEmptyStatus: '\u8bb0\u5fc6\u5185\u5bb9\u4e0d\u80fd\u4e3a\u7a7a\u3002',
    memoryCannotBeEmptyBubble: '\u8bb0\u5fc6\u5185\u5bb9\u4e0d\u80fd\u4e3a\u7a7a',
    memoryTooLong: '\u8bb0\u5fc6\u5185\u5bb9\u4e0d\u80fd\u8d85\u8fc7 300 \u5b57\u3002',
    memoryUpdated: '\u8bb0\u5fc6\u5df2\u66f4\u65b0\u3002',
    updateMemoryFailed: '\u66f4\u65b0\u8bb0\u5fc6\u5931\u8d25\u3002',
    deleteMemoryConfirm: '\u786e\u5b9a\u5220\u9664\u8fd9\u6761\u8bb0\u5fc6\u5417\uff1f',
    memoryDeleted: '\u8bb0\u5fc6\u5df2\u5220\u9664\u3002',
    deleteMemoryFailed: '\u5220\u9664\u8bb0\u5fc6\u5931\u8d25\u3002',
    clearTypeConfirm: '\u786e\u5b9a\u6e05\u7a7a\u3010{label}\u3011\u5417\uff1f\u6b64\u64cd\u4f5c\u4e0d\u53ef\u6062\u590d\u3002',
    memoryTypeCleared: '{label}\u5df2\u6e05\u7a7a\uff1a{count} \u6761',
    clearMemoriesFailed: '\u6e05\u7a7a\u8bb0\u5fc6\u5931\u8d25\u3002',
    clearAllConfirmFirst: '\u786e\u5b9a\u6e05\u7a7a\u5168\u90e8\u8bb0\u5fc6\u5417\uff1f\u5305\u62ec\u7528\u6237\u8bb0\u5fc6\u3001\u957f\u671f\u8bb0\u5fc6\u548c\u77ed\u671f\u8bb0\u5fc6\u3002',
    clearAllConfirmSecond: '\u8bf7\u518d\u6b21\u786e\u8ba4\uff1a\u5168\u90e8\u8bb0\u5fc6\u5c06\u88ab\u6c38\u4e45\u5220\u9664\uff0c\u662f\u5426\u7ee7\u7eed\uff1f',
    allMemoryCleared: '\u5168\u90e8\u8bb0\u5fc6\u5df2\u6e05\u7a7a\uff1a{count} \u6761',
    clearAllFailed: '\u6e05\u7a7a\u5168\u90e8\u8bb0\u5fc6\u5931\u8d25\u3002',
    stateLoadFailed: '\u72b6\u6001\u52a0\u8f7d\u5931\u8d25\u3002',
    shortTermExpiredCleared: '\u5df2\u6e05\u7406\u8fc7\u671f\u77ed\u671f\u8bb0\u5fc6\uff1a{count} \u6761',
    clearExpiredFailed: '\u6e05\u7406\u8fc7\u671f\u77ed\u671f\u8bb0\u5fc6\u5931\u8d25\u3002',
    clearFailedBubble: '\u6e05\u7406\u5931\u8d25',
    memoryAiUnavailable: '\u5f53\u524d\u65e0\u6cd5\u4f7f\u7528 AI \u5224\u65ad\u5e76\u4fdd\u5b58\u8bb0\u5fc6\uff0c\u8bf7\u68c0\u67e5 API \u8bbe\u7f6e\u540e\u518d\u8bd5\u3002',
    safeShellCancel: '\u53d6\u6d88',
    safeShellFailed: '\u5b89\u5168 Shell \u64cd\u4f5c\u5931\u8d25\u3002',
    endpointDomainChanged: '\u63a5\u53e3\u5730\u5740\u57df\u540d\u5df2\u4ece {oldDomain} \u53d8\u4e3a {newDomain}\u3002API Key \u548c\u804a\u5929\u6570\u636e\u5c06\u53d1\u9001\u5230\u8be5\u57df\u540d\u3002\u786e\u8ba4\u7ee7\u7eed\uff1f',
    encryptionUnavailable: '\u5f53\u524d\u7cfb\u7edf\u52a0\u5bc6\u4e0d\u53ef\u7528\uff0cAPI Key \u4ec5\u5728\u672c\u6b21\u8fd0\u884c\u4e2d\u4fdd\u5b58\uff0c\u91cd\u542f\u540e\u9700\u91cd\u65b0\u8f93\u5165\u3002',
    thinking: '\u6211\u60f3\u4e00\u4e0b...',
    emptyReply: '\u6211\u8fd8\u6ca1\u60f3\u597d\u600e\u4e48\u56de\u7b54\u5462\u3002',
    apiFailed: '\u8fde\u63a5 API \u5931\u8d25\u4e86\uff0c\u8bf7\u68c0\u67e5 Key \u6216\u7f51\u7edc\u3002',
    reminderMinutesSet: '\u5df2\u6539\u4e3a {minutes} \u5206\u949f\u63d0\u9192\u4e00\u6b21',
    startupBubble: '\u684c\u5ba0\u6846\u67b6\u6d4b\u8bd5\u7248\u5df2\u542f\u52a8',
    ariaStage: 'Pet Framework \u684c\u5ba0',
    ariaApiPanel: 'API \u8bbe\u7f6e',
    ariaChatPanel: 'Pet Framework \u804a\u5929',
    ariaStatePanel: 'Pet Framework \u72b6\u6001\u4e0e\u8bb0\u5fc6'
  },
  en: {
    api: 'API',
    apiSettings: 'API Settings',
    chat: 'Chat',
    state: 'State',
    frameworkNotice: 'Pet Framework Test Mode\nReplace animation assets and character config to create a new pet.',
    languageToggle: '\u4e2d / EN',
    endpoint: 'Endpoint',
    model: 'Model',
    drinkReminderLabel: 'Drink reminder',
    nightReminderLabel: 'Good night reminder',
    drinkReminderDefault: 'Time to drink some water. Take care of yourself.',
    nightReminderDefault: "It's late. Get some rest. Good night.",
    drinkReminderPlaceholder: 'Leave empty to use the default drink reminder',
    nightReminderPlaceholder: 'Leave empty to use the default good night reminder',
    save: 'Save',
    cancel: 'Cancel',
    clear: 'Clear',
    clearExpired: 'Clear expired',
    clearAllMemories: 'Clear all memories',
    exportMemory: 'Export data',
    exportSuccess: 'Exported to {path}',
    exportFailed: 'Export failed',
    exportCancelled: 'Export cancelled',
    archRuntime: 'Runtime',
    archLanggraph: 'LangGraph',
    archLegacy: 'Legacy (degraded)',
    archInitialized: 'Initialized',
    archDatabase: 'SQLite DB',
    archConnected: 'Connected',
    archScheduler: 'Scheduler',
    archReflection: 'Reflection',
    archCharacter: 'Character',
    archSkills: 'Skills',
    archNone: 'None',
    archError: 'Error',
    archStatusUnknown: 'Querying...',
    noReminders: 'No reminders',
    reminderDelete: 'Delete',
    reminderRefresh: 'Refresh',
    digestTriggered: 'Digest triggered',
    digestFailed: 'Trigger failed, check architecture status',
    reminderChecked: 'Reminders refreshed',
    triggerDigestLabel: 'Generate digest',
    triggerReminderCheckLabel: 'Check reminders',
    chatPlaceholder: 'Say something to {name}',
    send: 'Send',
    loading: 'Loading...',
    ready: 'Ready',
    affection: 'Affection',
    relationship: 'Relationship',
    promptStats: 'Prompt Stats',
    systemPromptChars: 'System Prompt chars',
    injectedMemories: 'Injected memories',
    historyMessages: 'History messages',
    userInputChars: 'User input chars',
    warnings: 'Warnings',
    none: 'None',
    userMemory: 'User Memory',
    longTermMemory: 'Long-term Memory',
    shortTermMemory: 'Short-term Memory',
    shortTermNote: 'Short-term memory is for temporary context. Normal chats are not saved here automatically.',
    noMemories: 'No memories',
    empty: '(empty)',
    edit: 'Edit',
    delete: 'Delete',
    savedApiKey: 'Saved API Key',
    apiKeySaved: 'API Key saved',
    noApiKey: 'No API Key configured',
    saving: 'Saving...',
    apiSavedWithKey: 'Saved. API Key is configured.',
    apiSavedEmpty: 'Saved. API Key is empty.',
    apiSaveBubble: 'API settings saved',
    apiSaveEmptyBubble: 'API settings saved. Add a Key later.',
    saveFailed: 'Save failed',
    apiSaveFailedBubble: 'Failed to save API settings',
    editMemoryPrompt: 'Edit memory content:',
    memoryCannotBeEmptyStatus: 'Memory content cannot be empty.',
    memoryCannotBeEmptyBubble: 'Memory cannot be empty',
    memoryTooLong: 'Memory content cannot exceed 300 characters.',
    memoryUpdated: 'Memory updated.',
    updateMemoryFailed: 'Failed to update memory.',
    deleteMemoryConfirm: 'Delete this memory?',
    memoryDeleted: 'Memory deleted.',
    deleteMemoryFailed: 'Failed to delete memory.',
    clearTypeConfirm: 'Clear {label}? This cannot be undone.',
    memoryTypeCleared: '{label} cleared: {count}',
    clearMemoriesFailed: 'Failed to clear memories.',
    clearAllConfirmFirst: 'Clear all memories, including user, long-term, and short-term memories?',
    clearAllConfirmSecond: 'Confirm again: all memories will be permanently deleted. Continue?',
    allMemoryCleared: 'All memories cleared: {count}',
    clearAllFailed: 'Failed to clear all memories.',
    stateLoadFailed: 'Failed to load state.',
    shortTermExpiredCleared: 'Expired short-term memories cleared: {count}',
    clearExpiredFailed: 'Failed to clear expired short-term memories.',
    clearFailedBubble: 'Clear failed',
    memoryAiUnavailable: 'AI memory analysis is unavailable. Check API settings and try again.',
    safeShellCancel: 'Cancel',
    safeShellFailed: 'Safe Shell operation failed.',
    endpointDomainChanged: 'Endpoint domain changed from {oldDomain} to {newDomain}. API Key and chat data will be sent to this domain. Continue?',
    encryptionUnavailable: 'System encryption is unavailable. API Key will only be saved for this session and must be re-entered after restart.',
    thinking: 'Let me think...',
    emptyReply: "I haven't found the right answer yet.",
    apiFailed: 'Failed to connect to the API. Check your Key or network.',
    reminderMinutesSet: 'Reminder interval set to {minutes} minutes',
    startupBubble: 'Pet Framework test mode is ready',
    ariaStage: 'Pet Framework desktop pet',
    ariaApiPanel: 'API Settings',
    ariaChatPanel: 'Pet Framework Chat',
    ariaStatePanel: 'Pet Framework State and Memory'
  }
};

const baseRows = {
  idle: { row: 0, frames: 6, fps: 5 },
  'running-right': { row: 1, frames: 8, fps: 9 },
  'running-left': { row: 2, frames: 8, fps: 9 },
  waving: { row: 3, frames: 4, fps: 5 },
  jumping: { row: 4, frames: 5, fps: 7 },
  failed: { row: 5, frames: 8, fps: 7 },
  waiting: { row: 6, frames: 6, fps: 5 },
  running: { row: 7, frames: 6, fps: 6 },
  review: { row: 8, frames: 6, fps: 5 }
};

function normalizeAnimationRows(value) {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(Object.entries(value).flatMap(([name, definition]) => {
    const row = Number(definition?.row);
    const frames = Number(definition?.frames);
    const fps = Number(definition?.fps);
    if (!name || !Number.isInteger(row) || row < 0) return [];
    if (!Number.isInteger(frames) || frames < 1 || frames > 64) return [];
    if (!Number.isFinite(fps) || fps <= 0 || fps > 60) return [];
    return [[name, { row, frames, fps }]];
  }));
}

let rows = {
  ...baseRows,
  ...normalizeAnimationRows(petProfile.animationRows)
};
let cell = {
  width: Math.max(1, Number(petProfile.spriteCell?.width) || 192),
  height: Math.max(1, Number(petProfile.spriteCell?.height) || 208)
};
const minScale = 0.35;
const maxScale = 1.55;
const ns = petProfile.localStorageNamespace || 'pet';
const lsKey = (key) => `${ns}-${key}`;

let state = 'idle';
let frame = 0;
let frameTimer = null;
let reminderTimer = null;
let clockTimer = null;
let bubbleTimer = null;
let dragReturnTimer = null;
let restoreTimers = [];
let scale = Number(localStorage.getItem(lsKey('scale')) || '1.18');
let reminderMinutes = Number(localStorage.getItem(lsKey('reminder-minutes')) || '45');
let lastNightReminderDate = localStorage.getItem(lsKey('last-night-date')) || '';
let dragAnimating = false;
let lastDirection = 'right';
let appVisible = true;
let chatHistory = [];
let chatBusy = false;
let petLanguage = getLanguage();
let statePanelLoadToken = 0;

function getLanguage() {
  const saved = localStorage.getItem(lsKey('language'));
  if (saved === 'en' || saved === 'zh') return saved;
  return petProfile.defaultLanguage === 'en' ? 'en' : 'zh';
}

function setLanguage(lang) {
  petLanguage = lang === 'en' ? 'en' : 'zh';
  localStorage.setItem(lsKey('language'), petLanguage);
}

function t(key, params = {}) {
  const value = i18n[petLanguage]?.[key] || i18n.zh[key] || key;
  return Object.entries(params).reduce(
    (text, [name, replacement]) => text.replaceAll(`{${name}}`, String(replacement)),
    value
  );
}

function getReminderSettings() {
  return {
    drinkText: localStorage.getItem(lsKey('drinkReminderText')) || '',
    nightText: localStorage.getItem(lsKey('nightReminderText')) || ''
  };
}

function saveReminderSettings() {
  const drinkText = drinkReminderText.value.trim();
  const nightText = nightReminderText.value.trim();
  if (drinkText) {
    localStorage.setItem(lsKey('drinkReminderText'), drinkText);
  } else {
    localStorage.removeItem(lsKey('drinkReminderText'));
  }
  if (nightText) {
    localStorage.setItem(lsKey('nightReminderText'), nightText);
  } else {
    localStorage.removeItem(lsKey('nightReminderText'));
  }
}

function getDrinkReminderMessage() {
  return localStorage.getItem(lsKey('drinkReminderText')) || t('drinkReminderDefault');
}

function getNightReminderMessage() {
  return localStorage.getItem(lsKey('nightReminderText')) || t('nightReminderDefault');
}

function setText(element, textValue) {
  if (element) element.textContent = textValue;
}

function applyPetProfile() {
  document.title = petProfile.displayName || 'Pet Framework';
  pet.setAttribute('aria-label', petProfile.characterName || 'Pet');
  const sheetWidth = Math.max(cell.width, Number(petProfile.spriteSheetSize?.width) || 1536);
  const sheetHeight = Math.max(cell.height, Number(petProfile.spriteSheetSize?.height) || 1872);
  document.documentElement.style.setProperty('--cell-w', `${cell.width}px`);
  document.documentElement.style.setProperty('--cell-h', `${cell.height}px`);
  document.documentElement.style.setProperty('--sheet-w', `calc(${sheetWidth}px * var(--scale))`);
  document.documentElement.style.setProperty('--sheet-h', `calc(${sheetHeight}px * var(--scale))`);
  const spriteSheet = String(petProfile.spriteSheet || '').trim();
  if (spriteSheet && !petProfile.usePlaceholderPet) {
    pet.classList.remove('pet--placeholder');
    pet.style.backgroundImage = `url("${spriteSheet}")`;
    frameworkNotice.classList.add('hidden');
    return;
  }
  pet.classList.add('pet--placeholder');
  pet.style.backgroundImage = 'url("./assets/placeholder-pet.svg")';
  frameworkNotice.classList.remove('hidden');
}

/**
 * 应用角色包渲染配置（来自 CharacterPackManager → Main → character-config IPC）。
 * 用角色包的 spritesheet 替换 pet-profile.js 中的默认占位配置。
 * 更新 petProfile + 全局 rows/cell，然后重新执行 applyPetProfile。
 */
function applyCharacterConfig(config) {
  if (!config) return;

  // 更新 petProfile 的 sprite 字段
  petProfile.spriteSheet = config.spriteSheetUrl || '';
  petProfile.usePlaceholderPet = config.rendererType === 'placeholder';
  petProfile.spriteCell = {
    width: config.cellWidth || 192,
    height: config.cellHeight || 208
  };
  petProfile.spriteSheetSize = {
    width: config.sheetWidth || 1536,
    height: config.sheetHeight || 1872
  };
  petProfile.animationRows = config.rows || {};
  if (config.characterName || config.characterId) {
    petProfile.characterName = config.characterName || config.characterId;
    petProfile.displayName = config.characterName || config.characterId;
  }

  // 重建全局 rows 和 cell
  rows = {
    ...baseRows,
    ...normalizeAnimationRows(petProfile.animationRows)
  };
  cell = {
    width: Math.max(1, Number(petProfile.spriteCell?.width) || 192),
    height: Math.max(1, Number(petProfile.spriteCell?.height) || 208)
  };

  // 重新应用 sprite 配置
  applyPetProfile();

  // 重置动画到 idle 以应用新的 rows/cell
  state = 'idle';
  frame = 0;
}

// 监听 Main 推送的角色渲染配置
if (window.petAPI?.onCharacterConfig) {
  window.petAPI.onCharacterConfig((config) => {
    try {
      applyCharacterConfig(config);
    } catch (e) {
      console.error('[renderer] applyCharacterConfig failed:', e);
    }
  });
}

function applyLanguage() {
  document.documentElement.lang = petLanguage === 'en' ? 'en' : 'zh-CN';
  stage.setAttribute('aria-label', t('ariaStage'));
  apiPanel.setAttribute('aria-label', t('ariaApiPanel'));
  chatPanel.setAttribute('aria-label', t('ariaChatPanel'));
  statePanel.setAttribute('aria-label', t('ariaStatePanel'));

  setText(apiSettings, t('api'));
  setText(chatToggle, t('chat'));
  setText(stateToggle, t('state'));
  setText(languageToggle, t('languageToggle'));
  setText(frameworkNotice, t('frameworkNotice'));

  setText(apiPanel.querySelector('.api-panel__head strong'), t('apiSettings'));
  setText(apiPanel.querySelector('label:nth-of-type(1) span'), t('endpoint'));
  setText(apiPanel.querySelector('label:nth-of-type(2) span'), t('model'));
  setText(document.getElementById('drinkReminderLabel'), t('drinkReminderLabel'));
  setText(document.getElementById('nightReminderLabel'), t('nightReminderLabel'));
  drinkReminderText.placeholder = t('drinkReminderPlaceholder');
  nightReminderText.placeholder = t('nightReminderPlaceholder');
  setText(apiSave, t('save'));
  setText(apiClearKey, t('clear'));
  apiKey.placeholder = apiKey.dataset.saved === 'true' ? t('savedApiKey') : 'sk-...';
  if (apiStatus.dataset.statusKey) {
    apiStatus.textContent = t(apiStatus.dataset.statusKey);
  }

  setText(chatPanel.querySelector('.chat-panel__head strong'), t('chat'));
  chatInput.placeholder = t('chatPlaceholder', { name: petProfile.characterName || 'Pet' });
  setText(chatSend, t('send'));

  setText(statePanel.querySelector('.state-panel__head strong'), t('state'));
  setText(statePanel.querySelector('.state-block:nth-of-type(1) h2'), t('affection'));
  setText(statePanel.querySelector('.state-block:nth-of-type(2) h2'), t('promptStats'));
  setText(statePanel.querySelector('.state-block:nth-of-type(3) h2'), t('userMemory'));
  setText(statePanel.querySelector('.state-block:nth-of-type(4) h2'), t('longTermMemory'));
  setText(statePanel.querySelector('.state-block:nth-of-type(5) h2'), t('shortTermMemory'));
  setText(clearUserMemory, t('clear'));
  setText(clearLongTermMemory, t('clear'));
  setText(clearShortTermMemory, t('clear'));
  setText(clearExpiredShortTerm, t('clearExpired'));
  setText(clearAllMemory, t('clearAllMemories'));
  setText(exportMemory, t('exportMemory'));
  if (refreshReminders) setText(refreshReminders, t('reminderRefresh'));
  if (triggerDailyDigestBtn) setText(triggerDailyDigestBtn, t('triggerDigestLabel'));
  if (triggerReminderCheckBtn) setText(triggerReminderCheckBtn, t('triggerReminderCheckLabel'));
  setText(shortTermMemoryNote, t('shortTermNote'));

  if (!statePanel.classList.contains('hidden')) {
    loadStatePanel();
  }
}

function toggleLanguage() {
  setLanguage(petLanguage === 'zh' ? 'en' : 'zh');
  applyLanguage();
}

function clampScale(value) {
  return Math.max(minScale, Math.min(maxScale, Number(value) || 1));
}

function applyScale(nextScale = scale) {
  scale = clampScale(nextScale);
  document.documentElement.style.setProperty('--scale', String(scale));
  window.petAPI?.setWindowScale(scale);
  localStorage.setItem(lsKey('scale'), String(scale));
  drawFrame();
}

function setState(nextState) {
  if (!rows[nextState] || state === nextState) return;
  if (nextState === 'idle') {
    dragAnimating = false;
  }
  state = nextState;
  frame = 0;
  restartAnimation();
}

function restartAnimation() {
  clearInterval(frameTimer);
  frameTimer = null;
  drawFrame();
  if (!appVisible) return;
  const fps = rows[state].fps;
  frameTimer = setInterval(() => {
    frame = (frame + 1) % rows[state].frames;
    drawFrame();
  }, Math.round(1000 / fps));
}

function drawFrame() {
  const row = rows[state].row;
  const x = -frame * cell.width * scale;
  const y = -row * cell.height * scale;
  pet.dataset.animationState = state;
  pet.style.backgroundPosition = `${x}px ${y}px`;
}

function showBubble(message, duration = 12000) {
  if (!appVisible) return;
  clearTimeout(bubbleTimer);
  bubble.textContent = message;
  bubble.classList.remove('hidden');
  bubbleTimer = setTimeout(() => {
    bubble.classList.add('hidden');
  }, duration);
}

/**
 * 显示提醒气泡（桌宠左侧，独立于聊天气泡）。
 * 提醒到期时由 ProactiveGraph 经 proactive-event 通道推送。
 * 点击可提前关闭。
 */
function showReminderBubble(message, duration = 20000) {
  if (!appVisible || !reminderStack) return;
  // 第一个气泡出现时请求扩大窗口宽度
  if (activeBubbleCount === 0) {
    window.petAPI?.requestBubbleSpace?.(320);
  }
  activeBubbleCount++;
  // 动态创建气泡并 append 到堆叠容器，支持多个提醒垂直堆叠
  const el = document.createElement('div');
  el.className = 'reminder-bubble';
  el.setAttribute('role', 'alert');
  el.textContent = message;
  el.addEventListener('click', () => removeReminderBubble(el));
  reminderStack.appendChild(el);
  // 最多保留 5 个动态气泡，超过时移除最旧的一个
  const bubbles = reminderStack.querySelectorAll('.reminder-bubble:not(#reminderBubble)');
  if (bubbles.length > 5) {
    removeReminderBubble(bubbles[0]);
  }
  // duration 后自动从 DOM 移除
  setTimeout(() => removeReminderBubble(el), duration);
}

function removeReminderBubble(el) {
  if (!el || !el.parentNode) return;
  if (el.dataset.removing === '1') return;
  el.dataset.removing = '1';
  el.classList.add('hidden');
  // 等待过渡动画完成后再移除 DOM
  setTimeout(() => {
    if (el.parentNode) {
      el.remove();
      activeBubbleCount = Math.max(0, activeBubbleCount - 1);
      // 所有气泡都消失后恢复窗口原始尺寸
      if (activeBubbleCount === 0) {
        window.petAPI?.releaseBubbleSpace?.();
      }
    }
  }, 250);
}

function clearRestoreTimers() {
  restoreTimers.forEach(clearTimeout);
  restoreTimers = [];
}

function remindHydration() {
  if (!appVisible) return;
  clearRestoreTimers();
  showBubble(getDrinkReminderMessage(), 14000);
  setState('waving');
  restoreTimers.push(setTimeout(() => setState('waiting'), 5200));
  restoreTimers.push(setTimeout(() => setState('idle'), 15000));
}

function nightReminder() {
  if (!appVisible) return;
  clearRestoreTimers();
  showBubble(getNightReminderMessage(), 15000);
  setState('waiting');
  restoreTimers.push(setTimeout(() => setState('idle'), 15500));
}

function scheduleReminder() {
  clearInterval(reminderTimer);
  reminderTimer = setInterval(remindHydration, reminderMinutes * 60 * 1000);
  localStorage.setItem(lsKey('reminder-minutes'), String(reminderMinutes));
}

function checkClockForNightReminder() {
  const now = new Date();
  const dateKey = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
  if (now.getHours() === 0 && now.getMinutes() === 0 && lastNightReminderDate !== dateKey) {
    lastNightReminderDate = dateKey;
    localStorage.setItem(lsKey('last-night-date'), dateKey);
    nightReminder();
  }
}

function startClockWatcher() {
  clearInterval(clockTimer);
  checkClockForNightReminder();
  clockTimer = setInterval(checkClockForNightReminder, 15000);
}

function changeScale(delta) {
  applyScale(Math.round((scale + delta) * 100) / 100);
}

function startDragAnimation(event) {
  if (event.button !== 0 || event.target.closest('button')) return;
  dragAnimating = true;
  clearTimeout(dragReturnTimer);
  clearRestoreTimers();
  window.petAPI?.startDragAnimation();
  setState(lastDirection === 'left' ? 'running-left' : 'running-right');
}

function stopDragAnimation() {
  if (!dragAnimating) return;
  dragAnimating = false;
  window.petAPI?.stopDragAnimation();
  dragReturnTimer = setTimeout(() => setState('idle'), 180);
}

function setVisibilityMode(visible) {
  appVisible = Boolean(visible);
  clearTimeout(bubbleTimer);
  clearTimeout(dragReturnTimer);
  clearRestoreTimers();
  bubble.classList.add('hidden');
  dragAnimating = false;
  if (appVisible) {
    restartAnimation();
    return;
  }
  clearInterval(frameTimer);
  frameTimer = null;
}

async function openApiPanel() {
  closeChatPanel();
  closeStatePanel();
  const config = await window.petAPI?.getApiConfig?.();
  apiEndpoint.value = config?.endpoint || 'https://api.deepseek.com/v1/chat/completions';
  apiModel.value = config?.model || 'deepseek-chat';
  apiKey.value = '';
  const reminderSettings = getReminderSettings();
  drinkReminderText.value = reminderSettings.drinkText;
  nightReminderText.value = reminderSettings.nightText;
  apiKey.dataset.saved = config?.hasApiKey ? 'true' : 'false';
  apiKey.placeholder = config?.hasApiKey ? t('savedApiKey') : 'sk-...';
  apiStatus.dataset.statusKey = config?.hasApiKey ? 'apiKeySaved' : 'noApiKey';
  apiStatus.textContent = t(apiStatus.dataset.statusKey);
  apiPanel.classList.remove('hidden');
}

function closeApiPanel() {
  apiPanel.classList.add('hidden');
}

function getResponseAnimationState(emotion) {
  const config = petProfile.responseEmotion || {};
  if (config.enabled && rows[emotion]) return emotion;
  const fallbackState = String(config.fallbackState || 'waving');
  return rows[fallbackState] ? fallbackState : 'waving';
}

function getResponseAnimationDuration() {
  const duration = Number(petProfile.responseEmotion?.durationMs);
  return Number.isFinite(duration) ? Math.min(30000, Math.max(1200, duration)) : 6500;
}

function focusChatInput() {
  chatInput.disabled = false;
  chatSend.disabled = chatBusy;
  const applyFocus = () => {
    if (chatPanel.classList.contains('hidden')) return;
    chatInput.focus({ preventScroll: true });
  };
  const focusWindow = window.petAPI?.focusWindow?.();
  Promise.resolve(focusWindow)
    .catch(() => false)
    .finally(() => {
      applyFocus();
      requestAnimationFrame(applyFocus);
      setTimeout(applyFocus, 50);
      setTimeout(applyFocus, 150);
    });
}

function getHostnameFromUrl(urlString) {
  try {
    return new URL(urlString).hostname;
  } catch {
    return '';
  }
}

async function saveApiSettings(clearApiKey = false) {
  apiSave.disabled = true;
  apiStatus.dataset.statusKey = 'saving';
  apiStatus.textContent = t('saving');
  try {
    saveReminderSettings();

    const currentConfig = await window.petAPI?.getApiConfig?.();
    const newEndpoint = apiEndpoint.value.trim();
    const oldDomain = getHostnameFromUrl(currentConfig?.endpoint || '');
    const newDomain = getHostnameFromUrl(newEndpoint);
    if (oldDomain && newDomain && oldDomain !== newDomain) {
      const confirmed = await showConfirmDialog(
        t('endpointDomainChanged', { oldDomain, newDomain })
      );
      if (!confirmed) {
        apiStatus.dataset.statusKey = currentConfig?.hasApiKey ? 'apiSavedWithKey' : 'apiSavedEmpty';
        apiStatus.textContent = t(apiStatus.dataset.statusKey);
        return;
      }
    }

    const config = await window.petAPI?.saveApiConfig?.({
      provider: 'deepseek',
      endpoint: newEndpoint,
      model: apiModel.value,
      apiKey: apiKey.value,
      clearApiKey
    });
    apiKey.value = '';
    apiKey.dataset.saved = config?.hasApiKey ? 'true' : 'false';
    apiKey.placeholder = config?.hasApiKey ? t('savedApiKey') : 'sk-...';
    apiStatus.dataset.statusKey = config?.hasApiKey ? 'apiSavedWithKey' : 'apiSavedEmpty';
    apiStatus.textContent = t(apiStatus.dataset.statusKey);
    if (config && !config.encryptionAvailable && config.hasApiKey) {
      showBubble(t('encryptionUnavailable'), 8000);
    } else {
      showBubble(config?.hasApiKey ? t('apiSaveBubble') : t('apiSaveEmptyBubble'), 5000);
    }
  } catch {
    apiStatus.dataset.statusKey = 'saveFailed';
    apiStatus.textContent = t('saveFailed');
    showBubble(t('apiSaveFailedBubble'), 5000);
  } finally {
    apiSave.disabled = false;
  }
}

function openChatPanel() {
  closeApiPanel();
  closeStatePanel();
  chatPanel.classList.remove('hidden');
  focusChatInput();
}

function closeChatPanel() {
  chatPanel.classList.add('hidden');
}

function setStateStatus(message) {
  stateStatus.textContent = message || '';
}

function setKeyValues(container, rows) {
  container.innerHTML = '';
  for (const [label, value] of rows) {
    const row = document.createElement('div');
    row.textContent = `${label}: ${value}`;
    container.appendChild(row);
  }
}

function showConfirmDialog(message) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'confirm-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');

    const text = document.createElement('div');
    text.className = 'confirm-dialog__text';
    text.textContent = message;

    const actions = document.createElement('div');
    actions.className = 'confirm-dialog__actions';

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'confirm-dialog__cancel';
    cancel.textContent = t('cancel');

    const ok = document.createElement('button');
    ok.type = 'button';
    ok.className = 'confirm-dialog__ok';
    ok.textContent = t('clear');

    function finish(value) {
      overlay.remove();
      resolve(value);
    }

    cancel.addEventListener('click', () => finish(false));
    ok.addEventListener('click', () => finish(true));
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) finish(false);
    });
    overlay.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        finish(false);
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        finish(true);
      }
    });

    actions.appendChild(cancel);
    actions.appendChild(ok);
    dialog.appendChild(text);
    dialog.appendChild(actions);
    overlay.appendChild(dialog);
    stage.appendChild(overlay);
    cancel.focus();
  });
}

function formatWarnings(warnings) {
  if (!Array.isArray(warnings) || warnings.length === 0) return t('none');
  return warnings.join(', ');
}

function getMemoryContainer(type) {
  if (type === 'user') return userMemoryList;
  if (type === 'longTerm') return longTermMemoryList;
  return shortTermMemoryList;
}

function getMemoryTypeLabel(type) {
  if (type === 'user') return t('userMemory');
  if (type === 'longTerm') return t('longTermMemory');
  return t('shortTermMemory');
}

async function saveMemoryEdit(type, memory, nextContent) {
  const trimmed = String(nextContent || '').trim();
  if (!trimmed) {
    setStateStatus(t('memoryCannotBeEmptyStatus'));
    showBubble(t('memoryCannotBeEmptyBubble'), 5000);
    return;
  }
  if (trimmed.length > 300) {
    setStateStatus(t('memoryTooLong'));
    showBubble(t('memoryTooLong'), 5000);
    return;
  }
  try {
    await window.petAPI?.updateMemory?.(type, memory.id, { content: trimmed });
    setStateStatus(t('memoryUpdated'));
    await loadStatePanel();
  } catch {
    setStateStatus(t('updateMemoryFailed'));
    showBubble(t('updateMemoryFailed'), 5000);
  }
}

function startInlineMemoryEdit(item, type, memory) {
  item.innerHTML = '';
  item.classList.add('memory-item--editing');

  const input = document.createElement('textarea');
  input.className = 'memory-edit-input';
  input.maxLength = 300;
  input.value = memory.content || '';

  const save = document.createElement('button');
  save.className = 'memory-edit-save';
  save.type = 'button';
  save.textContent = t('save');

  const cancel = document.createElement('button');
  cancel.className = 'memory-edit-cancel';
  cancel.type = 'button';
  cancel.textContent = t('cancel');

  save.addEventListener('click', () => saveMemoryEdit(type, memory, input.value));
  cancel.addEventListener('click', () => renderMemoryList(type, getMemoryContainer(type)._lastMemories || []));
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      renderMemoryList(type, getMemoryContainer(type)._lastMemories || []);
    }
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      saveMemoryEdit(type, memory, input.value);
    }
  });

  item.appendChild(input);
  item.appendChild(save);
  item.appendChild(cancel);
  input.focus();
  input.select();
}

/** 格式化记忆时间戳：优先显示来源时间（用户发言时刻），精确到秒，附带时区 */
function formatMemoryTime(memory) {
  const rawTs = memory.sourceOccurredAt || memory.createdAt;
  if (!rawTs) return '';
  const d = new Date(rawTs);
  if (isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  const formatted = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  const tz = memory.writeTimezone || '';
  return tz ? `${formatted} (${tz})` : formatted;
}

function renderMemoryList(type, memories) {
  const container = getMemoryContainer(type);
  const sourceMemories = Array.isArray(memories) ? memories : [];
  const displayMemories = type === 'user'
    ? [...sourceMemories].sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)))
    : sourceMemories;
  container._lastMemories = displayMemories;
  container.innerHTML = '';

  if (displayMemories.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'memory-empty';
    empty.textContent = t('noMemories');
    container.appendChild(empty);
    return;
  }

  for (const memory of displayMemories) {
    const item = document.createElement('div');
    item.className = 'memory-item';

    const content = document.createElement('div');
    content.className = 'memory-item__content';
    if (type === 'shortTerm' && memory.topic) {
      content.textContent = `[${memory.topic}] ${memory.content || t('empty')}`;
    } else if (type === 'user' && (memory.category || memory.key)) {
      const marker = [memory.category, memory.key].filter(Boolean).join('/');
      content.textContent = `${memory.pinned ? '[PIN] ' : ''}[${marker}] ${memory.content || t('empty')}`;
    } else {
      content.textContent = memory.content || t('empty');
    }

    // 显示秒级时间和时区
    const timeStr = formatMemoryTime(memory);

    const edit = document.createElement('button');
    edit.className = 'memory-edit';
    edit.type = 'button';
    edit.textContent = t('edit');
    edit.addEventListener('click', () => startInlineMemoryEdit(item, type, memory));

    const remove = document.createElement('button');
    remove.className = 'memory-delete';
    remove.type = 'button';
    remove.textContent = t('delete');
    remove.addEventListener('click', async () => {
      const ok = await showConfirmDialog(t('deleteMemoryConfirm'));
      if (!ok) return;
      try {
        await window.petAPI?.deleteMemory?.(type, memory.id);
        setStateStatus(t('memoryDeleted'));
        await loadStatePanel();
      } catch {
        setStateStatus(t('deleteMemoryFailed'));
        showBubble(t('deleteMemoryFailed'), 5000);
      }
    });

    item.appendChild(content);
    if (timeStr) {
      const meta = document.createElement('div');
      meta.className = 'memory-item__meta';
      meta.textContent = timeStr;
      item.appendChild(meta);
    }
    item.appendChild(edit);
    item.appendChild(remove);
    container.appendChild(item);
  }
}

async function clearMemoryType(type) {
  const label = getMemoryTypeLabel(type);
  const ok = await showConfirmDialog(t('clearTypeConfirm', { label }));
  if (!ok) return;
  try {
    const result = await window.petAPI?.clearMemories?.(type);
    setStateStatus(t('memoryTypeCleared', { label, count: result?.removed || 0 }));
    await loadStatePanel();
  } catch {
    setStateStatus(t('clearMemoriesFailed'));
    showBubble(t('clearMemoriesFailed'), 5000);
  }
}

async function clearAllMemoryTypes() {
  const firstOk = await showConfirmDialog(t('clearAllConfirmFirst'));
  if (!firstOk) return;
  const secondOk = await showConfirmDialog(t('clearAllConfirmSecond'));
  if (!secondOk) return;
  try {
    const result = await window.petAPI?.clearAllMemories?.();
    const removed = result?.removed || {};
    setStateStatus(t('allMemoryCleared', {
      count: (removed.user || 0) + (removed.longTerm || 0) + (removed.shortTerm || 0)
    }));
    await loadStatePanel();
  } catch {
    setStateStatus(t('clearAllFailed'));
    showBubble(t('clearAllFailed'), 5000);
  }
}

async function exportMemoryData() {
  try {
    const result = await window.petAPI?.exportMemories?.();
    if (!result?.success) {
      if (result?.reason === 'cancelled') {
        setStateStatus(t('exportCancelled'));
      } else {
        setStateStatus(t('exportFailed'));
        showBubble(t('exportFailed'), 5000);
      }
      return;
    }
    setStateStatus(t('exportSuccess', { path: result.path }));
    showBubble(t('exportSuccess', { path: result.path }), 5000);
  } catch (e) {
    setStateStatus(t('exportFailed'));
    showBubble(t('exportFailed'), 5000);
  }
}

async function loadStatePanel() {
  const loadToken = ++statePanelLoadToken;
  setStateStatus(t('loading'));
  try {
    const [affection, petData, userMemories, longTermMemories, shortTermMemories, archStatus, reminders] = await Promise.all([
      window.petAPI?.getAffection?.(),
      window.petAPI?.getPetData?.(),
      window.petAPI?.listMemories?.('user'),
      window.petAPI?.listMemories?.('longTerm'),
      window.petAPI?.listMemories?.('shortTerm'),
      window.petAPI?.getArchitectureStatus?.(),
      window.petAPI?.listReminders?.()
    ]);
    if (loadToken !== statePanelLoadToken || statePanel.classList.contains('hidden')) return;
    const stats = petData?.prompt?.lastPromptStats || {};

    renderArchStatus(archStatus);
    renderRemindersList(reminders);
    setKeyValues(affectionView, [
      [t('affection'), `${affection?.score ?? 50} / 100`],
      [t('relationship'), affection?.level || 'familiar']
    ]);
    setKeyValues(promptStatsView, [
      [t('systemPromptChars'), stats.systemPromptChars ?? stats.estimatedChars ?? 0],
      [t('injectedMemories'), stats.memoryInjectedCount ?? 0],
      [t('historyMessages'), stats.historyMessageCount ?? 0],
      [t('userInputChars'), stats.userInputChars ?? 0],
      [t('warnings'), formatWarnings(stats.warnings)]
    ]);
    renderMemoryList('user', userMemories);
    renderMemoryList('longTerm', longTermMemories);
    renderMemoryList('shortTerm', shortTermMemories);
    setStateStatus(t('ready'));
  } catch {
    if (loadToken !== statePanelLoadToken || statePanel.classList.contains('hidden')) return;
    setStateStatus(t('stateLoadFailed'));
    showBubble(t('stateLoadFailed'), 5000);
  }
}

// 渲染 Agent 架构状态
function renderArchStatus(status) {
  if (!archStatusView) return;
  if (!status) {
    setKeyValues(archStatusView, [[t('archRuntime'), t('archStatusUnknown')]]);
    return;
  }
  const isReady = status.state === 'langgraph_ready';
  const items = [
    [t('archRuntime'), isReady ? t('archLanggraph') : t('archLegacy')],
    [t('archInitialized'), status.initialized ? '✓' : '✗'],
    [t('archDatabase'), status.databaseReady ? '✓ ' + t('archConnected') : '✗'],
    [t('archScheduler'), status.schedulerRunning ? '✓' : '✗'],
    [t('archReflection'), status.reflectionWorkerRunning ? '✓' : '✗'],
    [t('archCharacter'), status.activeCharacterId || t('archNone')],
    [t('archSkills'), (status.registeredSkills || []).join(', ') || t('archNone')]
  ];
  if (!isReady && status.lastInitializationError) {
    items.push([t('archError'), status.lastInitializationError]);
  }
  setKeyValues(archStatusView, items);
  archStatusView.style.color = isReady ? '' : '#c0392b';
}

// 渲染提醒列表
function renderRemindersList(reminders) {
  if (!reminderList) return;
  reminderList.innerHTML = '';
  if (!reminders || reminders.length === 0) {
    reminderList.textContent = t('noReminders');
    return;
  }
  for (const r of reminders) {
    const item = document.createElement('div');
    item.className = 'memory-item';
    const content = document.createElement('span');
    content.textContent = `${r.content} — ${r.nextTriggerAt || r.triggerAt}`;
    item.appendChild(content);
    const delBtn = document.createElement('button');
    delBtn.textContent = t('reminderDelete');
    delBtn.style.marginLeft = '8px';
    delBtn.addEventListener('click', async () => {
      const result = await window.petAPI?.deleteReminder?.(r.id);
      if (result?.deleted) {
        await loadReminders();
      }
    });
    item.appendChild(delBtn);
    reminderList.appendChild(item);
  }
}

async function loadReminders() {
  try {
    const reminders = await window.petAPI?.listReminders?.();
    renderRemindersList(reminders);
  } catch { /* ignore */ }
}

async function triggerDailyDigest() {
  try {
    const result = await window.petAPI?.triggerDigest?.();
    if (result?.ok) {
      showBubble(t('digestTriggered'), 3000);
    } else {
      showBubble(t('digestFailed'), 5000);
    }
  } catch {
    showBubble(t('digestFailed'), 5000);
  }
}

async function triggerReminderCheck() {
  await loadReminders();
  showBubble(t('reminderChecked'), 3000);
}

async function openStatePanel() {
  closeApiPanel();
  closeChatPanel();
  statePanel.classList.remove('hidden');
  await loadStatePanel();
}

function closeStatePanel() {
  statePanelLoadToken += 1;
  if (statePanel.contains(document.activeElement)) {
    document.activeElement.blur();
  }
  statePanel.classList.add('hidden');
}

// ===== Onboarding 首次配置面板 =====
function openOnboardingPanel(message) {
  closeApiPanel();
  closeChatPanel();
  closeStatePanel();
  if (message && onboardingMessage) {
    onboardingMessage.textContent = message;
  }
  if (onboardingPanel) {
    onboardingPanel.classList.remove('hidden');
  }
}

function closeOnboardingPanel() {
  if (onboardingPanel && !onboardingPanel.classList.contains('hidden')) {
    if (onboardingPanel.contains(document.activeElement)) {
      document.activeElement.blur();
    }
    onboardingPanel.classList.add('hidden');
  }
}

async function submitOnboarding(event) {
  event.preventDefault();
  if (!onboardingForm) return;

  const preferences = {
    nickname: obNickname?.value?.trim() || '',
    preferredName: obPreferredName?.value?.trim() || '',
    replyLength: obReplyLength?.value || 'short',
    proactiveLevel: obProactiveLevel?.value || 'medium',
    weatherCity: obWeatherCity?.value?.trim() || '',
    weatherEnabled: !!document.getElementById('obWeatherEnabled')?.checked,
    dndEnabled: !!obDndEnabled?.checked,
    systemNotificationEnabled: !!obNotificationEnabled?.checked,
    soundEnabled: !!obSoundEnabled?.checked,
    memoryEnabled: !!obMemoryEnabled?.checked
  };

  // DND 时间窗（固定 22:00-08:00，与 HTML 说明一致）
  if (preferences.dndEnabled) {
    preferences.dndStart = '22:00';
    preferences.dndEnd = '08:00';
  } else {
    preferences.dndStart = '22:00';
    preferences.dndEnd = '08:00';
  }

  const submitBtn = onboardingForm.querySelector('button[type="submit"]');
  const originalText = submitBtn?.textContent;
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = '提交中...';
  }

  try {
    const result = await window.petAPI?.submitOnboardingPreferences?.(preferences);
    if (result?.ok && result?.completed) {
      closeOnboardingPanel();
      showBubble('初始化完成，很高兴认识你！', 7000);
      setState('waving');
      clearRestoreTimers();
      restoreTimers = [setTimeout(() => setState('idle'), 6500)];
    } else if (result?.ok && !result?.completed) {
      // 还有后续步骤，保持面板开启
      if (onboardingMessage) {
        onboardingMessage.textContent = '请继续配置剩余选项。';
      }
    } else {
      if (onboardingMessage) {
        onboardingMessage.textContent = '提交失败，请重试。';
      }
    }
  } catch (error) {
    if (onboardingMessage) {
      onboardingMessage.textContent = '提交出错，请重试。';
    }
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = originalText || '完成配置';
    }
  }
}

function renderChatLog() {
  chatLog.innerHTML = '';
  const visibleItems = chatHistory.slice(-50);
  for (const item of visibleItems) {
    const entry = document.createElement('div');
    entry.className = `chat-msg chat-msg--${item.role}${item.tone ? ` chat-msg--${item.tone}` : ''}`;
    const content = document.createElement('div');
    content.className = 'chat-msg__content';
    content.textContent = item.content;
    entry.appendChild(content);
    if (item.pendingShellAction) {
      const actions = document.createElement('div');
      actions.className = 'chat-msg__actions';
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.textContent = t('safeShellCancel');
      cancel.addEventListener('click', () => handlePendingShellAction(item, false));
      const confirm = document.createElement('button');
      confirm.type = 'button';
      confirm.className = 'chat-msg__confirm';
      confirm.textContent = item.pendingShellAction.label || t('send');
      confirm.addEventListener('click', () => handlePendingShellAction(item, true));
      actions.appendChild(cancel);
      actions.appendChild(confirm);
      entry.appendChild(actions);
    }
    chatLog.appendChild(entry);
  }
  chatLog.scrollTop = chatLog.scrollHeight;
}

function pushChat(role, content, options = {}) {
  chatHistory.push({ role, content, ...options });
  if (chatHistory.length > 50) {
    chatHistory = chatHistory.slice(-50);
  }
  renderChatLog();
}

async function handlePendingShellAction(item, shouldConfirm) {
  const action = item?.pendingShellAction;
  if (!action) return;
  item.pendingShellAction = null;
  renderChatLog();
  try {
    const result = shouldConfirm
      ? await window.petAPI?.safeShell?.confirm?.(action.id)
      : await window.petAPI?.safeShell?.cancel?.(action.id);
    item.content = result?.reply || t('safeShellFailed');
    item.tone = result?.ok ? 'normal' : 'danger';
    showBubble(item.content, result?.ok ? 9000 : 6000);
  } catch {
    item.content = t('safeShellFailed');
    item.tone = 'danger';
  }
  renderChatLog();
  focusChatInput();
}

async function sendChatMessage(event) {
  event.preventDefault();
  const message = chatInput.value.trim();
  if (!message || chatBusy) return;

  chatBusy = true;
  chatSend.disabled = true;
  chatInput.value = '';
  clearRestoreTimers();

  try {
    const shellResult = await window.petAPI?.safeShell?.interpret?.(message);
    if (shellResult?.handled) {
      pushChat('user', message, { excludeFromAi: true });
      pushChat('assistant', shellResult.reply || t('safeShellFailed'), {
        excludeFromAi: true,
        tone: shellResult.tone || (shellResult.ok ? 'question' : 'danger'),
        pendingShellAction: shellResult.pendingAction || null
      });
      showBubble(shellResult.reply || t('safeShellFailed'), 9000);
      setState(shellResult.ok ? 'review' : 'failed');
      restoreTimers = [setTimeout(() => setState('idle'), 4500)];
      return;
    }

    pushChat('user', message);
    setState('waiting');
    showBubble(t('thinking'), 6000);

    try {
      await window.petAPI?.analyzeAndApplyMemory?.(message);
    } catch {
      // 记忆分析失败不阻断聊天，继续发送角色回复
    }
    const result = await window.petAPI?.sendChat?.({
      message,
      history: chatHistory.filter((item) => !item.excludeFromAi).slice(0, -1)
    });
    const reply = result?.reply || t('emptyReply');
    pushChat('assistant', reply);
    showBubble(reply, 14000);
    setState(getResponseAnimationState(result?.emotion));
    restoreTimers = [setTimeout(() => setState('idle'), getResponseAnimationDuration())];
  } catch {
    const fallback = t('apiFailed');
    pushChat('assistant', fallback);
    showBubble(fallback, 9000);
    setState('failed');
    restoreTimers = [setTimeout(() => setState('idle'), 6500)];
  } finally {
    chatBusy = false;
    chatSend.disabled = false;
    focusChatInput();
  }
}

function bindEvent(element, eventName, handler) {
  if (!element) return;
  element.addEventListener(eventName, handler);
}

bindEvent(apiSettings, 'click', openApiPanel);
bindEvent(apiClose, 'click', closeApiPanel);
bindEvent(apiSave, 'click', () => saveApiSettings(false));
bindEvent(apiClearKey, 'click', () => saveApiSettings(true));
bindEvent(chatToggle, 'click', openChatPanel);
bindEvent(chatClose, 'click', closeChatPanel);
bindEvent(chatForm, 'submit', sendChatMessage);
bindEvent(stateToggle, 'click', openStatePanel);
bindEvent(stateClose, 'click', closeStatePanel);
bindEvent(languageToggle, 'click', toggleLanguage);
bindEvent(clearExpiredShortTerm, 'click', async () => {
  try {
    const result = await window.petAPI?.clearExpiredShortTermMemories?.();
    setStateStatus(t('shortTermExpiredCleared', { count: result?.removed || 0 }));
    await loadStatePanel();
  } catch {
    setStateStatus(t('clearExpiredFailed'));
    showBubble(t('clearFailedBubble'), 5000);
  }
});
bindEvent(clearUserMemory, 'click', () => clearMemoryType('user'));
bindEvent(clearLongTermMemory, 'click', () => clearMemoryType('longTerm'));
bindEvent(clearShortTermMemory, 'click', () => clearMemoryType('shortTerm'));
bindEvent(clearAllMemory, 'click', clearAllMemoryTypes);
bindEvent(exportMemory, 'click', exportMemoryData);
bindEvent(refreshReminders, 'click', loadReminders);
bindEvent(triggerDailyDigestBtn, 'click', triggerDailyDigest);
bindEvent(triggerReminderCheckBtn, 'click', triggerReminderCheck);

bindEvent(stage, 'pointerdown', startDragAnimation);
window.addEventListener('pointerup', stopDragAnimation);
window.addEventListener('blur', stopDragAnimation);
document.addEventListener('mouseleave', stopDragAnimation);

window.petAPI?.onHydrateNow?.(remindHydration);
window.petAPI?.onNightNow?.(nightReminder);
window.petAPI?.onSetState?.(setState);
window.petAPI?.onSetScale?.((nextScale) => applyScale(nextScale));
window.petAPI?.onDragDirection?.((direction) => {
  if (!appVisible) return;
  lastDirection = direction === 'left' ? 'left' : 'right';
  dragAnimating = true;
  clearTimeout(dragReturnTimer);
  clearRestoreTimers();
  setState(lastDirection === 'left' ? 'running-left' : 'running-right');
});
window.petAPI?.onSetReminderMinutes?.((minutes) => {
  reminderMinutes = minutes;
  scheduleReminder();
  showBubble(t('reminderMinutesSet', { minutes }), 5000);
  setState('review');
  clearRestoreTimers();
  restoreTimers = [setTimeout(() => setState('idle'), 4500)];
});
window.petAPI?.onVisibilityMode?.(setVisibilityMode);
window.petAPI?.onShowApiSettings?.(openApiPanel);
// 主动事件（提醒到期、日报、每日问候）由 GraphDispatcher 推送
window.petAPI?.onProactiveEvent?.((dto) => {
  if (!dto) return;
  const message = dto.text || '';
  const isReminder = !!dto.reminderOccurrenceId;
  // 所有主动消息（提醒、开机问候、每日问候、天气摘要等）统一显示在桌宠左侧的提醒气泡
  if (message) {
    showReminderBubble(message, 20000);
  }
  // 设置角色表情和动作（来自 ProactiveGraph 的 expression/motion）
  if (dto.expression) {
    clearRestoreTimers();
    setState(dto.expression);
    restoreTimers = [setTimeout(() => setState('idle'), 6500)];
  }
  // 确认气泡已显示，回传 ACK 给主进程（携带 occurrenceId）
  // 主进程收到 ACK 后才标记投递成功，避免窗口重载/崩溃导致丢失
  if (dto.reminderOccurrenceId) {
    window.petAPI?.ackProactiveEvent?.(dto.reminderOccurrenceId);
  }
});
// Onboarding 请求（首次配置由 Graph 推送给用户）
window.petAPI?.onOnboardingRequest?.((dto) => {
  if (!dto) return;
  const message = dto.text || '请输入你的昵称和称呼偏好。';
  openOnboardingPanel(message);
  if (dto.expression) {
    clearRestoreTimers();
    setState(dto.expression);
    restoreTimers = [setTimeout(() => setState('idle'), 6500)];
  }
});

// Onboarding 表单提交
if (onboardingForm) {
  onboardingForm.addEventListener('submit', submitOnboarding);
}

applyPetProfile();
applyLanguage();
applyScale(scale);
restartAnimation();
scheduleReminder();
startClockWatcher();
setTimeout(() => showBubble(t('startupBubble'), 7000), 1200);
