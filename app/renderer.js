const stage = document.getElementById('stage');
const pet = document.getElementById('pet');
const bubble = document.getElementById('bubble');
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
const petProfile = window.petProfile || {
  displayName: 'Pet Framework',
  characterName: 'Pet',
  spriteSheet: '',
  usePlaceholderPet: true,
  defaultLanguage: 'zh',
  defaultDrinkReminderText: '\u8be5\u559d\u6c34\u5566\uff0c\u7167\u987e\u597d\u81ea\u5df1\u54e6\u3002',
  defaultNightReminderText: '\u5f88\u665a\u5566\uff0c\u65e9\u70b9\u4f11\u606f\uff0c\u665a\u5b89\u3002'
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
    chatPlaceholder: '\u8f93\u5165\u4f60\u60f3\u5bf9 Pet \u8bf4\u7684\u8bdd',
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
    longTermMemorySaved: '\u597d\u7684\uff0c\u6211\u4f1a\u8bb0\u5f97\u8fd9\u4ef6\u4e8b\u3002',
    userMemorySaved: '\u6211\u8bb0\u4f4f\u5566\u3002',
    memoryAiUnavailable: '\u5f53\u524d\u65e0\u6cd5\u4f7f\u7528 AI \u5224\u65ad\u5e76\u4fdd\u5b58\u8bb0\u5fc6\uff0c\u8bf7\u68c0\u67e5 API \u8bbe\u7f6e\u540e\u518d\u8bd5\u3002',
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
    chatPlaceholder: 'Say something to Pet',
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
    longTermMemorySaved: "Okay, I'll keep that in mind.",
    userMemorySaved: "I'll remember that.",
    memoryAiUnavailable: 'AI memory analysis is unavailable. Check API settings and try again.',
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

const rows = {
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

const cell = { width: 192, height: 208 };
const minScale = 0.35;
const maxScale = 1.55;

let state = 'idle';
let frame = 0;
let frameTimer = null;
let reminderTimer = null;
let clockTimer = null;
let bubbleTimer = null;
let dragReturnTimer = null;
let restoreTimers = [];
let scale = Number(localStorage.getItem('roxy-scale') || '1.18');
let reminderMinutes = Number(localStorage.getItem('roxy-reminder-minutes') || '45');
let lastNightReminderDate = localStorage.getItem('roxy-last-night-date') || '';
let dragAnimating = false;
let lastDirection = 'right';
let appVisible = true;
let chatHistory = [];
let chatBusy = false;
let roxyLanguage = getLanguage();

function getLanguage() {
  const saved = localStorage.getItem('roxyLanguage');
  if (saved === 'en' || saved === 'zh') return saved;
  return petProfile.defaultLanguage === 'en' ? 'en' : 'zh';
}

function setLanguage(lang) {
  roxyLanguage = lang === 'en' ? 'en' : 'zh';
  localStorage.setItem('roxyLanguage', roxyLanguage);
}

function t(key, params = {}) {
  const value = i18n[roxyLanguage]?.[key] || i18n.zh[key] || key;
  return Object.entries(params).reduce(
    (text, [name, replacement]) => text.replaceAll(`{${name}}`, String(replacement)),
    value
  );
}

function getReminderSettings() {
  return {
    drinkText: localStorage.getItem('roxyDrinkReminderText') || '',
    nightText: localStorage.getItem('roxyNightReminderText') || ''
  };
}

function saveReminderSettings() {
  const drinkText = drinkReminderText.value.trim();
  const nightText = nightReminderText.value.trim();
  if (drinkText) {
    localStorage.setItem('roxyDrinkReminderText', drinkText);
  } else {
    localStorage.removeItem('roxyDrinkReminderText');
  }
  if (nightText) {
    localStorage.setItem('roxyNightReminderText', nightText);
  } else {
    localStorage.removeItem('roxyNightReminderText');
  }
}

function getDrinkReminderMessage() {
  return localStorage.getItem('roxyDrinkReminderText') || t('drinkReminderDefault');
}

function getNightReminderMessage() {
  return localStorage.getItem('roxyNightReminderText') || t('nightReminderDefault');
}

function setText(element, textValue) {
  if (element) element.textContent = textValue;
}

function applyPetProfile() {
  document.title = petProfile.displayName || 'Pet Framework';
  pet.setAttribute('aria-label', petProfile.characterName || 'Pet');
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

function applyLanguage() {
  document.documentElement.lang = roxyLanguage === 'en' ? 'en' : 'zh-CN';
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
  chatInput.placeholder = t('chatPlaceholder').replace('Roxy', petProfile.characterName || 'Pet');
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
  setText(shortTermMemoryNote, t('shortTermNote'));

  if (!statePanel.classList.contains('hidden')) {
    loadStatePanel();
  }
}

function toggleLanguage() {
  setLanguage(roxyLanguage === 'zh' ? 'en' : 'zh');
  applyLanguage();
}

function clampScale(value) {
  return Math.max(minScale, Math.min(maxScale, Number(value) || 1));
}

function applyScale(nextScale = scale) {
  scale = clampScale(nextScale);
  document.documentElement.style.setProperty('--scale', String(scale));
  window.petAPI?.setWindowScale(scale);
  localStorage.setItem('roxy-scale', String(scale));
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
  localStorage.setItem('roxy-reminder-minutes', String(reminderMinutes));
}

function checkClockForNightReminder() {
  const now = new Date();
  const dateKey = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
  if (now.getHours() === 0 && now.getMinutes() === 0 && lastNightReminderDate !== dateKey) {
    lastNightReminderDate = dateKey;
    localStorage.setItem('roxy-last-night-date', dateKey);
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

async function saveApiSettings(clearApiKey = false) {
  apiSave.disabled = true;
  apiStatus.dataset.statusKey = 'saving';
  apiStatus.textContent = t('saving');
  try {
    saveReminderSettings();
    const config = await window.petAPI?.saveApiConfig?.({
      provider: 'deepseek',
      endpoint: apiEndpoint.value,
      model: apiModel.value,
      apiKey: apiKey.value,
      clearApiKey
    });
    apiKey.value = '';
    apiKey.dataset.saved = config?.hasApiKey ? 'true' : 'false';
    apiKey.placeholder = config?.hasApiKey ? t('savedApiKey') : 'sk-...';
    apiStatus.dataset.statusKey = config?.hasApiKey ? 'apiSavedWithKey' : 'apiSavedEmpty';
    apiStatus.textContent = t(apiStatus.dataset.statusKey);
    showBubble(config?.hasApiKey ? t('apiSaveBubble') : t('apiSaveEmptyBubble'), 5000);
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
  chatInput.focus();
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

function renderMemoryList(type, memories) {
  const container = getMemoryContainer(type);
  container._lastMemories = Array.isArray(memories) ? memories : [];
  container.innerHTML = '';

  if (!Array.isArray(memories) || memories.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'memory-empty';
    empty.textContent = t('noMemories');
    container.appendChild(empty);
    return;
  }

  for (const memory of memories) {
    const item = document.createElement('div');
    item.className = 'memory-item';

    const content = document.createElement('div');
    content.className = 'memory-item__content';
    content.textContent = type === 'shortTerm' && memory.topic
      ? `[${memory.topic}] ${memory.content || t('empty')}`
      : memory.content || t('empty');

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
      const ok = window.confirm(t('deleteMemoryConfirm'));
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
    item.appendChild(edit);
    item.appendChild(remove);
    container.appendChild(item);
  }
}

async function clearMemoryType(type) {
  const label = getMemoryTypeLabel(type);
  const ok = window.confirm(t('clearTypeConfirm', { label }));
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
  const firstOk = window.confirm(t('clearAllConfirmFirst'));
  if (!firstOk) return;
  const secondOk = window.confirm(t('clearAllConfirmSecond'));
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

async function loadStatePanel() {
  setStateStatus(t('loading'));
  try {
    const [affection, petData, userMemories, longTermMemories, shortTermMemories] = await Promise.all([
      window.petAPI?.getAffection?.(),
      window.petAPI?.getPetData?.(),
      window.petAPI?.listMemories?.('user'),
      window.petAPI?.listMemories?.('longTerm'),
      window.petAPI?.listMemories?.('shortTerm')
    ]);
    const stats = petData?.prompt?.lastPromptStats || {};

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
    setStateStatus(t('stateLoadFailed'));
    showBubble(t('stateLoadFailed'), 5000);
  }
}

async function openStatePanel() {
  closeApiPanel();
  closeChatPanel();
  statePanel.classList.remove('hidden');
  await loadStatePanel();
}

function closeStatePanel() {
  statePanel.classList.add('hidden');
}

function renderChatLog() {
  chatLog.innerHTML = '';
  const visibleItems = chatHistory.slice(-50);
  for (const item of visibleItems) {
    const entry = document.createElement('div');
    entry.className = `chat-msg chat-msg--${item.role}`;
    entry.textContent = item.content;
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

async function sendChatMessage(event) {
  event.preventDefault();
  const message = chatInput.value.trim();
  if (!message || chatBusy) return;

  chatBusy = true;
  chatSend.disabled = true;
  chatInput.value = '';
  clearRestoreTimers();

  try {
    let memoryAnalysis = { ok: true, remembered: false, action: 'skip' };
    try {
      memoryAnalysis = await window.petAPI?.analyzeAndApplyMemory?.(message) || memoryAnalysis;
    } catch {
      memoryAnalysis = {
        ok: false,
        remembered: false,
        message: t('memoryAiUnavailable')
      };
    }

    if (memoryAnalysis.ok === false) {
      pushChat('user', message, { excludeFromAi: true });
      const unavailable = memoryAnalysis.message || t('memoryAiUnavailable');
      pushChat('assistant', unavailable, { excludeFromAi: true });
      showBubble(unavailable, 8000);
      setState('failed');
      restoreTimers = [setTimeout(() => setState('idle'), 4500)];
      return;
    }

    if (memoryAnalysis.remembered) {
      pushChat('user', message, { excludeFromAi: true });
      const confirmation = memoryAnalysis.message || (
        memoryAnalysis.type === 'longTerm' ? t('longTermMemorySaved') : t('userMemorySaved')
      );
      pushChat('assistant', confirmation, { excludeFromAi: true });
      showBubble(confirmation, 7000);
      setState('review');
      restoreTimers = [setTimeout(() => setState('idle'), 4500)];
      return;
    }

    pushChat('user', message);
    setState('waiting');
    showBubble(t('thinking'), 6000);
    const result = await window.petAPI?.sendChat?.({
      message,
      history: chatHistory.filter((item) => !item.excludeFromAi).slice(0, -1)
    });
    const reply = result?.reply || t('emptyReply');
    pushChat('assistant', reply);
    showBubble(reply, 14000);
    setState('waving');
    restoreTimers = [setTimeout(() => setState('idle'), 6500)];
  } catch {
    const fallback = t('apiFailed');
    pushChat('assistant', fallback);
    showBubble(fallback, 9000);
    setState('failed');
    restoreTimers = [setTimeout(() => setState('idle'), 6500)];
  } finally {
    chatBusy = false;
    chatSend.disabled = false;
    chatInput.focus();
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

applyPetProfile();
applyLanguage();
applyScale(scale);
restartAnimation();
scheduleReminder();
startClockWatcher();
setTimeout(() => showBubble(t('startupBubble'), 7000), 1200);
