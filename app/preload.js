const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petAPI', {
  onHydrateNow: (callback) => ipcRenderer.on('hydrate-now', callback),
  onNightNow: (callback) => ipcRenderer.on('night-now', callback),
  onSetState: (callback) => ipcRenderer.on('set-state', (_event, state) => callback(state)),
  onSetScale: (callback) => ipcRenderer.on('set-scale', (_event, scale) => callback(scale)),
  onDragDirection: (callback) => ipcRenderer.on('drag-direction', (_event, direction) => callback(direction)),
  onSetReminderMinutes: (callback) => ipcRenderer.on('set-reminder-minutes', (_event, minutes) => callback(minutes)),
  onVisibilityMode: (callback) => ipcRenderer.on('visibility-mode', (_event, visible) => callback(visible)),
  onShowApiSettings: (callback) => ipcRenderer.on('show-api-settings', callback),
  // 主动事件（提醒到期、日报、问候）由 GraphDispatcher 经 callback 推送
  onProactiveEvent: (callback) => ipcRenderer.on('proactive-event', (_event, dto) => callback(dto)),
  // 确认主动事件气泡已显示（ACK），通知主进程投递成功
  ackProactiveEvent: (occurrenceId) => ipcRenderer.invoke('proactive-event:ack', occurrenceId),
  // Onboarding 请求（首次配置时由 Graph 推送给用户回答）
  onOnboardingRequest: (callback) => ipcRenderer.on('onboarding-request', (_event, dto) => callback(dto)),
  // 角色渲染配置（Main 推送角色包 spritesheet 配置，renderer 替换当前 sprite）
  onCharacterConfig: (callback) => ipcRenderer.on('character-config', (_event, config) => callback(config)),
  // 提交 onboarding 用户偏好，恢复 OnboardingGraph
  submitOnboardingPreferences: (preferences) => ipcRenderer.invoke('onboarding-submit', preferences),
  getApiConfig: () => ipcRenderer.invoke('api-config-get'),
  saveApiConfig: (config) => ipcRenderer.invoke('api-config-save', config),
  sendChat: (payload) => ipcRenderer.invoke('chat-send', payload),
  safeShell: {
    interpret: (text) => ipcRenderer.invoke('safe-shell:interpret', text),
    confirm: (id) => ipcRenderer.invoke('safe-shell:confirm', id),
    cancel: (id) => ipcRenderer.invoke('safe-shell:cancel', id),
    getSettings: () => ipcRenderer.invoke('safe-shell:get-settings'),
    setEnabled: (enabled) => ipcRenderer.invoke('safe-shell:set-enabled', enabled)
  },
  getPetData: () => ipcRenderer.invoke('pet-data:get'),
  updatePetData: (data) => ipcRenderer.invoke('pet-data:update', data),
  listMemories: (type) => ipcRenderer.invoke('memory:list', type),
  addMemory: (type, content, options) => ipcRenderer.invoke('memory:add', type, content, options),
  updateMemory: (type, id, patch) => ipcRenderer.invoke('memory:update', type, id, patch),
  deleteMemory: (type, id) => ipcRenderer.invoke('memory:delete', type, id),
  clearExpiredShortTermMemories: () => ipcRenderer.invoke('memory:clear-expired-short-term'),
  clearMemories: (type) => ipcRenderer.invoke('memory:clear-type', type),
  clearAllMemories: () => ipcRenderer.invoke('memory:clear-all'),
  exportMemories: () => ipcRenderer.invoke('memory:export'),
  getArchitectureStatus: () => ipcRenderer.invoke('architecture:get-status'),
  triggerDigest: () => ipcRenderer.invoke('architecture:trigger-digest'),
  listReminders: () => ipcRenderer.invoke('reminder:list'),
  deleteReminder: (id) => ipcRenderer.invoke('reminder:delete', id),
  detectExplicitMemoryIntent: (text) => ipcRenderer.invoke('memory:detect-explicit-intent', text),
  analyzeAndApplyMemory: (text) => ipcRenderer.invoke('memory:analyze-and-apply', text),
  getAffection: () => ipcRenderer.invoke('affection:get'),
  setAffectionScore: (score, reason) => ipcRenderer.invoke('affection:set-score', score, reason),
  adjustAffection: (delta, eventType, reason, options) => (
    ipcRenderer.invoke('affection:adjust', delta, eventType, reason, options)
  ),
  detectAffectionEvent: (text) => ipcRenderer.invoke('affection:detect-event', text),
  focusWindow: () => ipcRenderer.invoke('window:focus'),
  setWindowScale: (scale) => ipcRenderer.invoke('set-window-scale', scale),
  startDragAnimation: () => ipcRenderer.send('drag-animation-start'),
  stopDragAnimation: () => ipcRenderer.send('drag-animation-stop'),
  // 气泡空间扩展：reminder bubble 显示时请求扩大窗口宽度，消失后恢复
  requestBubbleSpace: (extraWidth) => ipcRenderer.send('request-bubble-space', extraWidth),
  releaseBubbleSpace: () => ipcRenderer.send('release-bubble-space'),
  // 计划面板空间扩展：进入计划模式时请求扩大窗口宽度，退出后恢复
  requestPlanningSpace: (extraWidth) => ipcRenderer.send('request-planning-space', extraWidth),
  releasePlanningSpace: () => ipcRenderer.send('release-planning-space'),
  // 计划任务（Planning Bubble）
  startPlanningMode: () => ipcRenderer.invoke('planning:start'),
  submitPlanningMessage: (text) => ipcRenderer.invoke('planning:submit-message', text),
  confirmPlan: () => ipcRenderer.invoke('planning:confirm'),
  revisePlan: (feedback) => ipcRenderer.invoke('planning:submit-message', feedback),
  updateDraftPlan: (payload) => ipcRenderer.invoke('planning:update-draft', payload),
  toggleTaskCompletion: (taskId) => ipcRenderer.invoke('planning:toggle-task', taskId),
  getActivePlan: () => ipcRenderer.invoke('planning:get-active'),
  getPlanningModelInfo: () => ipcRenderer.invoke('planning:get-model-info'),
  setPlanningModel: (modelId) => ipcRenderer.invoke('planning:set-model', modelId),
  getPlanningTrace: () => ipcRenderer.invoke('planning:get-trace'),
  onPlanPublished: (callback) => ipcRenderer.on('planning:plan-published', (_event, plan) => callback(plan))
});
