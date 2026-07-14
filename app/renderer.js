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
const planningModelInput = document.getElementById('planningModelInput');
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
// 计划任务相关 DOM
const planModeToggle = document.getElementById('planModeToggle');
const chatPanelTitle = document.getElementById('chatPanelTitle');
const planningView = document.getElementById('planningView');
const planningConversation = document.getElementById('planningConversation');
const planningModelView = document.getElementById('planningModelView');
const planningTraceView = document.getElementById('planningTraceView');
const planningDraft = document.getElementById('planningDraft');
const planningDraftDate = document.getElementById('planningDraftDate');
const planningDraftTasks = document.getElementById('planningDraftTasks');
const planningActions = document.getElementById('planningActions');
const confirmPlanBtn = document.getElementById('confirmPlanBtn');
const revisePlanInput = document.getElementById('revisePlanInput');
const revisePlanBtn = document.getElementById('revisePlanBtn');
const planningBubble = document.getElementById('planningBubble');
const planBubbleMinimize = document.getElementById('planBubbleMinimize');
const planBubbleTimeline = document.getElementById('planBubbleTimeline');
const planBubbleRestore = document.getElementById('planBubbleRestore');
// 日历相关 DOM（V7 跨日期计划）
const calendarToggle = document.getElementById('calendarToggle');
const calendarPanel = document.getElementById('calendarPanel');
const calendarClose = document.getElementById('calendarClose');
const calendarPrevMonth = document.getElementById('calendarPrevMonth');
const calendarNextMonth = document.getElementById('calendarNextMonth');
const calendarToday = document.getElementById('calendarToday');
const calendarMonthLabel = document.getElementById('calendarMonthLabel');
const calendarGrid = document.getElementById('calendarGrid');
const calendarDetail = document.getElementById('calendarDetail');
const calendarDetailDate = document.getElementById('calendarDetailDate');
const calendarDetailStatus = document.getElementById('calendarDetailStatus');
const calendarDetailTasks = document.getElementById('calendarDetailTasks');
const calendarDetailClose = document.getElementById('calendarDetailClose');
const calendarEditPlan = document.getElementById('calendarEditPlan');
const calendarCreatePlan = document.getElementById('calendarCreatePlan');
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
const resetCharacterBtn = document.getElementById('resetCharacterBtn');
const resetUserDataBtn = document.getElementById('resetUserDataBtn');
const materialLibraryBtn = document.getElementById('materialLibraryBtn');
const materialPanel = document.getElementById('materialPanel');
const materialBack = document.getElementById('materialBack');
const importMaterialBtn = document.getElementById('importMaterialBtn');
const materialList = document.getElementById('materialList');
const restoreDefaultMaterialBtn = document.getElementById('restoreDefaultMaterialBtn');
// 架构状态与提醒区域
const archStatusView = document.getElementById('archStatusView');
const reminderList = document.getElementById('reminderList');
const refreshReminders = document.getElementById('refreshReminders');
const triggerDailyDigestBtn = document.getElementById('triggerDailyDigest');
const triggerReminderCheckBtn = document.getElementById('triggerReminderCheck');
// Onboarding 首次配置面板
const onboardingPanel = document.getElementById('onboardingPanel');
const onboardingClose = document.getElementById('onboardingClose');
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
// V8 角色初始化向导元素
const onboardingV8 = document.getElementById('onboardingV8');
const onboardingStageBadge = document.getElementById('onboardingStageBadge');
const onboardingV8Collecting = document.getElementById('onboardingV8Collecting');
const onboardingV8Review = document.getElementById('onboardingV8Review');
const onboardingV8Busy = document.getElementById('onboardingV8Busy');
const onboardingV8Error = document.getElementById('onboardingV8Error');
const onboardingV8Locked = document.getElementById('onboardingV8Locked');
const onboardingV8Chat = document.getElementById('onboardingV8Chat');
const onboardingV8Form = document.getElementById('onboardingV8Form');
const onboardingV8Answer = document.getElementById('onboardingV8Answer');
const onboardingV8Summary = document.getElementById('onboardingV8Summary');
const onboardingV8ReviewForm = document.getElementById('onboardingV8ReviewForm');
const onboardingV8Feedback = document.getElementById('onboardingV8Feedback');
const onboardingV8ReviseBtn = document.getElementById('onboardingV8ReviseBtn');
const onboardingV8ErrorText = document.getElementById('onboardingV8ErrorText');
const onboardingV8RetryBtn = document.getElementById('onboardingV8RetryBtn');
const onboardingV8ConfigureApiBtn = document.getElementById('onboardingV8ConfigureApiBtn');
const onboardingV8DismissBtn = document.getElementById('onboardingV8DismissBtn');
const onboardingV8CloseBtn = document.getElementById('onboardingV8CloseBtn');
// V9 问题卡片相关元素
const onboardingV8Guide = document.getElementById('onboardingV8Guide');
const onboardingV8Cards = document.getElementById('onboardingV8Cards');
const onboardingV8SubmitCardsBtn = document.getElementById('onboardingV8SubmitCards');
const onboardingV8SummaryBlocks = document.getElementById('onboardingV8SummaryBlocks');
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
let scale = Number(localStorage.getItem(lsKey('scale')) || '0.826');
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
  if (!element) return;
  const textSpan = element.querySelector('span:not(.icon)');
  if (textSpan) {
    textSpan.textContent = textValue;
  } else {
    element.textContent = textValue;
  }
}

