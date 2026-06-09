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
  defaultDrinkReminderText: '该喝水啦，照顾好自己哦。',
  defaultNightReminderText: '很晚啦，早点休息，晚安。'
};

const i18n = {
  zh: {
    api: '接口',
    apiSettings: 'API 设置',
    chat: '聊天',
    state: '状态',
    frameworkNotice: '桌宠框架测试版\n请替换动画资产和角色配置',
    languageToggle: '中 / EN',
    endpoint: '接口地址',
    model: '模型',
    drinkReminderLabel: '喝水提醒词',
    nightReminderLabel: '晚安提醒词',
    drinkReminderDefault: petProfile.defaultDrinkReminderText || '该喝水啦，照顾好自己哦。',
    nightReminderDefault: petProfile.defaultNightReminderText || '很晚啦，早点休息，晚安。',
    drinkReminderPlaceholder: '留空则使用默认喝水提醒词',
    nightReminderPlaceholder: '留空则使用默认晚安提醒词',
    save: '保存',
    cancel: '取消',
    clear: '清空',
    clearExpired: '清理过期',
    clearAllMemories: '清空全部记忆',
    chatPlaceholder: '输入你想对 Roxy 说的话',
    send: '发送',
    loading: '加载中...',
    ready: '已就绪',
    affection: '好感度',
    relationship: '关系状态',
    promptStats: 'Prompt 统计',
    systemPromptChars: 'System Prompt 字符数',
    injectedMemories: '注入记忆数',
    historyMessages: '历史消息数',
    userInputChars: '用户输入字符数',
    warnings: '警告',
    none: '无',
    userMemory: '用户记忆',
    longTermMemory: '长期记忆',
    shortTermMemory: '短期记忆',
    shortTermNote: '短期记忆用于临时上下文，普通聊天不会自动保存到这里。',
    noMemories: '暂无记忆',
    empty: '(空)',
    edit: '编辑',
    delete: '删除',
    savedApiKey: '已保存 API Key',
    apiKeySaved: 'API Key 已保存',
    noApiKey: '未配置 API Key',
    saving: '保存中...',
    apiSavedWithKey: '已保存，API Key 已配置。',
    apiSavedEmpty: '已保存，API Key 为空。',
    apiSaveBubble: 'API 配置已保存',
    apiSaveEmptyBubble: 'API 配置已保存，请稍后填写 Key',
    saveFailed: '保存失败',
    apiSaveFailedBubble: 'API 配置保存失败',
    editMemoryPrompt: '编辑记忆内容：',
    memoryCannotBeEmptyStatus: '记忆内容不能为空。',
    memoryCannotBeEmptyBubble: '记忆内容不能为空',
    memoryTooLong: '记忆内容不能超过 300 字。',
    memoryUpdated: '记忆已更新。',
    updateMemoryFailed: '更新记忆失败。',
    deleteMemoryConfirm: '确定删除这条记忆吗？',
    memoryDeleted: '记忆已删除。',
    deleteMemoryFailed: '删除记忆失败。',
    clearTypeConfirm: '确定清空【{label}】吗？此操作不可恢复。',
    memoryTypeCleared: '{label}已清空：{count} 条',
    clearMemoriesFailed: '清空记忆失败。',
    clearAllConfirmFirst: '确定清空全部记忆吗？包括用户记忆、长期记忆和短期记忆。',
    clearAllConfirmSecond: '请再次确认：全部记忆将被永久删除，是否继续？',
    allMemoryCleared: '全部记忆已清空：{count} 条',
    clearAllFailed: '清空全部记忆失败。',
    stateLoadFailed: '状态加载失败。',
    shortTermExpiredCleared: '已清理过期短期记忆：{count} 条',
    clearExpiredFailed: '清理过期短期记忆失败。',
    clearFailedBubble: '清理失败',
    longTermMemorySaved: '好的，我会记得这件事。',
    userMemorySaved: '我记住啦。',
    thinking: '我想一下...',
    emptyReply: '我还没想好怎么回答呢。',
    apiFailed: '连接 API 失败了，请检查 Key 或网络。',
    reminderMinutesSet: '已改为 {minutes} 分钟提醒一次',
    startupBubble: '桌宠框架测试版已启动',
    ariaStage: 'Pet Framework 桌宠',
    ariaApiPanel: 'API 设置',
    ariaChatPanel: 'Pet Framework 聊天',
    ariaStatePanel: 'Pet Framework 状态与记忆'
  },
  en: {
    api: 'API',
    apiSettings: 'API Settings',
    chat: 'Chat',
    state: 'State',
    frameworkNotice: 'Pet Framework Test Mode\nReplace animation assets and character config to create a new pet.',
    languageToggle: '中 / EN',
    endpoint: 'Endpoint',
    model: 'Model',
    drinkReminderLabel: 'Drink reminder',
    nightReminderLabel: 'Good night reminder',
    drinkReminderDefault: 'Time to drink some water. Take care of yourself.',
    nightReminderDefault: 'It’s late. Get some rest. Good night.',
    drinkReminderPlaceholder: 'Leave empty to use the default drink reminder',
    nightReminderPlaceholder: 'Leave empty to use the default good night reminder',
    save: 'Save',
    cancel: 'Cancel',
    clear: 'Clear',
    clearExpired: 'Clear expired',
    clearAllMemories: 'Clear all memories',
    chatPlaceholder: 'Say something to Roxy',
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
    content.textContent = memory.content || t('empty');

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
    let memoryIntent = { matched: false };
    try {
      memoryIntent = await window.petAPI?.detectExplicitMemoryIntent?.(message) || { matched: false };
    } catch {
      memoryIntent = { matched: false };
    }

    if (memoryIntent.matched) {
      pushChat('user', message, { excludeFromAi: true });
      await window.petAPI?.addMemory?.(memoryIntent.type, memoryIntent.content, {
        source: 'user_explicit',
        tags: memoryIntent.tags || [],
        reminder: memoryIntent.reminder || undefined
      });
      const confirmation = memoryIntent.type === 'longTerm'
        ? t('longTermMemorySaved')
        : t('userMemorySaved');
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

apiSettings.addEventListener('click', openApiPanel);
apiClose.addEventListener('click', closeApiPanel);
apiSave.addEventListener('click', () => saveApiSettings(false));
apiClearKey.addEventListener('click', () => saveApiSettings(true));
chatToggle.addEventListener('click', openChatPanel);
chatClose.addEventListener('click', closeChatPanel);
chatForm.addEventListener('submit', sendChatMessage);
stateToggle.addEventListener('click', openStatePanel);
stateClose.addEventListener('click', closeStatePanel);
languageToggle.addEventListener('click', toggleLanguage);
clearExpiredShortTerm.addEventListener('click', async () => {
  try {
    const result = await window.petAPI?.clearExpiredShortTermMemories?.();
    setStateStatus(t('shortTermExpiredCleared', { count: result?.removed || 0 }));
    await loadStatePanel();
  } catch {
    setStateStatus(t('clearExpiredFailed'));
    showBubble(t('clearFailedBubble'), 5000);
  }
});
clearUserMemory.addEventListener('click', () => clearMemoryType('user'));
clearLongTermMemory.addEventListener('click', () => clearMemoryType('longTerm'));
clearShortTermMemory.addEventListener('click', () => clearMemoryType('shortTerm'));
clearAllMemory.addEventListener('click', clearAllMemoryTypes);

stage.addEventListener('pointerdown', startDragAnimation);
window.addEventListener('pointerup', stopDragAnimation);
window.addEventListener('blur', stopDragAnimation);
document.addEventListener('mouseleave', stopDragAnimation);

window.petAPI?.onHydrateNow(remindHydration);
window.petAPI?.onNightNow(nightReminder);
window.petAPI?.onSetState(setState);
window.petAPI?.onSetScale((nextScale) => applyScale(nextScale));
window.petAPI?.onDragDirection((direction) => {
  if (!appVisible) return;
  lastDirection = direction === 'left' ? 'left' : 'right';
  dragAnimating = true;
  clearTimeout(dragReturnTimer);
  clearRestoreTimers();
  setState(lastDirection === 'left' ? 'running-left' : 'running-right');
});
window.petAPI?.onSetReminderMinutes((minutes) => {
  reminderMinutes = minutes;
  scheduleReminder();
  showBubble(t('reminderMinutesSet', { minutes }), 5000);
  setState('review');
  clearRestoreTimers();
  restoreTimers = [setTimeout(() => setState('idle'), 4500)];
});
window.petAPI?.onVisibilityMode(setVisibilityMode);
window.petAPI?.onShowApiSettings(openApiPanel);

applyPetProfile();
applyLanguage();
applyScale(scale);
restartAnimation();
scheduleReminder();
startClockWatcher();
setTimeout(() => showBubble(t('startupBubble'), 7000), 1200);
