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
  getApiConfig: () => ipcRenderer.invoke('api-config-get'),
  saveApiConfig: (config) => ipcRenderer.invoke('api-config-save', config),
  sendChat: (payload) => ipcRenderer.invoke('chat-send', payload),
  getPetData: () => ipcRenderer.invoke('pet-data:get'),
  updatePetData: (data) => ipcRenderer.invoke('pet-data:update', data),
  listMemories: (type) => ipcRenderer.invoke('memory:list', type),
  addMemory: (type, content, options) => ipcRenderer.invoke('memory:add', type, content, options),
  updateMemory: (type, id, patch) => ipcRenderer.invoke('memory:update', type, id, patch),
  deleteMemory: (type, id) => ipcRenderer.invoke('memory:delete', type, id),
  clearExpiredShortTermMemories: () => ipcRenderer.invoke('memory:clear-expired-short-term'),
  clearMemories: (type) => ipcRenderer.invoke('memory:clear-type', type),
  clearAllMemories: () => ipcRenderer.invoke('memory:clear-all'),
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
  stopDragAnimation: () => ipcRenderer.send('drag-animation-stop')
});