function applyPetProfile() {
  document.title = petProfile.displayName || 'Pet Framework';
  pet.setAttribute('aria-label', petProfile.characterName || 'Pet');
  // 同步更新聊天输入框 placeholder，使角色初始化后使用新角色名
  chatInput.placeholder = t('chatPlaceholder', { name: petProfile.characterName || 'Pet' });
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
  document.documentElement.classList.toggle('scale-small', scale < 0.85);
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
  if (bubbles.length > 3) {
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
  closeMaterialPanel();
  closeCalendarPanel();
  closeOnboardingPanel();
  closeChatPanel();
  closeStatePanel();
  window.petAPI?.requestChatSpace?.(PANEL_EXTRA_HEIGHT);
  const config = await window.petAPI?.getApiConfig?.();
  apiEndpoint.value = config?.endpoint || 'https://api.deepseek.com/v1/chat/completions';
  apiModel.value = config?.model || 'deepseek-v4-flash';
  apiKey.value = '';
  // 加载 planningModel 配置值（从 app_settings.model_alias_planning 读取）
  try {
    const modelInfo = await window.petAPI?.getPlanningModelInfo?.();
    planningModelInput.value = modelInfo?.ok?.configured || modelInfo?.info?.configured || 'deepseek-v4-pro';
  } catch {
    planningModelInput.value = 'deepseek-v4-pro';
  }
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
  const wasOpen = !apiPanel.classList.contains('hidden');
  apiPanel.classList.add('hidden');
  if (wasOpen) window.petAPI?.releaseChatSpace?.();
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
    // 同步保存 planningModel 配置（持久化到 app_settings.model_alias_planning）
    const planningModelValue = planningModelInput.value.trim();
    if (planningModelValue) {
      try {
        await window.petAPI?.setPlanningModel?.(planningModelValue);
      } catch (error) {
        // API Key 已经由上一步成功保存。计划模型别名属于可选配置，
        // 不能因为它保存失败就阻断角色初始化或把整个 API 保存显示为失败。
        console.warn('Planning model setting save failed; API configuration remains valid.', error);
        showBubble('API 已保存，但计划模型设置暂未更新。', 5000);
      }
    }
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
    if (config?.hasApiKey && onboardingV8State.phase === 'api-required') {
      showBubble('API 已保存，现在可以开始角色初始化。', 5000);
      // API 缺失期间的只读启动同步可能已经触碰过 onboarding 状态。
      // 保存 Key 后必须强制重新从后端恢复/启动，不能把旧的 renderer 缓存
      // 当成“向导已经初始化”，否则只会显示外层面板而没有问题卡片。
      onboardingV8State._v8Initialized = false;
      await openOnboardingPanel();
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
  // W4: 未完成角色初始化的用户不得进入聊天
  // onboardingV8State.phase === 'locked' 表示已完成向导（缓存状态）
  // 否则引导用户去完成向导，不打开聊天面板
  if (onboardingV8State.phase !== 'locked') {
    showBubble('请先完成角色初始化向导后再开始聊天', 5000);
    openOnboardingPanel('请先完成角色初始化');
    return;
  }
  closeMaterialPanel();
  closeCalendarPanel();
  closeOnboardingPanel();
  closeApiPanel();
  closeStatePanel();
  if (!planningMode) {
    window.petAPI?.requestChatSpace?.(CHAT_EXTRA_HEIGHT);
  }
  chatPanel.classList.remove('hidden');
  focusChatInput();
}

function closeChatPanel() {
  const wasOpen = !chatPanel.classList.contains('hidden');
  chatPanel.classList.add('hidden');
  if (planningMode) {
    exitPlanningMode(false);
  } else if (wasOpen) {
    window.petAPI?.releaseChatSpace?.();
  }
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

/**
 * 重设人物性格：解锁当前角色、清除 onboarding 状态、重新启动向导。
 * 需要二次确认，因为会清除当前角色配置。
 */
async function resetCharacter() {
  const firstOk = await showConfirmDialog('确定要重设人物性格吗？这将清除当前角色的所有配置，你需要重新完成初始化向导。');
  if (!firstOk) return;
  const secondOk = await showConfirmDialog('再次确认：重设后无法恢复当前角色配置，是否继续？');
  if (!secondOk) return;
  try {
    const resp = await window.petAPI?.onboardingReset?.();
    if (!resp) {
      showBubble('重设失败：未收到响应', 5000);
      return;
    }
    if (resp.phase === 'error') {
      showBubble(`重设失败：${resp.errorReason || '未知错误'}`, 5000);
      return;
    }
    // 重设成功，切换到 onboarding 面板
    showBubble('已重设人物性格，请重新完成初始化', 4000);
    // 关闭状态面板，打开 onboarding 面板
    closeStatePanel();
    closeCalendarPanel();
    closeApiPanel();
    closeChatPanel();
    window.petAPI?.requestChatSpace?.(PANEL_EXTRA_HEIGHT);
    if (onboardingPanel) onboardingPanel.classList.remove('hidden');
    // 重置 V8 状态，确保重新渲染
    onboardingV8State._v8Initialized = true;
    onboardingV8State.currentQuestions = [];
    onboardingV8State.cardAnswers = {};
    onboardingV8State.cardsRendered = false;
    onboardingV8State.lastPendingQuestion = '';
    onboardingV8State.lastOperation = null;
    onboardingV8State.lastAnswer = '';
    onboardingV8State.lastRevision = 0;
    onboardingV8State.pendingBusy = false;
    // P2: 重置时清除本地 debounce timer（reset IPC 会消费 checkpoint，服务端 pendingAnswers 已失效）
    clearPendingAnswersTimer();
    // 直接用响应数据渲染
    handleOnboardingV8Response(resp);
  } catch (e) {
    showBubble(`重设失败：${e?.message || e}`, 5000);
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
    refreshPlanningModelInfo();
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
  closeMaterialPanel();
  closeCalendarPanel();
  closeOnboardingPanel();
  closeApiPanel();
  closeChatPanel();
  window.petAPI?.requestChatSpace?.(PANEL_EXTRA_HEIGHT);
  statePanel.classList.remove('hidden');
  await loadStatePanel();
}

function closeStatePanel() {
  const wasOpen = !statePanel.classList.contains('hidden');
  statePanelLoadToken += 1;
  if (statePanel.contains(document.activeElement)) {
    document.activeElement.blur();
  }
  statePanel.classList.add('hidden');
  if (wasOpen) window.petAPI?.releaseChatSpace?.();
}

function renderMaterialLibrary(library) {
  if (!materialList) return;
  const materials = Array.isArray(library?.materials) ? library.materials : [];
  const activeId = library?.activeId || null;
  materialList.innerHTML = '';

  if (materials.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'material-list__empty';
    empty.textContent = '还没有导入素材。点击上方加号选择动作图集。';
    materialList.appendChild(empty);
  }

  for (const material of materials) {
    const item = document.createElement('div');
    item.className = 'material-item';
    const info = document.createElement('div');
    info.className = 'material-item__info';
    const title = document.createElement('strong');
    title.textContent = material.name || '未命名动作图集';
    const meta = document.createElement('small');
    meta.textContent = `${material.width || 1536} × ${material.height || 1872}${material.id === activeId ? ' · 当前应用' : ''}`;
    info.appendChild(title);
    info.appendChild(meta);

    const apply = document.createElement('button');
    apply.type = 'button';
    apply.textContent = material.id === activeId ? '已应用' : '应用';
    apply.disabled = material.id === activeId;
    apply.addEventListener('click', async () => {
      apply.disabled = true;
      const result = await window.petAPI?.materials?.apply?.(material.id);
      if (!result?.ok) {
        showBubble(result?.error || '应用素材失败。', 5000);
      } else {
        showBubble(`已应用「${material.name || '动作图集'}」。`, 3000);
      }
      await loadMaterialLibrary();
    });
    item.appendChild(info);
    item.appendChild(apply);
    materialList.appendChild(item);
  }

  if (restoreDefaultMaterialBtn) restoreDefaultMaterialBtn.disabled = !activeId;
}

async function loadMaterialLibrary() {
  try {
    const library = await window.petAPI?.materials?.list?.();
    renderMaterialLibrary(library);
  } catch {
    if (materialList) {
      materialList.innerHTML = '<div class="material-list__empty">无法读取素材库。</div>';
    }
  }
}

async function openMaterialPanel() {
  closeCalendarPanel();
  closeOnboardingPanel();
  closeApiPanel();
  closeChatPanel();
  closeStatePanel();
  window.petAPI?.requestChatSpace?.(PANEL_EXTRA_HEIGHT);
  materialPanel?.classList.remove('hidden');
  await loadMaterialLibrary();
}

function closeMaterialPanel() {
  const wasOpen = materialPanel && !materialPanel.classList.contains('hidden');
  if (materialPanel?.contains(document.activeElement)) document.activeElement.blur();
  materialPanel?.classList.add('hidden');
  if (wasOpen) window.petAPI?.releaseChatSpace?.();
}

async function returnToStateFromMaterialPanel() {
  closeMaterialPanel();
  await openStatePanel();
}

async function importMaterial() {
  if (!importMaterialBtn) return;
  importMaterialBtn.disabled = true;
  try {
    const result = await window.petAPI?.materials?.importSpriteSheet?.();
    if (!result?.ok && !result?.cancelled) {
      showBubble(result?.error || '导入素材失败。', 6000);
    } else if (result?.ok) {
      showBubble(`已导入并应用「${result.material?.name || '动作图集'}」。`, 3500);
    }
    await loadMaterialLibrary();
  } catch {
    showBubble('导入素材失败。', 5000);
  } finally {
    importMaterialBtn.disabled = false;
  }
}

async function restoreDefaultMaterial() {
  const ok = await showConfirmDialog('还原默认 Blue 外观吗？已导入的素材会保留在素材库中。');
  if (!ok) return;
  const result = await window.petAPI?.materials?.restoreDefault?.();
  if (!result?.ok) {
    showBubble(result?.error || '还原默认素材失败。', 5000);
    return;
  }
  showBubble('已还原默认 Blue 外观。', 3000);
  await loadMaterialLibrary();
}

async function resetUserData() {
  const firstOk = await showConfirmDialog(
    '清除所有用户数据并恢复到 LangGraph 的首次初始化吗？这会删除聊天、记忆、计划、提醒、角色初始化记录、API 配置和你导入的素材；默认 Blue 素材不会删除。'
  );
  if (!firstOk) return;
  const secondOk = await showConfirmDialog('再次确认：应用将立即重启，并从首次初始化开始。是否继续？');
  if (!secondOk) return;
  resetUserDataBtn.disabled = true;
  try {
    const result = await window.petAPI?.resetUserData?.();
    if (!result?.ok) {
      resetUserDataBtn.disabled = false;
      showBubble(result?.error || '恢复初始状态失败。', 6000);
      return;
    }
    showBubble('正在清除用户数据并重新启动…', 3000);
  } catch {
    resetUserDataBtn.disabled = false;
    showBubble('恢复初始状态失败。', 6000);
  }
}

// ===== Onboarding 首次配置面板 =====
// V10：改为 async，先异步确认状态再决定是否显示面板。
// 目的：避免已锁定角色在冷启动时先闪现“角色配置已锁定”界面再隐藏。
async function hasOnboardingApiKey() {
  try {
    const config = await window.petAPI?.getApiConfig?.();
    return Boolean(config?.hasApiKey);
  } catch {
    return false;
  }
}

async function openOnboardingApiSetup() {
  onboardingV8State.phase = 'api-required';
  onboardingV8State.pendingBusy = false;
  clearPendingAnswersTimer();
  showBubble('请先配置 API Key；保存后会自动进入角色初始化。', 6500);
  await openApiPanel();
}

async function openOnboardingPanel(message) {
  closeMaterialPanel();
  closeCalendarPanel();
  closeApiPanel();
  closeChatPanel();
  closeStatePanel();
  // 重置会清除 API 配置。没有 Key 时不得自动启动需要模型的 OnboardingGraph，
  // 先进入可关闭的 API 面板，保存成功后再继续初始化。
  if (!(await hasOnboardingApiKey())) {
    await openOnboardingApiSetup();
    return;
  }
  if (message && onboardingMessage) {
    onboardingMessage.textContent = message;
  }
  // V8 激活时隐藏旧版表单，避免与向导界面重叠
  if (onboardingForm) onboardingForm.classList.add('hidden');
  if (onboardingMessage) onboardingMessage.classList.add('hidden');

  // V8：首次打开面板时，先查询后端状态，确认不是已锁定角色再展示面板
  const shouldRefreshOnboarding = onboardingV8 && (
    !onboardingV8State._v8Initialized
    || onboardingV8State.phase === 'api-required'
    || onboardingV8State.phase === 'error'
  );
  if (shouldRefreshOnboarding) {
    onboardingV8State._v8Initialized = true;
    setOnboardingV8Phase('busy');
    try {
      const resp = await window.petAPI?.onboardingGetState?.();
      // 如果已锁定（已完成），直接同步状态并放弃展示面板
      if (resp && (resp.isCompleted || resp.phase === 'locked')) {
        onboardingV8State.phase = 'locked';
        setOnboardingV8Phase('locked');
        setOnboardingV8StageBadge(null, 1);
        window.petAPI?.releaseChatSpace?.();
        return;
      }
      // 有进行中的 checkpoint（提问或 review），才展示面板并恢复
      if (resp && (resp.pendingQuestion || resp.summaryDisplayText || resp.phase === 'review')) {
        window.petAPI?.requestChatSpace?.(PANEL_EXTRA_HEIGHT);
        if (onboardingPanel) onboardingPanel.classList.remove('hidden');
        handleOnboardingV8Response(resp);
        return;
      }
      // 否则启动新向导，展示面板
      window.petAPI?.requestChatSpace?.(PANEL_EXTRA_HEIGHT);
      if (onboardingPanel) onboardingPanel.classList.remove('hidden');
      startOnboardingV8();
      return;
    } catch {
      // get-state 失败，回退到展示面板并尝试启动
      window.petAPI?.requestChatSpace?.(PANEL_EXTRA_HEIGHT);
      if (onboardingPanel) onboardingPanel.classList.remove('hidden');
      startOnboardingV8();
      return;
    }
  }

  // V8 已初始化或非 V8 流程：直接显示面板
  // 兜底防御：若已锁定则不再展示面板，避免状态异常时重复弹出
  if (onboardingV8 && onboardingV8State.phase === 'locked') {
    window.petAPI?.releaseChatSpace?.();
    return;
  }
  window.petAPI?.requestChatSpace?.(PANEL_EXTRA_HEIGHT);
  if (onboardingPanel) onboardingPanel.classList.remove('hidden');
}

function closeOnboardingPanel() {
  if (onboardingPanel && !onboardingPanel.classList.contains('hidden')) {
    if (onboardingPanel.contains(document.activeElement)) {
      document.activeElement.blur();
    }
    onboardingPanel.classList.add('hidden');
    window.petAPI?.releaseChatSpace?.();
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

// ===== V8 角色初始化向导 =====

/** V8 向导客户端状态：当前 phase、最近响应、最近一次显示的问题 */
const onboardingV8State = {
  phase: 'busy',
  revision: 0,
  traceId: '',
  lastPendingQuestion: '',
  pendingBusy: false,
  // I6: 保存上次操作用于重试
  lastOperation: null,  // 'answer' | 'feedback' | 'confirm' | 'card-answers' | null
  lastAnswer: '',       // 上次提交的 answer 或 feedback
  lastRevision: 0,      // 上次操作时的 revision
  // V9: 当前轮问题卡片（来自最近响应）
  currentQuestions: [],
  // V9: 当前轮用户的卡片回答（本地状态，提交前汇总）
  cardAnswers: {},
  // V9: 标记是否已渲染过当前轮卡片（避免重复渲染）
  cardsRendered: false
};

// ===== P2: pendingAnswers 临时保存（debounce 600ms） =====
const PENDING_ANSWERS_DEBOUNCE_MS = 600;
let pendingAnswersTimer = null;
// 标记是否正在恢复 pendingAnswers，恢复过程中触发的 input 事件不应再调度保存
let isRestoringPendingAnswers = false;

/** 阶段中文标签 */
const ONBOARDING_STAGE_LABELS = {
  basic: '基础设定',
  speaking: '说话风格',
  relationship: '关系边界',
  taboos: '禁区与忌讳',
  review: '最终确认'
};

/** 简易 HTML 转义 */
function escapeOnboardingV8Html(text) {
  if (text == null) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 切换 V8 阶段视图 */
function setOnboardingV8Phase(phase) {
  onboardingV8State.phase = phase;
  // V8 阶段切换时确保旧版表单/提示不显示，防止布局重叠
  if (onboardingForm) onboardingForm.classList.add('hidden');
  if (onboardingMessage) onboardingMessage.classList.add('hidden');
  const phases = [onboardingV8Collecting, onboardingV8Review, onboardingV8Busy, onboardingV8Error, onboardingV8Locked];
  for (const el of phases) {
    if (el) el.classList.add('hidden');
  }
  const target = {
    collecting: onboardingV8Collecting,
    review: onboardingV8Review,
    busy: onboardingV8Busy,
    error: onboardingV8Error,
    locked: onboardingV8Locked
  }[phase];
  if (target) target.classList.remove('hidden');
}

/** 显示阶段徽章 */
function setOnboardingV8StageBadge(stage, progress) {
  if (!onboardingStageBadge) return;
  if (!stage) {
    onboardingStageBadge.classList.add('hidden');
    onboardingStageBadge.textContent = '';
    return;
  }
  const label = ONBOARDING_STAGE_LABELS[stage] || stage;
  const pct = Math.round((progress || 0) * 100);
  onboardingStageBadge.textContent = `${label} · ${pct}%`;
  onboardingStageBadge.classList.remove('hidden');
}

/** 追加一条聊天消息到 V8 collecting 区 */
function appendOnboardingV8ChatMessage(role, text) {
  if (!onboardingV8Chat) return;
  const msg = document.createElement('div');
  msg.className = `onboarding-v8__chat-msg onboarding-v8__chat-msg--${role}`;
  msg.textContent = text || '';
  onboardingV8Chat.appendChild(msg);
  // 滚动到底部
  onboardingV8Chat.scrollTop = onboardingV8Chat.scrollHeight;
}

// ===== P2: pendingAnswers 收集/保存/恢复/清除 =====

/**
 * 从当前 UI DOM 收集所有卡片的未提交选择，返回 PendingAnswerEntry[]。
 * 安全约束：只收集 questionId、selectedOptionIds、customText、usedSuggestedAnswer，
 * 不收集 selectedValues（后端从 checkpoint 的 question.options 重新映射值）。
 */
function collectPendingAnswers() {
  const questions = onboardingV8State.currentQuestions || [];
  const answers = [];
  for (const q of questions) {
    if (!q || !q.id) continue;
    const card = onboardingV8Cards?.querySelector(`.onboarding-v8__card[data-question-id="${CSS.escape(q.id)}"]`);
    if (!card) continue;

    // 收集选中选项 ID
    const selectedButtons = card.querySelectorAll('.onboarding-v8__option.is-selected');
    const selectedOptionIds = Array.from(selectedButtons).map((b) => b.dataset.optionId).filter(Boolean);

    // 收集文本输入
    let customText = '';
    const textInput = card.querySelector('.onboarding-v8__card-input:not(.onboarding-v8__card-input--other)');
    const otherInput = card.querySelector('.onboarding-v8__card-input--other');
    if (textInput && textInput.value.trim()) {
      customText = textInput.value.trim();
    }
    if (otherInput && otherInput.value.trim()) {
      customText = otherInput.value.trim();
    }

    const usedSuggestedAnswer = !!(textInput && textInput.dataset.isSuggestion === '1');

    // 仅当有内容时才收集
    if (selectedOptionIds.length > 0 || customText) {
      const entry = { questionId: q.id };
      if (selectedOptionIds.length > 0) entry.selectedOptionIds = selectedOptionIds;
      if (customText) entry.customText = customText;
      if (usedSuggestedAnswer) entry.usedSuggestedAnswer = true;
      answers.push(entry);
    }
  }
  return answers;
}

/**
 * 调度 pendingAnswers 保存（600ms debounce）。
 * 输入变化时调用，避免频繁 IPC。恢复期间不调度。
 */
function schedulePendingAnswersSave() {
  if (isRestoringPendingAnswers) return;
  if (pendingAnswersTimer) clearTimeout(pendingAnswersTimer);
  pendingAnswersTimer = setTimeout(() => {
    pendingAnswersTimer = null;
    const answers = collectPendingAnswers();
    // 即使 answers 为空也保存（用户清空所有选择时需要持久化清空状态）
    try {
      window.petAPI?.onboardingSavePendingAnswers?.(answers, onboardingV8State.revision);
    } catch (e) {
      // 保存失败不影响 UI，下次输入变化会再次尝试
      console.warn('[pendingAnswers] save failed:', e?.message || e);
    }
  }, PENDING_ANSWERS_DEBOUNCE_MS);
}

/**
 * 清除本地 debounce timer（不调用 IPC）。
 * 用于阶段切换、错误等不需要显式清除服务端的场景（Graph 保存新 checkpoint 时会自然清除）。
 */
function clearPendingAnswersTimer() {
  if (pendingAnswersTimer) {
    clearTimeout(pendingAnswersTimer);
    pendingAnswersTimer = null;
  }
}

/**
 * 清除 pendingAnswers：清除本地 timer + 调用 IPC 清除服务端。
 * 用于提交成功、reset 等需要显式清除的场景。
 */
function clearPendingAnswers() {
  clearPendingAnswersTimer();
  try {
    window.petAPI?.onboardingClearPendingAnswers?.(onboardingV8State.revision);
  } catch (e) {
    console.warn('[pendingAnswers] clear failed:', e?.message || e);
  }
}

/**
 * 从 IPC 响应恢复 UI 选择状态。
 * 仅在 collecting 阶段、卡片已渲染后调用。
 * 恢复过程中设置 isRestoringPendingAnswers 标志，防止 input 事件触发保存。
 */
function restorePendingAnswers(pendingAnswers) {
  if (!pendingAnswers || !Array.isArray(pendingAnswers.answers) || pendingAnswers.answers.length === 0) {
    return;
  }
  if (!onboardingV8Cards) return;

  isRestoringPendingAnswers = true;
  try {
    for (const entry of pendingAnswers.answers) {
      if (!entry || !entry.questionId) continue;
      const card = onboardingV8Cards.querySelector(`.onboarding-v8__card[data-question-id="${CSS.escape(entry.questionId)}"]`);
      if (!card) continue;

      // 恢复选项选中状态
      if (Array.isArray(entry.selectedOptionIds) && entry.selectedOptionIds.length > 0) {
        const optionButtons = card.querySelectorAll('.onboarding-v8__option');
        optionButtons.forEach((btn) => {
          if (entry.selectedOptionIds.includes(btn.dataset.optionId)) {
            btn.classList.add('is-selected');
          } else {
            btn.classList.remove('is-selected');
          }
        });
      }

      // 恢复文本输入
      if (typeof entry.customText === 'string' && entry.customText) {
        const textInput = card.querySelector('.onboarding-v8__card-input:not(.onboarding-v8__card-input--other)');
        const otherInput = card.querySelector('.onboarding-v8__card-input--other');
        if (textInput) {
          textInput.value = entry.customText;
          if (entry.usedSuggestedAnswer) {
            textInput.dataset.isSuggestion = '1';
            textInput.classList.add('onboarding-v8__card-input--suggestion');
          }
        } else if (otherInput) {
          otherInput.value = entry.customText;
        }
      }

      // 重新收集到 cardAnswers（与 collectOnboardingV8CardAnswer 逻辑一致）
      const question = (onboardingV8State.currentQuestions || []).find((q) => q.id === entry.questionId);
      if (question) {
        const optionsWrap = card.querySelector('.onboarding-v8__options');
        const otherInput = card.querySelector('.onboarding-v8__card-input--other');
        if (optionsWrap || otherInput) {
          collectOnboardingV8CardAnswer(question, optionsWrap, otherInput);
        }
      }
    }
    // 恢复完成后更新提交按钮状态
    updateOnboardingV8SubmitButton();
  } finally {
    isRestoringPendingAnswers = false;
  }
}

/** 处理 V8 IPC 响应，更新 UI 状态 */
function handleOnboardingV8Response(resp) {
  if (!resp) {
    setOnboardingV8Phase('error');
    if (onboardingV8ErrorText) onboardingV8ErrorText.textContent = '未收到响应。';
    return;
  }
  onboardingV8State.revision = resp.revision || 0;
  onboardingV8State.traceId = resp.traceId || '';
  onboardingV8State.pendingBusy = false;

  // 已完成
  if (resp.isCompleted || resp.phase === 'locked') {
    clearPendingAnswersTimer(); // 进入 locked 阶段：清除本地 timer（Graph 已保存新 checkpoint 自然清除 pendingAnswers）
    setOnboardingV8Phase('locked');
    setOnboardingV8StageBadge(null, 1);
    return;
  }

  // 错误
  if (resp.phase === 'error') {
    clearPendingAnswersTimer(); // 错误状态：清除本地 timer，避免错误恢复时误保存
    setOnboardingV8Phase('error');
    if (onboardingV8ErrorText) {
      const reason = resp.errorReason || '未知错误';
      onboardingV8ErrorText.textContent = `初始化遇到问题：${reason}`;
    }
    setOnboardingV8StageBadge(resp.currentStage, resp.completionProgress);
    return;
  }

  // Review 阶段
  if (resp.phase === 'review') {
    clearPendingAnswersTimer(); // 进入 review：清除本地 timer（Graph 已保存新 checkpoint 自然清除 pendingAnswers）
    setOnboardingV8Phase('review');
    setOnboardingV8StageBadge(resp.currentStage, resp.completionProgress);
    // V9: 渲染摘要区块（每块带"修改"按钮）
    renderOnboardingV8SummaryBlocks(resp.summaryDisplayText, resp.currentStage);
    if (onboardingV8Feedback) onboardingV8Feedback.value = '';
    return;
  }

  // Collecting 阶段（默认）
  // 进入新一轮 collecting：清除旧 timer（新一轮问题集不同，旧 pendingAnswers 已失效）
  clearPendingAnswersTimer();
  setOnboardingV8Phase('collecting');
  setOnboardingV8StageBadge(resp.currentStage, resp.completionProgress);

  // V9: 优先使用结构化问题卡片
  const questions = Array.isArray(resp.currentQuestions) ? resp.currentQuestions : [];
  if (questions.length > 0) {
    onboardingV8State.currentQuestions = questions;
    onboardingV8State.cardAnswers = {};
    onboardingV8State.cardsRendered = false;
    renderOnboardingV8Cards(questions);
    // P2: 渲染卡片后恢复 pendingAnswers（从 checkpoint 恢复的未提交选择）
    if (resp.pendingAnswers) {
      restorePendingAnswers(resp.pendingAnswers);
    }
    // 显示引导语（pendingQuestion 作为引导）
    if (onboardingV8Guide && resp.pendingQuestion) {
      onboardingV8Guide.textContent = resp.pendingQuestion;
      onboardingV8Guide.classList.remove('hidden');
    } else if (onboardingV8Guide) {
      onboardingV8Guide.classList.add('hidden');
    }
  } else if (resp.pendingQuestion && resp.pendingQuestion !== onboardingV8State.lastPendingQuestion) {
    // 兼容旧文本路径：无卡片时显示 pendingQuestion 作为引导
    if (onboardingV8Guide) {
      onboardingV8Guide.textContent = resp.pendingQuestion;
      onboardingV8Guide.classList.remove('hidden');
    }
    onboardingV8State.lastPendingQuestion = resp.pendingQuestion;
    // 显示旧版输入框作为回退
    if (onboardingV8Form) onboardingV8Form.classList.remove('hidden');
    if (onboardingV8Cards) onboardingV8Cards.innerHTML = '';
    if (onboardingV8SubmitCardsBtn) onboardingV8SubmitCardsBtn.classList.add('hidden');
  }

  if (onboardingV8Answer) {
    onboardingV8Answer.value = '';
    onboardingV8Answer.focus();
  }
}

/** 启动 V8 向导 */
async function startOnboardingV8() {
  // 防御性校验：即使未来有别的入口直接调用 start，也不会在未配置 Key 时发起模型请求。
  if (!(await hasOnboardingApiKey())) {
    await openOnboardingApiSetup();
    return;
  }
  setOnboardingV8Phase('busy');
  if (onboardingV8Chat) onboardingV8Chat.innerHTML = '';
  onboardingV8State.lastPendingQuestion = '';
  onboardingV8State.revision = 0;
  try {
    const resp = await window.petAPI?.onboardingStart?.(0);
    handleOnboardingV8Response(resp);
  } catch (error) {
    setOnboardingV8Phase('error');
    if (onboardingV8ErrorText) {
      onboardingV8ErrorText.textContent = `启动失败：${error?.message || error}`;
    }
  }
}

/** 提交自然语言回答 */
async function submitOnboardingV8Answer(answer) {
  if (!answer || onboardingV8State.pendingBusy) return;
  // 立即显示用户输入
  appendOnboardingV8ChatMessage('user', answer);
  // I6: 保存操作信息用于重试
  onboardingV8State.lastOperation = 'answer';
  onboardingV8State.lastAnswer = answer;
  onboardingV8State.lastRevision = onboardingV8State.revision;
  onboardingV8State.pendingBusy = true;
  setOnboardingV8Phase('busy');
  try {
    const resp = await window.petAPI?.onboardingSubmitAnswer?.(answer, onboardingV8State.revision);
    handleOnboardingV8Response(resp);
  } catch (error) {
    onboardingV8State.pendingBusy = false;
    setOnboardingV8Phase('error');
    if (onboardingV8ErrorText) {
      onboardingV8ErrorText.textContent = `提交失败：${error?.message || error}`;
    }
  }
}

/** Review 阶段：返回修改 */
async function reviseOnboardingV8Summary() {
  const feedback = (onboardingV8Feedback?.value || '').trim();
  if (onboardingV8State.pendingBusy) return;
  if (feedback) {
    appendOnboardingV8ChatMessage('user', feedback);
  }
  // I6: 保存操作信息用于重试
  onboardingV8State.lastOperation = 'feedback';
  onboardingV8State.lastAnswer = feedback || '我想修改一些设定';
  onboardingV8State.lastRevision = onboardingV8State.revision;
  onboardingV8State.pendingBusy = true;
  setOnboardingV8Phase('busy');
  try {
    const resp = await window.petAPI?.onboardingReviseSummary?.(
      feedback || '我想修改一些设定',
      onboardingV8State.revision
    );
    handleOnboardingV8Response(resp);
  } catch (error) {
    onboardingV8State.pendingBusy = false;
    setOnboardingV8Phase('error');
    if (onboardingV8ErrorText) {
      onboardingV8ErrorText.textContent = `返回修改失败：${error?.message || error}`;
    }
  }
}

/** Review 阶段：确认摘要 */
async function confirmOnboardingV8Summary() {
  if (onboardingV8State.pendingBusy) return;
  // P2: 进入角色锁定前清除本地 timer（Graph persist_and_lock 会消费 checkpoint）
  clearPendingAnswersTimer();
  // I6: 保存操作信息用于重试
  onboardingV8State.lastOperation = 'confirm';
  onboardingV8State.lastAnswer = '';
  onboardingV8State.lastRevision = onboardingV8State.revision;
  onboardingV8State.pendingBusy = true;
  setOnboardingV8Phase('busy');
  if (onboardingV8Busy) {
    const busyText = onboardingV8Busy.querySelector('.onboarding-v8__busy-text');
    if (busyText) busyText.textContent = '正在锁定角色配置…';
  }
  try {
    const resp = await window.petAPI?.onboardingConfirmSummary?.(onboardingV8State.revision);
    handleOnboardingV8Response(resp);
  } catch (error) {
    onboardingV8State.pendingBusy = false;
    setOnboardingV8Phase('error');
    if (onboardingV8ErrorText) {
      onboardingV8ErrorText.textContent = `确认失败：${error?.message || error}`;
    }
  }
}

/**
 * I6: 重试上次失败的操作。
 * 根据 lastOperation 重新提交原 answer/feedback/confirm，而不是仅获取状态。
 * model_unavailable 错误时引导用户打开 API 设置。
 */
async function retryOnboardingV8() {
  if (!(await hasOnboardingApiKey())) {
    await openOnboardingApiSetup();
    return;
  }
  const op = onboardingV8State.lastOperation;
  if (!op) {
    // 没有上次操作记录，回退到获取状态
    setOnboardingV8Phase('busy');
    try {
      const resp = await window.petAPI?.onboardingGetState?.();
      handleOnboardingV8Response(resp);
    } catch (error) {
      setOnboardingV8Phase('error');
      if (onboardingV8ErrorText) {
        onboardingV8ErrorText.textContent = `重试失败：${error?.message || error}`;
      }
    }
    return;
  }

  // 检查是否是 model_unavailable 错误，引导用户打开 API 设置
  const errorText = onboardingV8ErrorText?.textContent || '';
  if (errorText.includes('model_unavailable') || errorText.includes('API') || errorText.includes('api_key')) {
    showBubble('API 配置异常，请先设置 API Key', 5000);
    openApiPanel();
    return;
  }

  setOnboardingV8Phase('busy');
  onboardingV8State.pendingBusy = true;
  try {
    let resp;
    if (op === 'answer') {
      resp = await window.petAPI?.onboardingSubmitAnswer?.(
        onboardingV8State.lastAnswer,
        onboardingV8State.lastRevision
      );
    } else if (op === 'feedback') {
      resp = await window.petAPI?.onboardingReviseSummary?.(
        onboardingV8State.lastAnswer,
        onboardingV8State.lastRevision
      );
    } else if (op === 'confirm') {
      resp = await window.petAPI?.onboardingConfirmSummary?.(
        onboardingV8State.lastRevision
      );
    } else if (op === 'card-answers') {
      // V9: 结构化卡片回答重试。重新收集当前 cardAnswers 并提交。
      // 如果 cardAnswers 已清空，回退到 get-state 恢复 UI。
      const answers = collectOnboardingV8CardAnswers();
      if (answers.length === 0) {
        const stateResp = await window.petAPI?.onboardingGetState?.();
        handleOnboardingV8Response(stateResp);
        return;
      }
      resp = await window.petAPI?.onboardingSubmitAnswers?.(
        answers,
        onboardingV8State.lastRevision
      );
    }
    handleOnboardingV8Response(resp);
  } catch (error) {
    onboardingV8State.pendingBusy = false;
    setOnboardingV8Phase('error');
    if (onboardingV8ErrorText) {
      onboardingV8ErrorText.textContent = `重试失败：${error?.message || error}`;
    }
  }
}

// ===== V9 问题卡片渲染与交互 =====

/**
 * 渲染 V9 问题卡片。
 * 每个问题对应一张独立卡片，支持 text/single_choice/multiple_choice/hybrid。
 * @param {Array} questions - OnboardingQuestionDto[]
 */
function renderOnboardingV8Cards(questions) {
  if (!onboardingV8Cards) return;
  onboardingV8Cards.innerHTML = '';
  onboardingV8State.cardAnswers = {};
  onboardingV8State.cardsRendered = true;

  // 隐藏旧版输入框，显示提交按钮
  if (onboardingV8Form) onboardingV8Form.classList.add('hidden');
  if (onboardingV8SubmitCardsBtn) {
    onboardingV8SubmitCardsBtn.classList.remove('hidden');
    onboardingV8SubmitCardsBtn.disabled = true;
  }

  questions.forEach((q, idx) => {
    const card = createOnboardingV8CardElement(q, idx);
    if (card) onboardingV8Cards.appendChild(card);
  });
}

/**
 * 创建单张问题卡片元素。
 */
function createOnboardingV8CardElement(question, index) {
  if (!question || !question.id) return null;
  const card = document.createElement('div');
  card.className = 'onboarding-v8__card';
  card.dataset.questionId = question.id;
  card.dataset.questionType = question.type;

  // 问题标题
  const title = document.createElement('div');
  title.className = 'onboarding-v8__card-title';
  title.textContent = `${index + 1}. ${question.question || ''}`;
  card.appendChild(title);

  // 问题描述
  if (question.description) {
    const desc = document.createElement('div');
    desc.className = 'onboarding-v8__card-desc';
    desc.textContent = question.description;
    card.appendChild(desc);
  }

  // 根据类型渲染输入区
  const body = document.createElement('div');
  body.className = 'onboarding-v8__card-body';

  const type = question.type;
  const options = Array.isArray(question.options) ? question.options : [];
  const allowOther = !!question.allowOther;
  const maxSelect = question.maxSelect || 0;

  if (type === 'text') {
    // 文本题：输入框 + AI 建议按钮
    const inputRow = document.createElement('div');
    inputRow.className = 'onboarding-v8__text-input-row';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'onboarding-v8__card-input';
    input.placeholder = question.otherPlaceholder || '请输入…';
    input.maxLength = 500;
    input.dataset.questionId = question.id;
    input.addEventListener('input', () => {
      const val = input.value.trim();
      if (val) {
        onboardingV8State.cardAnswers[question.id] = {
          questionId: question.id,
          fieldPaths: question.fieldPaths,
          answerType: 'text',
          customText: val,
          usedSuggestedAnswer: input.dataset.isSuggestion === '1'
        };
      } else {
        delete onboardingV8State.cardAnswers[question.id];
      }
      // 清除"AI建议"标记
      if (input.dataset.isSuggestion === '1' && val) {
        input.dataset.isSuggestion = '0';
        input.classList.remove('onboarding-v8__card-input--suggestion');
      }
      updateOnboardingV8SubmitButton();
      schedulePendingAnswersSave(); // P2: debounce 保存未提交选择
    });
    inputRow.appendChild(input);

    // AI 建议按钮（仅 text 题）
    const suggestBtn = document.createElement('button');
    suggestBtn.type = 'button';
    suggestBtn.className = 'onboarding-v8__suggest-btn';
    suggestBtn.textContent = 'AI帮我建议';
    suggestBtn.addEventListener('click', () => {
      requestOnboardingV8Suggestion(question.id, input, suggestBtn);
    });
    inputRow.appendChild(suggestBtn);
    body.appendChild(inputRow);
  } else if (type === 'single_choice' || type === 'multiple_choice' || type === 'hybrid') {
    // 选项气泡
    const optionsWrap = document.createElement('div');
    optionsWrap.className = 'onboarding-v8__options';
    const isMulti = type === 'multiple_choice' || (type === 'hybrid' && maxSelect > 1);

    options.forEach((opt) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'onboarding-v8__option';
      btn.textContent = opt.label || '';
      btn.dataset.optionId = opt.id;
      btn.dataset.optionValue = typeof opt.value === 'string' ? opt.value : JSON.stringify(opt.value);
      btn.addEventListener('click', () => {
        if (isMulti) {
          // 多选：切换选中状态
          if (btn.classList.contains('is-selected')) {
            btn.classList.remove('is-selected');
          } else {
            // 检查 maxSelect 限制
            if (maxSelect > 0) {
              const selected = optionsWrap.querySelectorAll('.onboarding-v8__option.is-selected');
              if (selected.length >= maxSelect) {
                return; // 超过最大选择数，忽略
              }
            }
            btn.classList.add('is-selected');
          }
        } else {
          // 单选：清除同组其他选中
          optionsWrap.querySelectorAll('.onboarding-v8__option').forEach((b) => b.classList.remove('is-selected'));
          btn.classList.add('is-selected');
        }
        collectOnboardingV8CardAnswer(question, optionsWrap, otherInput);
        updateOnboardingV8SubmitButton();
        schedulePendingAnswersSave(); // P2: debounce 保存未提交选择
      });
      optionsWrap.appendChild(btn);
    });

    body.appendChild(optionsWrap);

    // "其他"输入框（allowOther 或 hybrid）
    let otherInput = null;
    if (allowOther || type === 'hybrid') {
      const otherRow = document.createElement('div');
      otherRow.className = 'onboarding-v8__other-row';
      const otherLabel = document.createElement('span');
      otherLabel.className = 'onboarding-v8__other-label';
      otherLabel.textContent = '其他：';
      otherInput = document.createElement('input');
      otherInput.type = 'text';
      otherInput.className = 'onboarding-v8__card-input onboarding-v8__card-input--other';
      otherInput.placeholder = question.otherPlaceholder || '请描述…';
      otherInput.maxLength = 500;
      otherInput.addEventListener('input', () => {
        collectOnboardingV8CardAnswer(question, optionsWrap, otherInput);
        updateOnboardingV8SubmitButton();
        schedulePendingAnswersSave(); // P2: debounce 保存未提交选择
      });
      otherRow.appendChild(otherLabel);
      otherRow.appendChild(otherInput);
      body.appendChild(otherRow);
    }
  }

  card.appendChild(body);

  // 必填标记
  if (question.required) {
    const req = document.createElement('div');
    req.className = 'onboarding-v8__card-required';
    req.textContent = '* 必填';
    card.appendChild(req);
  }

  return card;
}

/**
 * 收集单张卡片的回答到 cardAnswers。
 * 安全约束：不发送 selectedValues，后端从 checkpoint 的 question.options 重新映射
 */
function collectOnboardingV8CardAnswer(question, optionsWrap, otherInput) {
  const selected = optionsWrap.querySelectorAll('.onboarding-v8__option.is-selected');
  const selectedOptionIds = Array.from(selected).map((b) => b.dataset.optionId);
  const customText = otherInput ? otherInput.value.trim() : '';

  // 无任何回答
  if (selectedOptionIds.length === 0 && !customText) {
    delete onboardingV8State.cardAnswers[question.id];
    return;
  }

  // answerType 始终等于 question.type（反映问题类型，不根据用户回答形式重新推断）
  const answerType = question.type;

  const answer = {
    questionId: question.id,
    fieldPaths: question.fieldPaths,
    answerType,
    selectedOptionIds: selectedOptionIds.length > 0 ? selectedOptionIds : undefined,
    customText: customText || undefined,
    usedSuggestedAnswer: otherInput ? otherInput.dataset.isSuggestion === '1' : undefined
  };
  onboardingV8State.cardAnswers[question.id] = answer;
}

/**
 * 更新提交按钮状态：所有必填问题已回答才启用。
 */
function updateOnboardingV8SubmitButton() {
  if (!onboardingV8SubmitCardsBtn) return;
  const questions = onboardingV8State.currentQuestions || [];
  for (const q of questions) {
    if (q.required && !onboardingV8State.cardAnswers[q.id]) {
      onboardingV8SubmitCardsBtn.disabled = true;
      return;
    }
  }
  onboardingV8SubmitCardsBtn.disabled = questions.length === 0;
}

/**
 * 收集所有卡片回答，返回 OnboardingQuestionAnswer[]。
 */
function collectOnboardingV8CardAnswers() {
  const questions = onboardingV8State.currentQuestions || [];
  const answers = [];
  for (const q of questions) {
    const a = onboardingV8State.cardAnswers[q.id];
    if (a) {
      answers.push(a);
    }
  }
  return answers;
}

/**
 * 提交 V9 结构化卡片回答。
 */
async function submitOnboardingV8CardAnswers() {
  if (onboardingV8State.pendingBusy) return;
  const answers = collectOnboardingV8CardAnswers();
  if (answers.length === 0) return;

  // P2: 提交前清除 pendingAnswers（提交成功后 Graph 保存新 checkpoint 会自然清除，
  // 但显式清除可防止提交失败时残留过期临时答案）
  clearPendingAnswers();

  onboardingV8State.lastOperation = 'card-answers';
  onboardingV8State.lastAnswer = '';
  onboardingV8State.lastRevision = onboardingV8State.revision;
  onboardingV8State.pendingBusy = true;
  setOnboardingV8Phase('busy');
  if (onboardingV8Busy) {
    const busyText = onboardingV8Busy.querySelector('.onboarding-v8__busy-text');
    if (busyText) busyText.textContent = '正在处理回答…';
  }
  try {
    const resp = await window.petAPI?.onboardingSubmitAnswers?.(answers, onboardingV8State.revision);
    handleOnboardingV8Response(resp);
  } catch (error) {
    onboardingV8State.pendingBusy = false;
    setOnboardingV8Phase('error');
    if (onboardingV8ErrorText) {
      onboardingV8ErrorText.textContent = `提交失败：${error?.message || error}`;
    }
  }
}

/**
 * 请求 AI 建议答案，填入输入框（标记为"AI建议，可修改"）。
 * 不直接保存到 Draft，用户提交后才正式确认。
 */
async function requestOnboardingV8Suggestion(questionId, inputEl, suggestBtn) {
  if (!questionId || !inputEl) return;
  if (suggestBtn) {
    suggestBtn.disabled = true;
    suggestBtn.textContent = '生成中…';
  }
  try {
    const result = await window.petAPI?.onboardingSuggest?.(questionId, onboardingV8State.revision);
    if (result && result.ok && result.suggestion) {
      inputEl.value = result.suggestion;
      inputEl.dataset.isSuggestion = '1';
      inputEl.classList.add('onboarding-v8__card-input--suggestion');
      // 触发 input 事件，更新 cardAnswers
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      // 显示"AI建议，可修改"提示
      const hint = inputEl.parentElement?.querySelector('.onboarding-v8__suggestion-hint');
      if (hint) {
        hint.textContent = 'AI建议，可修改';
        hint.classList.remove('hidden');
      }
    } else {
      const reason = result?.reason || '生成失败';
      showBubble(`AI建议生成失败：${reason}`, 4000);
    }
  } catch (error) {
    showBubble(`AI建议请求失败：${error?.message || error}`, 4000);
  } finally {
    if (suggestBtn) {
      suggestBtn.disabled = false;
      suggestBtn.textContent = 'AI帮我建议';
    }
  }
}

/**
 * V9: 渲染摘要区块（按阶段分区，每块带"修改"按钮）。
 * 简单实现：将 summaryDisplayText 按行分割，识别阶段标签，生成区块。
 */
function renderOnboardingV8SummaryBlocks(summaryText, currentStage) {
  if (!onboardingV8SummaryBlocks) return;
  onboardingV8SummaryBlocks.innerHTML = '';

  // 兼容旧版纯文本摘要
  if (onboardingV8Summary && summaryText) {
    onboardingV8Summary.textContent = summaryText;
  }

  if (!summaryText) {
    onboardingV8SummaryBlocks.classList.add('hidden');
    if (onboardingV8Summary) onboardingV8Summary.classList.remove('hidden');
    return;
  }

  onboardingV8SummaryBlocks.classList.remove('hidden');
  if (onboardingV8Summary) onboardingV8Summary.classList.add('hidden');

  // 按阶段标签分割（【基础信息】【说话风格】等）
  const stagePattern = /【(基础信息|说话风格|关系边界|角色禁区|确认阶段)】/;
  const lines = summaryText.split('\n');
  const blocks = [];
  let currentBlock = null;

  for (const line of lines) {
    const match = line.match(stagePattern);
    if (match) {
      if (currentBlock) blocks.push(currentBlock);
      currentBlock = { stage: match[1], content: [] };
    } else if (currentBlock) {
      currentBlock.content.push(line);
    } else {
      // 没有阶段标签的前导内容，作为"总览"块
      currentBlock = { stage: '总览', content: [line] };
    }
  }
  if (currentBlock) blocks.push(currentBlock);

  // 渲染每个区块
  for (const block of blocks) {
    const blockEl = document.createElement('div');
    blockEl.className = 'onboarding-v8__summary-block';

    const head = document.createElement('div');
    head.className = 'onboarding-v8__summary-block-head';
    const title = document.createElement('span');
    title.className = 'onboarding-v8__summary-block-title';
    title.textContent = block.stage;
    head.appendChild(title);

    // "修改"按钮（"总览"块不显示修改按钮）
    if (block.stage !== '总览' && block.stage !== '确认阶段') {
      const reviseBtn = document.createElement('button');
      reviseBtn.type = 'button';
      reviseBtn.className = 'onboarding-v8__summary-block-revise';
      reviseBtn.textContent = '修改';
      reviseBtn.dataset.stage = block.stage;
      reviseBtn.addEventListener('click', () => {
        reviseOnboardingV8Block(block.stage);
      });
      head.appendChild(reviseBtn);
    }
    blockEl.appendChild(head);

    const content = document.createElement('div');
    content.className = 'onboarding-v8__summary-block-content';
    content.textContent = block.content.join('\n').trim();
    blockEl.appendChild(content);

    onboardingV8SummaryBlocks.appendChild(blockEl);
  }
}

/**
 * V9: 局部修改某区块。
 * 点击摘要区块的"修改"按钮，传入 targetStage 参数。
 * P1: targetStage 存在时，后端确定性地为该阶段生成问题卡片，不调用 AnswerExtractor。
 */
async function reviseOnboardingV8Block(stageName) {
  if (onboardingV8State.pendingBusy) return;
  const stageMap = {
    '基础信息': 'basic',
    '说话风格': 'speaking',
    '关系边界': 'relationship',
    '角色禁区': 'taboos'
  };
  const stageKey = stageMap[stageName] || 'basic';
  const feedback = `我想修改${stageName}部分`;
  onboardingV8State.lastOperation = 'feedback';
  onboardingV8State.lastAnswer = feedback;
  onboardingV8State.lastRevision = onboardingV8State.revision;
  onboardingV8State.pendingBusy = true;
  setOnboardingV8Phase('busy');
  try {
    const resp = await window.petAPI?.onboardingReviseSummary?.(feedback, onboardingV8State.revision, stageKey);
    handleOnboardingV8Response(resp);
  } catch (error) {
    onboardingV8State.pendingBusy = false;
    setOnboardingV8Phase('error');
    if (onboardingV8ErrorText) {
      onboardingV8ErrorText.textContent = `返回修改失败：${error?.message || error}`;
    }
  }
}

function renderChatLog() {
  chatLog.innerHTML = '';
  const visibleItems = chatHistory.slice(-50);
  for (const item of visibleItems) {
    const entry = document.createElement('div');
    const isEntering = !item.animated;
    entry.className = `chat-msg chat-msg--${item.role}${item.tone ? ` chat-msg--${item.tone}` : ''}${item.isThinking ? ' chat-msg--thinking' : ''}${isEntering ? ' chat-msg--enter' : ''}`;
    const content = document.createElement('div');
    content.className = 'chat-msg__content';
    if (item.isThinking) {
      const text = document.createElement('span');
      text.textContent = item.content;
      const dots = document.createElement('span');
      dots.className = 'chat-msg__thinking-dots';
      dots.innerHTML = '<span></span><span></span><span></span>';
      content.appendChild(text);
      content.appendChild(dots);
    } else {
      content.textContent = item.content;
    }
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
    item.animated = true;
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

/** 在聊天日志中显示 AI 思考中指示器 */
function addChatThinkingIndicator() {
  chatHistory.push({ role: 'assistant', content: t('thinking'), isThinking: true, excludeFromAi: true });
  if (chatHistory.length > 50) {
    chatHistory = chatHistory.slice(-50);
  }
  renderChatLog();
}

/** 移除聊天日志中的 AI 思考中指示器 */
function removeChatThinkingIndicator() {
  const idx = chatHistory.findIndex((item) => item.isThinking);
  if (idx >= 0) {
    chatHistory.splice(idx, 1);
  }
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
  // 计划模式下走独立的计划消息发送逻辑
  if (planningMode) {
    return sendPlanningMessage(event);
  }
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
    addChatThinkingIndicator();

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
    removeChatThinkingIndicator();
    pushChat('assistant', reply);
    showBubble(reply, 14000);
    setState(getResponseAnimationState(result?.emotion));
    restoreTimers = [setTimeout(() => setState('idle'), getResponseAnimationDuration())];
  } catch {
    removeChatThinkingIndicator();
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

// ===== 计划任务（Planning Bubble）=====
let planningMode = false;
let planningBusy = false;
let currentDraftPlan = null;
let planBubbleSpaceActive = false;
let planningThinkingElement = null;
const PLANNING_EXTRA_HEIGHT = 620;
const CHAT_EXTRA_HEIGHT = 360;
const PANEL_EXTRA_HEIGHT = 540;

/** 简易 HTML 转义 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = String(text || '');
  return div.innerHTML;
}

/** 切换计划模式 */
async function togglePlanningMode() {
  // W4: 未完成角色初始化的用户不得进入计划
  if (onboardingV8State.phase !== 'locked') {
    showBubble('请先完成角色初始化向导后再使用计划功能', 5000);
    openOnboardingPanel('请先完成角色初始化');
    return;
  }
  if (planningMode) {
    exitPlanningMode();
  } else {
    await enterPlanningMode();
  }
}

/** 进入计划模式 */
async function enterPlanningMode(initialResult = null) {
  // 如果已有 active 计划，直接显示气泡而非重新制定
  const result = initialResult || await window.petAPI?.startPlanningMode?.();
  if (result?.activePlan) {
    const tasks = result.activePlan.tasks || [];
    const allCompleted = tasks.length > 0 && tasks.every((t) => t.completed);
    if (allCompleted) {
      // 任务全部完成时打开计划面板，自动收起桌面提醒栏，避免遮挡面板
      closePlanBubble();
      // 继续进入计划模式，不直接返回，让用户可以制定新计划
    } else {
      renderPlanBubble(result.activePlan);
      return;
    }
  } else if (!planningBubble.classList.contains('hidden')) {
    // 没有 active 计划（例如计划已被标记为 completed），但桌面提醒栏仍可见时，
    // 打开计划面板前先关闭提醒栏
    closePlanBubble();
  }
  planningMode = true;
  chatPanel.classList.remove('hidden');
  chatPanel.classList.add('chat-panel--planning');
  // 从普通聊天扩展切换到计划扩展，避免重复占用空间
  window.petAPI?.releaseChatSpace?.();
  window.petAPI?.requestPlanningSpace?.(PLANNING_EXTRA_HEIGHT);
  chatLog.classList.add('hidden');
  planningView.classList.remove('hidden');
  planningView.classList.remove('planning-view--leave');
  planningView.classList.add('planning-view--enter');
  setTimeout(() => planningView.classList.remove('planning-view--enter'), 260);
  chatPanelTitle.textContent = '制定今日计划';
  chatInput.placeholder = '告诉我今天的目标...';
  planModeToggle?.classList.add('active');
  // 修复 5：恢复真实的规划对话历史，不显示一条虚假的通用提示代替历史
  clearPlanningConversation();
  if (Array.isArray(result?.messages) && result.messages.length > 0) {
    for (const msg of result.messages) {
      appendPlanningMessage(msg.role, msg.content);
    }
  }
  // 恢复未确认的草案
  if (result?.draftPlan) {
    renderPlanDraft(result.draftPlan);
    // 如果处于 awaiting_confirmation 阶段，提示用户可以确认
    if (result?.awaitingConfirmation) {
      appendPlanningMessage('assistant', '草案已就绪，确认发布或继续调整。');
    }
  }
  refreshPlanningModelInfo();
}

/** 退出计划模式 */
function exitPlanningMode(keepChatOpen = true) {
  planningMode = false;
  chatPanel.classList.remove('chat-panel--planning');
  planningView.classList.remove('planning-view--enter');
  planningView.classList.add('planning-view--leave');
  chatLog.classList.remove('hidden');
  window.petAPI?.releasePlanningSpace?.();
  // 退出规划后如果聊天面板仍打开则切回普通聊天扩展
  if (keepChatOpen && !chatPanel.classList.contains('hidden')) {
    window.petAPI?.requestChatSpace?.(CHAT_EXTRA_HEIGHT);
  }
  setTimeout(() => {
    planningView.classList.add('hidden');
    planningView.classList.remove('planning-view--leave');
  }, 260);
  chatPanelTitle.textContent = '聊天';
  chatInput.placeholder = t('chatPlaceholder', { name: petProfile.characterName || 'Pet' });
  planModeToggle?.classList.remove('active');
}

/** 计划模式下发送消息（目标或反馈） */
async function sendPlanningMessage(event) {
  event.preventDefault();
  const message = chatInput.value.trim();
  if (!message || planningBusy) return;

  planningBusy = true;
  chatSend.disabled = true;
  chatInput.value = '';
  appendPlanningMessage('user', message);
  appendPlanningMessage('assistant', t('thinking'), true);

  try {
    const result = await window.petAPI?.submitPlanningMessage?.(message);
    if (planningThinkingElement) {
      planningThinkingElement.remove();
      planningThinkingElement = null;
    }
    if (!result?.ok) {
      appendPlanningMessage('assistant', result?.reason || '生成失败');
      return;
    }
    // 要求 11：草案卡片与对话同时显示
    if (result.plan) {
      renderPlanDraft(result.plan);
    }
    if (result.message) {
      appendPlanningMessage('assistant', result.message);
    }
    if (result.published) {
      // 对话中确认后直接发布
      renderPlanBubble(result.plan);
      exitPlanningMode();
    }
    refreshPlanningModelInfo();
  } catch (e) {
    if (planningThinkingElement) {
      planningThinkingElement.remove();
      planningThinkingElement = null;
    }
    appendPlanningMessage('assistant', '计划生成失败：' + (e?.message || ''));
  } finally {
    planningBusy = false;
    chatSend.disabled = false;
    focusChatInput();
  }
}

/**
 * 追加 Planning 对话消息（独立消息历史，不混入聊天 chatLog）。
 * 要求 11：计划模式增加独立消息历史，草案卡片与对话同时显示。
 */
function appendPlanningMessage(role, text, isThinking = false) {
  if (!planningConversation) return;
  const el = document.createElement('div');
  el.className = 'planning-conversation__msg planning-conversation__msg--' + role + ' planning-conversation__msg--enter';
  if (isThinking) {
    el.classList.add('planning-conversation__msg--thinking');
    el.innerHTML = `<span>${escapeHtml(text)}</span><span class="planning-conversation__thinking-dots"><span></span><span></span><span></span></span>`;
    planningThinkingElement = el;
  } else {
    el.textContent = text;
  }
  planningConversation.appendChild(el);
  planningConversation.scrollTop = planningConversation.scrollHeight;
}

/** 清空 Planning 对话历史 */
function clearPlanningConversation() {
  if (planningConversation) {
    planningConversation.innerHTML = '';
  }
  planningThinkingElement = null;
}

/**
 * 刷新状态面板中 PlanningGraph 模型信息。
 * 要求 3：状态面板分别显示 configured、requested、response.model。
 * 要求 4：三者不一致时显示明确警告。
 */
async function refreshPlanningModelInfo() {
  if (!planningModelView) return;
  try {
    const result = await window.petAPI?.getPlanningModelInfo?.();
    if (!result?.ok || !result.info) {
      setKeyValues(planningModelView, [['状态', '未调用']]);
      return;
    }
    const info = result.info;
    const pairs = [
      ['已配置', info.configured || '(默认 deepseek-v4-flash)'],
      ['请求模型', info.resolvedModel || '未解析'],
      ['API 返回', info.responseModel || '未调用']
    ];
    if (info.warning) {
      pairs.push(['⚠ 警告', info.warning]);
    }
    setKeyValues(planningModelView, pairs);
  } catch {
    setKeyValues(planningModelView, [['状态', '查询失败']]);
  }
  // 同步刷新 Planning Trace
  refreshPlanningTrace().catch(() => {});
}

/**
 * 刷新状态面板中最近一轮 Planning Trace。
 * 只显示必要诊断信息，不含 API Key 和敏感内容。
 */
async function refreshPlanningTrace() {
  if (!planningTraceView) return;
  try {
    const result = await window.petAPI?.getPlanningTrace?.();
    if (!result?.ok || !result.trace) {
      setKeyValues(planningTraceView, [['状态', '无记录']]);
      return;
    }
    const t = result.trace;
    const phasesStr = t.phases.map(p =>
      `${p.name}(${p.success ? '✓' : '✗'})`
    ).join(' → ');
    setKeyValues(planningTraceView, [
      ['traceId', t.traceId.slice(-12)],
      ['结果', t.finalResult],
      ['模型调用', String(t.modelCallCount)],
      ['自动修正', String(t.autoCorrectionCount)],
      ['输入token', String(t.inputTokens)],
      ['输出token', String(t.outputTokens)],
      ['总耗时', `${t.totalDurationMs}ms`],
      ['草案版本', String(t.draftVersion)],
      ['用户确认', t.userConfirmed ? '是' : '否'],
      ['模型一致', t.modelConsistent ? '是' : '否'],
      ['阶段', phasesStr],
      ['输入摘要', t.userInputSummary || '(空)']
    ]);
  } catch {
    setKeyValues(planningTraceView, [['状态', '查询失败']]);
  }
}

let activeTimePickerDropdown = null;

/** 点击页面其他区域关闭时间选择下拉框 */
document.addEventListener('click', (e) => {
  if (!activeTimePickerDropdown) return;
  if (activeTimePickerDropdown.contains(e.target)) return;
  const trigger = activeTimePickerDropdown.previousElementSibling;
  if (trigger && trigger.contains(e.target)) return;
  closeActiveTimePicker();
});

function closeActiveTimePicker() {
  if (!activeTimePickerDropdown) return;
  activeTimePickerDropdown.classList.add('hidden');
  const trigger = activeTimePickerDropdown.previousElementSibling;
  if (trigger) trigger.classList.remove('planning-time-picker__trigger--open');
  activeTimePickerDropdown = null;
}

/** 解析 HH:MM 为 [hour, minute] */
function parseTime(value) {
  const [h, m] = String(value || '').split(':');
  return {
    hour: h !== undefined ? h.padStart(2, '0') : '',
    minute: m !== undefined ? m.padStart(2, '0') : ''
  };
}

/** 创建自定义时间选择器 */
function createTimePicker(value, field, onChange) {
  const wrapper = document.createElement('div');
  wrapper.className = 'planning-time-picker';
  wrapper.dataset.field = field;

  const { hour: selectedHour, minute: selectedMinute } = parseTime(value);

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'planning-time-picker__trigger';
  trigger.textContent = value || '--:--';
  trigger.setAttribute('aria-label', field === 'start_time' ? '开始时间' : '结束时间');

  const dropdown = document.createElement('div');
  dropdown.className = 'planning-time-picker__dropdown hidden';

  const createColumn = (items, selectedValue, type) => {
    const column = document.createElement('div');
    column.className = 'planning-time-picker__column';

    const maskTop = document.createElement('div');
    maskTop.className = 'planning-time-picker__mask planning-time-picker__mask--top';
    const maskBottom = document.createElement('div');
    maskBottom.className = 'planning-time-picker__mask planning-time-picker__mask--bottom';

    const options = document.createElement('div');
    options.className = 'planning-time-picker__options';

    let selectedOption = null;
    for (const item of items) {
      const option = document.createElement('div');
      option.className = 'planning-time-picker__option';
      option.textContent = item;
      option.dataset.value = item;
      if (item === selectedValue) {
        option.classList.add('planning-time-picker__option--selected');
        selectedOption = option;
      }
      option.addEventListener('click', () => {
        const current = parseTime(trigger.textContent || value);
        const nextValue = type === 'hour'
          ? `${item}:${current.minute || '00'}`
          : `${current.hour || '00'}:${item}`;
        trigger.textContent = nextValue;
        onChange(nextValue);
        closeActiveTimePicker();
      });
      options.appendChild(option);
    }

    column.appendChild(maskTop);
    column.appendChild(options);
    column.appendChild(maskBottom);

    if (selectedOption) {
      setTimeout(() => {
        selectedOption.scrollIntoView({ block: 'center' });
      }, 0);
    }

    return column;
  };

  const hours = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
  const minutes = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));

  dropdown.appendChild(createColumn(hours, selectedHour, 'hour'));
  dropdown.appendChild(createColumn(minutes, selectedMinute, 'minute'));

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = !dropdown.classList.contains('hidden');
    closeActiveTimePicker();
    if (!isOpen) {
      dropdown.classList.remove('hidden');
      trigger.classList.add('planning-time-picker__trigger--open');
      activeTimePickerDropdown = dropdown;
    }
  });

  wrapper.appendChild(trigger);
  wrapper.appendChild(dropdown);
  return wrapper;
}

/** 渲染计划草案（支持 PlanningGraph 的 PlanDraft 格式：planId 代替 id） */
function renderPlanDraft(plan) {
  if (!plan || !plan.tasks) return;
  // 规范化：PlanningGraph 返回 { planId, date, tasks, draftVersion }
  // 旧格式返回 { id, date, status, tasks }
  const normalized = {
    id: plan.planId || plan.id,
    date: plan.date,
    status: plan.status || 'draft',
    tasks: plan.tasks,
    draftVersion: plan.draftVersion || 1
  };
  currentDraftPlan = normalized;
  planningDraftDate.textContent = normalized.date;
  planningDraftTasks.innerHTML = '';
  for (const task of plan.tasks) {
    const el = document.createElement('div');
    el.className = 'planning-draft__task';
    el.dataset.taskId = task.id;

    const head = document.createElement('div');
    head.className = 'planning-draft__task-head';

    const times = document.createElement('div');
    times.className = 'planning-draft__task-times';

    const startPicker = createTimePicker(
      task.start_time || '',
      'start_time',
      (value) => handleDraftTimeChange(task.id, 'start_time', value)
    );
    const sep = document.createElement('span');
    sep.className = 'planning-draft__task-time-sep';
    sep.textContent = '-';
    const endPicker = createTimePicker(
      task.end_time || '',
      'end_time',
      (value) => handleDraftTimeChange(task.id, 'end_time', value)
    );

    times.appendChild(startPicker);
    times.appendChild(sep);
    times.appendChild(endPicker);

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'planning-draft__task-remove';
    removeBtn.setAttribute('aria-label', '关闭此任务');
    removeBtn.title = '关闭此任务';
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', () => handleDraftTaskRemove(task.id));

    head.appendChild(times);
    head.appendChild(removeBtn);

    const content = document.createElement('div');
    content.className = 'planning-draft__task-content';
    content.textContent = task.content;

    el.appendChild(head);
    el.appendChild(content);
    planningDraftTasks.appendChild(el);
  }
  planningDraft.classList.remove('hidden');
  planningActions.classList.remove('hidden');
}

/** 处理草案任务时间手动修改（发送明确的 patch_task 事件，不调模型） */
async function handleDraftTimeChange(taskId, field, value) {
  if (!currentDraftPlan || !currentDraftPlan.tasks) return;
  const task = currentDraftPlan.tasks.find((t) => t.id === taskId);
  if (!task) return;
  task[field] = value;
  // 发送明确的 patch_task 事件
  try {
    const result = await window.petAPI?.updateDraftPlan?.({
      planId: currentDraftPlan.id,
      action: 'patch_task',
      taskId: taskId,
      patch: { [field]: value }
    });
    if (result?.ok && result.plan) {
      currentDraftPlan = result.plan;
      renderPlanDraft(currentDraftPlan);
    }
  } catch (e) {
    console.error('[planning] patch task failed:', e);
  }
}

/** 处理关闭/删除草案任务（发送明确的 delete_task 事件，数据库真正删除） */
async function handleDraftTaskRemove(taskId) {
  if (!currentDraftPlan || !currentDraftPlan.tasks) return;
  try {
    const result = await window.petAPI?.updateDraftPlan?.({
      planId: currentDraftPlan.id,
      action: 'delete_task',
      taskId: taskId
    });
    if (result?.ok && result.plan) {
      currentDraftPlan = result.plan;
      renderPlanDraft(currentDraftPlan);
    }
  } catch (e) {
    console.error('[planning] delete task failed:', e);
  }
}

/** 将本地草案修改保存到后端（兼容旧的批量保存，转换为 move_task） */
async function saveDraftChanges() {
  if (!currentDraftPlan || !currentDraftPlan.id || !currentDraftPlan.tasks) return;
  try {
    await window.petAPI?.updateDraftPlan?.({
      planId: currentDraftPlan.id,
      action: 'move_task',
      tasks: currentDraftPlan.tasks
    });
  } catch (e) {
    console.error('[planning] save draft changes failed:', e);
  }
}

/** 确认计划（要求 8：publish_plan 必须要求明确用户确认） */
async function confirmPlan() {
  try {
    await saveDraftChanges();
    appendPlanningMessage('assistant', t('thinking'), true);
    const result = await window.petAPI?.confirmPlan?.();
    if (planningThinkingElement) {
      planningThinkingElement.remove();
      planningThinkingElement = null;
    }
    if (result?.ok) {
      if (result.published) {
        // 先退出计划模式释放扩展空间，再显示计划气泡请求气泡空间，
        // 避免计划空间的回退把刚请求的气泡空间一起取消导致位置错乱
        exitPlanningMode();
        renderPlanBubble(result.plan);
      } else if (result.message) {
        // 模型可能还在请求确认或需要补充信息
        appendPlanningMessage('assistant', result.message);
      }
    } else {
      showBubble(result?.reason || '确认失败', 6000);
    }
    refreshPlanningModelInfo();
  } catch (e) {
    if (planningThinkingElement) {
      planningThinkingElement.remove();
      planningThinkingElement = null;
    }
    showBubble('确认失败：' + (e?.message || ''), 6000);
  }
}

/** 修改计划（带反馈重新生成，通过 PlanningGraph 优先 patch 而非重建） */
async function revisePlan() {
  const feedback = revisePlanInput?.value?.trim();
  if (!feedback || planningBusy) return;

  planningBusy = true;
  chatSend.disabled = true;
  revisePlanInput.value = '';
  appendPlanningMessage('user', feedback);
  appendPlanningMessage('assistant', t('thinking'), true);

  try {
    const result = await window.petAPI?.revisePlan?.(feedback);
    if (planningThinkingElement) {
      planningThinkingElement.remove();
      planningThinkingElement = null;
    }
    if (result?.ok) {
      if (result.plan) {
        renderPlanDraft(result.plan);
      }
      if (result.message) {
        appendPlanningMessage('assistant', result.message);
      }
    } else {
      appendPlanningMessage('assistant', result?.reason || '修改失败');
    }
    refreshPlanningModelInfo();
  } catch (e) {
    if (planningThinkingElement) {
      planningThinkingElement.remove();
      planningThinkingElement = null;
    }
    appendPlanningMessage('assistant', '修改失败：' + (e?.message || ''));
  } finally {
    planningBusy = false;
    chatSend.disabled = false;
  }
}

/** 渲染桌面计划气泡 */
function renderPlanBubble(plan) {
  if (!plan || !plan.tasks) return;
  planningBubble.classList.remove('hidden');
  hideRestoreButton();
  renderPlanTimeline(plan.tasks);
  // 计划气泡显示时请求扩大窗口；避免重复请求导致引用计数泄漏
  if (!planBubbleSpaceActive) {
    window.petAPI?.requestBubbleSpace?.(320);
    planBubbleSpaceActive = true;
  }
}

/** 带动画显示恢复按钮 */
function showRestoreButton() {
  if (!planBubbleRestore) return;
  planBubbleRestore.classList.remove('hidden');
  planBubbleRestore.classList.add('plan-bubble__restore--enter');
  setTimeout(() => {
    planBubbleRestore.classList.remove('plan-bubble__restore--enter');
  }, 260);
}

/** 带动画隐藏恢复按钮 */
function hideRestoreButton() {
  if (!planBubbleRestore || planBubbleRestore.classList.contains('hidden')) return;
  planBubbleRestore.classList.add('plan-bubble__restore--leave');
  setTimeout(() => {
    planBubbleRestore.classList.add('hidden');
    planBubbleRestore.classList.remove('plan-bubble__restore--leave');
  }, 260);
}

/** 渲染时间线任务列表 */
function renderPlanTimeline(tasks) {
  planBubbleTimeline.innerHTML = '';
  // 未完成的在前，已完成的沉底
  const sorted = [...tasks].sort((a, b) => {
    if (a.completed !== b.completed) return a.completed - b.completed;
    return (a.order_index ?? 0) - (b.order_index ?? 0);
  });
  for (const task of sorted) {
    const label = document.createElement('label');
    label.className = 'plan-bubble__task' + (task.completed ? ' plan-bubble__task--completed' : '');
    label.dataset.taskId = task.id;
    label.innerHTML = `
      <span class="plan-bubble__task-time">${task.start_time || ''}</span>
      <span class="plan-bubble__task-main">
        <input type="checkbox" class="plan-bubble__task-checkbox" ${task.completed ? 'checked' : ''}>
        <span class="plan-bubble__task-text">${escapeHtml(task.content)}</span>
      </span>
    `;
    const checkbox = label.querySelector('.plan-bubble__task-checkbox');
    checkbox.addEventListener('change', () => handleTaskToggle(task.id));
    planBubbleTimeline.appendChild(label);
  }
}

/** 切换任务完成状态 */
async function handleTaskToggle(taskId) {
  try {
    const taskEl = planBubbleTimeline.querySelector(`.plan-bubble__task[data-task-id="${taskId}"]`);
    const isCompleting = taskEl && !taskEl.classList.contains('plan-bubble__task--completed');

    const result = await window.petAPI?.toggleTaskCompletion?.(taskId);
    if (!result?.ok) return;

    if (isCompleting && taskEl) {
      taskEl.classList.add('plan-bubble__task--sinking');
      await new Promise((resolve) => setTimeout(resolve, 320));
    }

    renderPlanTimeline(result.tasks);
    if (result.allCompleted) {
      showBubble('🎉 今日计划全部完成！', 10000);
    }
  } catch (e) {
    console.error('[planning] toggle task failed:', e);
  }
}

/** 最小化计划气泡（保留窗口空间，避免展开/收起时桌宠移动） */
function minimizePlanBubble() {
  planningBubble.classList.add('hidden');
  showRestoreButton();
  // 不释放气泡空间：让窗口保持展开，点击“今日计划”恢复时桌宠不会移动
}

/** 关闭计划气泡并释放窗口空间（用于计划完成或被替代时真正清理） */
function closePlanBubble() {
  planningBubble.classList.add('hidden');
  hideRestoreButton();
  if (planBubbleSpaceActive) {
    window.petAPI?.releaseBubbleSpace?.();
    planBubbleSpaceActive = false;
  }
}

/** 恢复计划气泡 */
function restorePlanBubble() {
  planningBubble.classList.remove('hidden');
  hideRestoreButton();
  if (!planBubbleSpaceActive) {
    window.petAPI?.requestBubbleSpace?.(320);
    planBubbleSpaceActive = true;
  }
}

// ===== 日历面板（V7 跨日期计划）=====
let calendarViewYear = 0;
let calendarViewMonth = 0; // 1-12
let calendarSelectedDate = ''; // YYYY-MM-DD
let calendarDetailPlan = null; // 当前详情面板展示的计划
const CALENDAR_EXTRA_HEIGHT = 420;

/** 获取今天日期（本地时区，YYYY-MM-DD） */
function getTodayDateString() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 打开日历面板 */
async function openCalendarPanel() {
  // W4: 未完成角色初始化的用户不得进入日历
  if (onboardingV8State.phase !== 'locked') {
    showBubble('请先完成角色初始化向导后再使用日历功能', 5000);
    openOnboardingPanel('请先完成角色初始化');
    return;
  }
  closeMaterialPanel();
  closeOnboardingPanel();
  closeApiPanel();
  closeStatePanel();
  closeChatPanel();
  calendarPanel.classList.remove('hidden');
  // 请求扩大窗口高度以容纳日历
  window.petAPI?.requestChatSpace?.(CALENDAR_EXTRA_HEIGHT);
  // 默认显示当月
  const today = new Date();
  calendarViewYear = today.getFullYear();
  calendarViewMonth = today.getMonth() + 1;
  calendarSelectedDate = '';
  calendarDetail.classList.add('hidden');
  await refreshCalendarMonth();
}

/** 关闭日历面板 */
function closeCalendarPanel() {
  const wasOpen = !calendarPanel.classList.contains('hidden');
  calendarPanel.classList.add('hidden');
  calendarDetail.classList.add('hidden');
  calendarSelectedDate = '';
  calendarDetailPlan = null;
  if (wasOpen) window.petAPI?.releaseChatSpace?.();
}

/** 刷新月视图（不调用模型） */
async function refreshCalendarMonth() {
  if (!calendarViewYear || !calendarViewMonth) return;
  calendarMonthLabel.textContent = `${calendarViewYear} 年 ${calendarViewMonth} 月`;
  calendarGrid.innerHTML = '<div class="calendar-grid__loading">加载中...</div>';
  try {
    const result = await window.petAPI?.getCalendarMonth?.(calendarViewYear, calendarViewMonth);
    if (!result?.ok) {
      calendarGrid.innerHTML = `<div class="calendar-grid__loading">${escapeHtml(result?.reason || '加载失败')}</div>`;
      return;
    }
    renderCalendarGrid(result.days || []);
  } catch (e) {
    calendarGrid.innerHTML = `<div class="calendar-grid__loading">加载失败：${escapeHtml(e?.message || '')}</div>`;
  }
}

/** 渲染月视图网格 */
function renderCalendarGrid(daysInfo) {
  calendarGrid.innerHTML = '';
  // daysInfo: [{ date, status, taskCount, completedCount }]
  const dayMap = new Map();
  for (const d of daysInfo) {
    dayMap.set(d.date, d);
  }
  // 计算月份第一天是周几（0=周日）
  const firstDay = new Date(calendarViewYear, calendarViewMonth - 1, 1);
  const startWeekday = firstDay.getDay();
  // 当月天数
  const daysInMonth = new Date(calendarViewYear, calendarViewMonth, 0).getDate();
  const today = getTodayDateString();

  // 前置空白
  for (let i = 0; i < startWeekday; i++) {
    const blank = document.createElement('div');
    blank.className = 'calendar-grid__cell calendar-grid__cell--blank';
    calendarGrid.appendChild(blank);
  }
  // 日期格子
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${calendarViewYear}-${String(calendarViewMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const info = dayMap.get(dateStr);
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'calendar-grid__cell';
    cell.dataset.date = dateStr;
    if (dateStr === today) cell.classList.add('calendar-grid__cell--today');
    if (dateStr === calendarSelectedDate) cell.classList.add('calendar-grid__cell--selected');
    if (info) {
      cell.classList.add(`calendar-grid__cell--${info.status || 'draft'}`);
      cell.innerHTML = `
        <span class="calendar-grid__day">${day}</span>
        <span class="calendar-grid__badge">${info.taskCount || 0}</span>
        ${info.taskCount > 0 && info.completedCount === info.taskCount
          ? '<span class="calendar-grid__check" aria-label="已完成">✓</span>'
          : ''}
      `;
    } else {
      cell.innerHTML = `<span class="calendar-grid__day">${day}</span>`;
    }
    cell.addEventListener('click', () => selectCalendarDate(dateStr));
    calendarGrid.appendChild(cell);
  }
}

/** 切换到上个月 */
function calendarGoPrevMonth() {
  calendarViewMonth -= 1;
  if (calendarViewMonth < 1) {
    calendarViewMonth = 12;
    calendarViewYear -= 1;
  }
  refreshCalendarMonth();
}

/** 切换到下个月 */
function calendarGoNextMonth() {
  calendarViewMonth += 1;
  if (calendarViewMonth > 12) {
    calendarViewMonth = 1;
    calendarViewYear += 1;
  }
  refreshCalendarMonth();
}

/** 回到今天 */
function calendarGoToday() {
  const today = new Date();
  calendarViewYear = today.getFullYear();
  calendarViewMonth = today.getMonth() + 1;
  refreshCalendarMonth();
}

/** 选择日期查看详情（不调用模型） */
async function selectCalendarDate(dateStr) {
  calendarSelectedDate = dateStr;
  // 更新网格选中态
  const cells = calendarGrid.querySelectorAll('.calendar-grid__cell');
  cells.forEach((c) => {
    c.classList.toggle('calendar-grid__cell--selected', c.dataset.date === dateStr);
  });
  // 加载详情
  calendarDetail.classList.remove('hidden');
  calendarDetailDate.textContent = dateStr;
  calendarDetailStatus.textContent = '加载中...';
  calendarDetailTasks.innerHTML = '';
  calendarEditPlan.classList.add('hidden');
  calendarCreatePlan.classList.add('hidden');
  calendarDetailPlan = null;
  try {
    const result = await window.petAPI?.getCalendarDate?.(dateStr);
    if (!result?.ok) {
      calendarDetailStatus.textContent = result?.reason || '加载失败';
      return;
    }
    renderCalendarDetail(dateStr, result.plan);
  } catch (e) {
    calendarDetailStatus.textContent = '加载失败：' + (e?.message || '');
  }
}

/** 渲染日期详情 */
function renderCalendarDetail(dateStr, plan) {
  calendarDetailPlan = plan;
  const today = getTodayDateString();
  const isPast = dateStr < today;
  const isFuture = dateStr > today;
  if (!plan) {
    calendarDetailStatus.textContent = isPast ? '当天无计划记录' : '当天尚无计划';
    calendarDetailTasks.innerHTML = '<div class="calendar-detail__empty">无任务</div>';
    if (isFuture || dateStr === today) {
      calendarCreatePlan.classList.remove('hidden');
      calendarEditPlan.classList.add('hidden');
    } else {
      calendarCreatePlan.classList.add('hidden');
      calendarEditPlan.classList.add('hidden');
    }
    return;
  }
  // 有计划
  const statusText = {
    draft: '草案',
    scheduled: '已安排（未来计划）',
    active: '今日生效',
    completed: '已完成',
    cancelled: '已取消',
    expired: '已过期'
  }[plan.status] || plan.status;
  const tasks = plan.tasks || [];
  const completed = tasks.filter((t) => t.completed).length;
  calendarDetailStatus.textContent = `${statusText} · ${completed}/${tasks.length} 任务`;
  calendarDetailTasks.innerHTML = '';
  if (tasks.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'calendar-detail__empty';
    empty.textContent = '无任务';
    calendarDetailTasks.appendChild(empty);
  } else {
    // 按开始时间排序
    const sorted = [...tasks].sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''));
    for (const task of sorted) {
      const el = document.createElement('div');
      el.className = 'calendar-detail__task' + (task.completed ? ' calendar-detail__task--completed' : '');
      el.innerHTML = `
        <span class="calendar-detail__task-time">${escapeHtml(task.start_time || '--:--')}</span>
        <span class="calendar-detail__task-text">${escapeHtml(task.content || '')}</span>
      `;
      calendarDetailTasks.appendChild(el);
    }
  }
  // 操作按钮：draft/active/scheduled 状态可编辑；未来日期或今天可创建新计划
  const editable = ['draft', 'scheduled', 'active'].includes(plan.status);
  if (editable) {
    calendarEditPlan.classList.remove('hidden');
  } else {
    calendarEditPlan.classList.add('hidden');
  }
  // 已有计划时隐藏"为这一天制定计划"（同一日期只允许一个 live plan）
  calendarCreatePlan.classList.add('hidden');
}

/** "在计划模式中编辑" — 切换到计划模式并加载该日期计划 */
async function calendarEditCurrentPlan() {
  if (!calendarDetailPlan) return;
  const targetDate = calendarDetailPlan.date || calendarSelectedDate;
  closeCalendarPanel();
  try {
    const result = await window.petAPI?.openPlanningWithDate?.(targetDate, '');
    if (!result?.ok) throw new Error(result?.reason || '无法打开该日期的计划');
    await enterPlanningMode(result);
  } catch (e) {
    console.error('[calendar] open planning with date failed:', e);
    showBubble('打开计划失败：' + (e?.message || ''), 6000);
  }
  // 刷新计划对话状态
  await refreshPlanningModelInfo();
}

/** "为这一天制定计划" — 打开计划模式并预填目标日期 */
async function calendarCreateForDate() {
  if (!calendarSelectedDate) return;
  const targetDate = calendarSelectedDate;
  closeCalendarPanel();
  try {
    const result = await window.petAPI?.openPlanningWithDate?.(targetDate, '');
    if (!result?.ok) throw new Error(result?.reason || '无法打开该日期');
    await enterPlanningMode(result);
  } catch (e) {
    console.error('[calendar] open planning for date failed:', e);
    showBubble('打开计划失败：' + (e?.message || ''), 6000);
    return;
  }
  appendPlanningMessage('assistant', `好的，我们为 ${targetDate} 制定计划，告诉我你的目标。`);
  await refreshPlanningModelInfo();
}

// 监听 main 推送的计划发布事件（启动恢复）
window.petAPI?.onPlanPublished?.((plan) => {
  renderPlanBubble(plan);
});

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
// 计划任务事件绑定
bindEvent(planModeToggle, 'click', togglePlanningMode);
bindEvent(confirmPlanBtn, 'click', confirmPlan);
bindEvent(revisePlanBtn, 'click', revisePlan);
bindEvent(planBubbleMinimize, 'click', minimizePlanBubble);
bindEvent(planBubbleRestore, 'click', restorePlanBubble);
// 日历面板事件绑定
bindEvent(calendarToggle, 'click', openCalendarPanel);
bindEvent(calendarClose, 'click', closeCalendarPanel);
bindEvent(calendarPrevMonth, 'click', calendarGoPrevMonth);
bindEvent(calendarNextMonth, 'click', calendarGoNextMonth);
bindEvent(calendarToday, 'click', calendarGoToday);
bindEvent(calendarDetailClose, 'click', () => {
  calendarDetail.classList.add('hidden');
  calendarSelectedDate = '';
  // 取消网格选中态
  const cells = calendarGrid.querySelectorAll('.calendar-grid__cell--selected');
  cells.forEach((c) => c.classList.remove('calendar-grid__cell--selected'));
});
bindEvent(calendarEditPlan, 'click', calendarEditCurrentPlan);
bindEvent(calendarCreatePlan, 'click', calendarCreateForDate);
bindEvent(stateToggle, 'click', openStatePanel);
bindEvent(stateClose, 'click', closeStatePanel);
bindEvent(onboardingClose, 'click', closeOnboardingPanel);
bindEvent(materialLibraryBtn, 'click', openMaterialPanel);
bindEvent(materialBack, 'click', returnToStateFromMaterialPanel);
bindEvent(importMaterialBtn, 'click', importMaterial);
bindEvent(restoreDefaultMaterialBtn, 'click', restoreDefaultMaterial);
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
bindEvent(resetCharacterBtn, 'click', resetCharacter);
bindEvent(resetUserDataBtn, 'click', resetUserData);
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
  // 防御性兜底：已锁定角色不应再接收 onboarding 请求打开面板
  if (onboardingV8State.phase === 'locked') return;
  const message = dto.text || '请输入你的昵称和称呼偏好。';
  // openOnboardingPanel 是 async：V10 先查询后端状态再决定是否展示面板
  // 即使当前 phase 还是初始 'busy'，也不会错误地弹出已锁定界面
  void openOnboardingPanel(message);
  if (dto.expression) {
    clearRestoreTimers();
    setState(dto.expression);
    restoreTimers = [setTimeout(() => setState('idle'), 6500)];
  }
});

// Onboarding 表单提交（旧版兼容）
if (onboardingForm) {
  onboardingForm.addEventListener('submit', submitOnboarding);
}

// V8 角色初始化向导事件绑定
if (onboardingV8Form) {
  onboardingV8Form.addEventListener('submit', (event) => {
    event.preventDefault();
    const answer = (onboardingV8Answer?.value || '').trim();
    if (!answer) return;
    submitOnboardingV8Answer(answer);
  });
}

if (onboardingV8ReviewForm) {
  onboardingV8ReviewForm.addEventListener('submit', (event) => {
    event.preventDefault();
    confirmOnboardingV8Summary();
  });
}

if (onboardingV8ReviseBtn) {
  onboardingV8ReviseBtn.addEventListener('click', () => {
    reviseOnboardingV8Summary();
  });
}

if (onboardingV8RetryBtn) {
  onboardingV8RetryBtn.addEventListener('click', () => {
    retryOnboardingV8();
  });
}

if (onboardingV8ConfigureApiBtn) {
  onboardingV8ConfigureApiBtn.addEventListener('click', () => {
    onboardingV8State.phase = 'api-required';
    openApiPanel();
  });
}

if (onboardingV8DismissBtn) {
  onboardingV8DismissBtn.addEventListener('click', () => {
    onboardingV8State.phase = 'api-required';
    closeOnboardingPanel();
    showBubble('初始化已暂停；需要时可从设置中配置 API Key 后继续。', 5500);
  });
}

if (onboardingV8CloseBtn) {
  onboardingV8CloseBtn.addEventListener('click', () => {
    closeOnboardingPanel();
    showBubble('角色配置已锁定，很高兴认识你！', 7000);
    setState('waving');
    clearRestoreTimers();
    restoreTimers = [setTimeout(() => setState('idle'), 6500)];
  });
}

// V9 问题卡片提交按钮
if (onboardingV8SubmitCardsBtn) {
  onboardingV8SubmitCardsBtn.addEventListener('click', () => {
    submitOnboardingV8CardAnswers();
  });
}

applyPetProfile();
applyLanguage();
applyScale(scale);
restartAnimation();
scheduleReminder();
startClockWatcher();
setTimeout(() => showBubble(t('startupBubble'), 7000), 1200);

// V8 角色初始化：启动后异步同步一次后端状态，避免已锁定角色在首次交互时被误判为未初始化
setTimeout(async () => {
  if (!onboardingV8 || !window.petAPI?.onboardingGetState) return;
  // 清除全部数据后的首次启动没有 API Key。此时只读 onboarding 状态并不代表
  // renderer 已经具备启动模型向导的条件，不能提前设置 _v8Initialized=true。
  if (!(await hasOnboardingApiKey())) {
    onboardingV8State._v8Initialized = false;
    onboardingV8State.phase = 'api-required';
    return;
  }
  window.petAPI.onboardingGetState()
    .then((resp) => {
      if (!resp) return;
      onboardingV8State.revision = resp.revision || 0;
      onboardingV8State.traceId = resp.traceId || '';
      if (resp.isCompleted || resp.phase === 'locked') {
        onboardingV8State._v8Initialized = true;
        onboardingV8State.phase = 'locked';
      } else if (resp.phase === 'review') {
        onboardingV8State._v8Initialized = true;
        onboardingV8State.phase = 'review';
      } else if (resp.phase === 'error') {
        // 错误时保持未初始化，让后续 openOnboardingPanel 再次尝试
        onboardingV8State.phase = 'error';
      } else {
        onboardingV8State._v8Initialized = true;
        onboardingV8State.phase = 'collecting';
      }
    })
    .catch(() => {
      // 失败时保持默认未初始化状态，后续 openOnboardingPanel 会再次尝试
    });
}, 2500);
