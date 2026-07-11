const crypto = require('crypto');
const { loadPetData, updatePetData } = require('./pet-data-store');

const VALID_TYPES = new Set(['user', 'longTerm', 'shortTerm']);
const VALID_SOURCES = new Set(['user_explicit', 'inferred', 'system']);
const MAX_EDIT_CONTENT_CHARS = 300;
const SHORT_TERM_TTL_HOURS = 24;
const SHORT_TERM_TTL_MS = SHORT_TERM_TTL_HOURS * 60 * 60 * 1000;
const LOW_VALUE_CONTENT = new Set([
  '\u54c8\u54c8',
  '\u54c8\u54c8\u54c8',
  '\u55ef',
  '\u597d\u7684',
  '\u597d',
  'ok',
  'OK',
  '\u5929\u6c14\u4e0d\u9519'
]);

const MEMORY_TRIGGER_PATTERN = /(\u8bb0\u4f4f|\u5e2e\u6211\u8bb0\u4f4f|\u8bf7\u8bb0\u4f4f|\u4e0d\u8981\u5fd8\u8bb0|\u63d0\u9192\u6211|\u4ee5\u540e|\u6bcf\u5929|\u6bcf\u65e5|\u6bcf\u5468|\u6bcf\u661f\u671f|\u6bcf\u6708|\u6211\u559c\u6b22|\u6211\u4e0d\u559c\u6b22|\u6211\u53eb|\u6211\u7684\u540d\u5b57|\u751f\u65e5|\u6211\u662f|\u4e60\u60ef|\u76ee\u6807|\u8ba1\u5212|\u6253\u7b97|\u51c6\u5907|\u51b3\u5b9a|\u63a5\u4e0b\u6765|\u4e0b\u5468|\u4e0b\u4e2a\u6708|\u660e\u5e74|\u622a\u6b62|\u957f\u671f|\u6301\u7eed|\u5f00\u59cb\u5b66|\u60f3\u5b66|\u8981\u5b66|\u60f3\u505a|\u8981\u505a|\u504f\u597d|\u91cd\u8981|\u5403\u836f|\u7528\u836f|\u670d\u836f|\u590d\u67e5|\u836f|\u4e0d\u540c|\u8fd9\u4e24\u4e2a|\u521a\u624d|\u524d\u9762|\u4e0a\u9762|\u5b83\u4eec|\u4e0d\u662f\u540c\u4e00\u4e2a|\bplan\b|\bgoal\b|\bremind\b|\bnext week\b|\bnext month\b)/iu;
const USER_PROFILE_TRIGGER_PATTERN = /(\u6211\u53eb|\u6211\u7684\u540d\u5b57|\u4ee5\u540e\u53eb\u6211|\u53eb\u6211|\u751f\u65e5|\u6211\u662f|\u6211\u559c\u6b22|\u6211\u4e0d\u559c\u6b22|\u633a\u559c\u6b22|\u66f4\u559c\u6b22|\u6700\u559c\u6b22|\u559c\u6b22|\u4e0d\u559c\u6b22|\u8ba8\u538c|\u4e60\u60ef|\u5e73\u65f6|\u901a\u5e38|\u4e00\u822c\u4f1a|\u504f\u597d|\u804c\u4e1a|\u5de5\u4f5c|\u6211\u5728\u505a|\u6211\u662f\u505a|\u5b66\u751f|\u8fb9\u754c|\u4e0d\u8981|\u5e0c\u671b\u4f60|\u8eab\u4efd|\bprefer\b|\blike\b|\bdislike\b|\bname\b|\bbirthday\b|\busually\b|\bi work as\b)/iu;
const VALID_ANALYSIS_ACTIONS = new Set(['create', 'update', 'skip']);
const VALID_USER_CATEGORIES = new Set([
  'identity',
  'preference',
  'dislike',
  'habit',
  'birthday',
  'occupation',
  'relationship',
  'boundary',
  'health',
  'profile_summary',
  'other'
]);

function nowIso() {
  return new Date().toISOString();
}

function assertValidType(type) {
  if (!VALID_TYPES.has(type)) {
    throw new Error('Invalid memory type.');
  }
}

function cleanText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s:：,，。.!！?？]+|[\s。.!！?？]+$/g, '')
    .trim();
}

function isLowValueContent(content) {
  const text = cleanText(content);
  return text.length < 2 || LOW_VALUE_CONTENT.has(text);
}

function createMemoryEntry(type, content, options = {}) {
  const timestamp = nowIso();
  const source = VALID_SOURCES.has(options.source) ? options.source : 'user_explicit';
  const entry = {
    id: typeof options.id === 'string' && options.id ? options.id : crypto.randomUUID(),
    content: cleanText(content).slice(0, 1000),
    source,
    importance: Number.isFinite(Number(options.importance)) ? Number(options.importance) : 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    lastUsedAt: '',
    tags: Array.isArray(options.tags) ? options.tags.map(cleanText).filter(Boolean).slice(0, 12) : []
  };

  if (type === 'longTerm') {
    const reminder = options.reminder && typeof options.reminder === 'object' ? options.reminder : {};
    entry.reminder = {
      enabled: Boolean(reminder.enabled),
      frequency: cleanText(reminder.frequency),
      time: cleanText(reminder.time),
      note: cleanText(reminder.note)
    };
  }

  if (type === 'shortTerm') {
    const expiresAt = cleanText(options.expiresAt);
    entry.topic = cleanText(options.topic).slice(0, 40);
    entry.sourceMessage = cleanText(options.sourceMessage).slice(0, 300);
    entry.profileCandidate = Boolean(options.profileCandidate);
    entry.profileReason = cleanText(options.profileReason).slice(0, 200);
    entry.expiresAt = expiresAt || new Date(Date.now() + SHORT_TERM_TTL_MS).toISOString();
  }

  if (type === 'user') {
    entry.category = VALID_USER_CATEGORIES.has(options.category) ? options.category : '';
    entry.key = cleanText(options.key).slice(0, 60);
    entry.value = cleanText(options.value).slice(0, 200);
    entry.confidence = clampImportance(options.confidence);
    entry.pinned = Boolean(options.pinned);
    entry.sourceMessage = cleanText(options.sourceMessage).slice(0, 300);
  }

  return entry;
}

function getMemoryBucket(data, type) {
  assertValidType(type);
  if (!data.memory || typeof data.memory !== 'object') {
    data.memory = { user: [], longTerm: [], shortTerm: [] };
  }
  if (!Array.isArray(data.memory[type])) {
    data.memory[type] = [];
  }
  return data.memory[type];
}

function listMemories(appInstance, type) {
  assertValidType(type);
  const data = loadPetData(appInstance);
  return getMemoryBucket(data, type);
}

function addMemory(appInstance, type, content, options = {}) {
  assertValidType(type);
  if (isLowValueContent(content)) {
    throw new Error('Memory content is empty or low value.');
  }

  const entry = createMemoryEntry(type, content, options);
  updatePetData(appInstance, (data) => {
    getMemoryBucket(data, type).push(entry);
    return data;
  });
  return entry;
}

function updateMemory(appInstance, type, id, patch = {}) {
  assertValidType(type);
  const memoryId = cleanText(id);
  if (!memoryId) {
    throw new Error('Memory id is required.');
  }

  let updated = null;
  updatePetData(appInstance, (data) => {
    const bucket = getMemoryBucket(data, type);
    const index = bucket.findIndex((entry) => entry.id === memoryId);
    if (index === -1) {
      throw new Error('Memory not found.');
    }

    const current = bucket[index];
    const next = {
      ...current,
      updatedAt: nowIso()
    };

    if (typeof patch.content === 'string') {
      if (isLowValueContent(patch.content)) {
        throw new Error('Memory content is empty or low value.');
      }
      next.content = cleanText(patch.content).slice(0, MAX_EDIT_CONTENT_CHARS);
    }
    if (VALID_SOURCES.has(patch.source)) {
      next.source = patch.source;
    }
    if (Number.isFinite(Number(patch.importance))) {
      next.importance = Number(patch.importance);
    }
    if (typeof patch.lastUsedAt === 'string') {
      next.lastUsedAt = cleanText(patch.lastUsedAt);
    }
    if (Array.isArray(patch.tags)) {
      next.tags = patch.tags.map(cleanText).filter(Boolean).slice(0, 12);
    }
    if (type === 'longTerm' && patch.reminder && typeof patch.reminder === 'object') {
      next.reminder = {
        enabled: Boolean(patch.reminder.enabled),
        frequency: cleanText(patch.reminder.frequency),
        time: cleanText(patch.reminder.time),
        note: cleanText(patch.reminder.note)
      };
    }
    if (type === 'shortTerm' && typeof patch.expiresAt === 'string') {
      next.expiresAt = cleanText(patch.expiresAt);
    }
    if (type === 'shortTerm' && typeof patch.topic === 'string') {
      next.topic = cleanText(patch.topic).slice(0, 40);
    }
    if (type === 'shortTerm' && typeof patch.sourceMessage === 'string') {
      next.sourceMessage = cleanText(patch.sourceMessage).slice(0, 300);
    }
    if (type === 'shortTerm' && typeof patch.profileCandidate === 'boolean') {
      next.profileCandidate = patch.profileCandidate;
    }
    if (type === 'shortTerm' && typeof patch.profileReason === 'string') {
      next.profileReason = cleanText(patch.profileReason).slice(0, 200);
    }
    if (type === 'user') {
      if (typeof patch.category === 'string') {
        next.category = VALID_USER_CATEGORIES.has(patch.category) ? patch.category : next.category || '';
      }
      if (typeof patch.key === 'string') {
        next.key = cleanText(patch.key).slice(0, 60);
      }
      if (typeof patch.value === 'string') {
        next.value = cleanText(patch.value).slice(0, 200);
      }
      if (Number.isFinite(Number(patch.confidence))) {
        next.confidence = clampImportance(patch.confidence);
      }
      if (typeof patch.pinned === 'boolean') {
        next.pinned = patch.pinned;
      }
      if (typeof patch.sourceMessage === 'string') {
        next.sourceMessage = cleanText(patch.sourceMessage).slice(0, 300);
      }
    }

    bucket[index] = next;
    updated = next;
    return data;
  });
  return updated;
}

function deleteMemory(appInstance, type, id) {
  assertValidType(type);
  const memoryId = cleanText(id);
  if (!memoryId) {
    throw new Error('Memory id is required.');
  }

  let deleted = false;
  updatePetData(appInstance, (data) => {
    const bucket = getMemoryBucket(data, type);
    const nextBucket = bucket.filter((entry) => entry.id !== memoryId);
    deleted = nextBucket.length !== bucket.length;
    data.memory[type] = nextBucket;
    return data;
  });
  return { deleted };
}

function clearExpiredShortTermMemories(appInstance) {
  const now = Date.now();
  let removed = 0;
  updatePetData(appInstance, (data) => {
    const bucket = getMemoryBucket(data, 'shortTerm');
    const active = bucket.filter((entry) => {
      if (!entry.expiresAt) return true;
      const expiresAt = Date.parse(entry.expiresAt);
      return Number.isNaN(expiresAt) || expiresAt > now;
    });
    removed = bucket.length - active.length;
    data.memory.shortTerm = active;
    return data;
  });
  return { removed };
}

function clearMemories(appInstance, type) {
  assertValidType(type);
  let removed = 0;
  updatePetData(appInstance, (data) => {
    const bucket = getMemoryBucket(data, type);
    removed = bucket.length;
    data.memory[type] = [];
    return data;
  });
  return { type, removed };
}

function clearAllMemories(appInstance) {
  const removed = { user: 0, longTerm: 0, shortTerm: 0 };
  updatePetData(appInstance, (data) => {
    for (const type of VALID_TYPES) {
      const bucket = getMemoryBucket(data, type);
      removed[type] = bucket.length;
      data.memory[type] = [];
    }
    return data;
  });
  return { removed };
}

function shouldAnalyzeMemory(text) {
  const value = cleanText(text);
  return Boolean(value && MEMORY_TRIGGER_PATTERN.test(value));
}

function shouldAnalyzeShortTermMemory(text) {
  return !isLowValueContent(text);
}

function shouldAnalyzeUserProfileMemory(text) {
  const value = cleanText(text);
  return Boolean(value && USER_PROFILE_TRIGGER_PATTERN.test(value));
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  return tags
    .map(cleanText)
    .filter(Boolean)
    .slice(0, 12);
}

function normalizeReminder(reminder) {
  if (!reminder || typeof reminder !== 'object') {
    return null;
  }
  return {
    enabled: Boolean(reminder.enabled),
    frequency: cleanText(reminder.frequency),
    time: cleanText(reminder.time),
    note: cleanText(reminder.note)
  };
}

function clampImportance(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 1;
  return Math.max(1, Math.min(5, Math.round(numeric)));
}

function normalizeUserCategory(category) {
  const cleaned = cleanText(category);
  return VALID_USER_CATEGORIES.has(cleaned) ? cleaned : 'other';
}

function findSimilarUserMemory(existingMemories = {}, decision = {}) {
  const bucket = Array.isArray(existingMemories.user) ? existingMemories.user : [];
  const category = normalizeUserCategory(decision.category);
  const key = cleanText(decision.key);
  if (!key) return null;
  return bucket.find((entry) => (
    entry
    && entry.id
    && cleanText(entry.key) === key
    && normalizeUserCategory(entry.category) === category
  )) || null;
}

function normalizeAiMemoryDecision(rawDecision, existingMemories = {}) {
  const decision = rawDecision && typeof rawDecision === 'object' ? rawDecision : {};
  const shouldRemember = Boolean(decision.shouldRemember);
  const action = VALID_ANALYSIS_ACTIONS.has(decision.action) ? decision.action : 'skip';
  const rawType = cleanText(decision.type);
  if (shouldRemember && rawType !== 'user' && rawType !== 'longTerm') {
    throw new Error('AI memory type is invalid.');
  }
  const type = rawType === 'longTerm' ? 'longTerm' : 'user';
  const content = cleanText(decision.content).slice(0, 300);
  const targetId = cleanText(decision.targetId);
  const tags = normalizeTags(decision.tags);
  const reminder = type === 'longTerm' ? normalizeReminder(decision.reminder) : null;
  const category = type === 'user' ? normalizeUserCategory(decision.category) : '';
  const key = type === 'user' ? cleanText(decision.key).slice(0, 60) : '';
  const value = type === 'user' ? cleanText(decision.value || content).slice(0, 200) : '';
  const confidence = type === 'user' ? clampImportance(decision.confidence) : 1;
  const pinned = type === 'user' ? Boolean(decision.pinned) : false;
  const sourceMessage = type === 'user' ? cleanText(decision.sourceMessage).slice(0, 300) : '';
  const reason = cleanText(decision.reason).slice(0, 200);

  if (!shouldRemember || action === 'skip') {
    return {
      shouldRemember: false,
      action: 'skip',
      type,
      targetId: '',
      content: '',
      tags: [],
      importance: 1,
      reminder: null,
      category: '',
      key: '',
      value: '',
      confidence: 1,
      pinned: false,
      sourceMessage: '',
      reason
    };
  }

  if (isLowValueContent(content)) {
    throw new Error('AI memory content is empty or low value.');
  }

  let nextAction = action;
  let nextTargetId = targetId;
  if (type === 'user' && nextAction === 'create') {
    const similar = findSimilarUserMemory(existingMemories, { category, key });
    if (similar) {
      nextAction = 'update';
      nextTargetId = similar.id;
    }
  }

  if (nextAction === 'update') {
    const bucket = Array.isArray(existingMemories[type]) ? existingMemories[type] : [];
    if (!nextTargetId || !bucket.some((entry) => entry.id === nextTargetId)) {
      throw new Error('AI memory update target is invalid.');
    }
  }

  return {
    shouldRemember: true,
    action: nextAction,
    type,
    targetId: nextTargetId,
    content,
    tags,
    importance: clampImportance(decision.importance),
    reminder,
    category,
    key,
    value,
    confidence,
    pinned,
    sourceMessage,
    reason
  };
}

function normalizeAiMemoryDecisions(rawDecision, existingMemories = {}) {
  const source = rawDecision && typeof rawDecision === 'object' && Array.isArray(rawDecision.items)
    ? rawDecision.items
    : [rawDecision];
  return source.map((item) => normalizeAiMemoryDecision(item, existingMemories));
}

function normalizeShortTermDecision(rawDecision, existingShortTerm = []) {
  const decision = rawDecision && typeof rawDecision === 'object' ? rawDecision : {};
  const shouldRemember = Boolean(decision.shouldRemember);
  const action = VALID_ANALYSIS_ACTIONS.has(decision.action) ? decision.action : 'skip';
  const topic = cleanText(decision.topic).slice(0, 40);
  const content = cleanText(decision.content).slice(0, 700);
  const targetId = cleanText(decision.targetId);
  const tags = normalizeTags(decision.tags);
  const profileCandidate = Boolean(decision.profileCandidate);
  const profileReason = cleanText(decision.profileReason).slice(0, 200);
  const reason = cleanText(decision.reason).slice(0, 200);

  if (!shouldRemember || action === 'skip') {
    return {
      shouldRemember: false,
      action: 'skip',
      targetId: '',
      topic: '',
      content: '',
      tags: [],
      importance: 1,
      profileCandidate,
      profileReason,
      reason
    };
  }

  if (isLowValueContent(content) || !topic) {
    throw new Error('AI short-term memory content or topic is invalid.');
  }

  if (action === 'update') {
    if (!targetId || !existingShortTerm.some((entry) => entry.id === targetId)) {
      throw new Error('AI short-term update target is invalid.');
    }
  }

  return {
    shouldRemember: true,
    action,
    targetId,
    topic,
    content,
    tags,
    importance: clampImportance(decision.importance),
    profileCandidate,
    profileReason,
    reason
  };
}

function applyShortTermMemory(appInstance, normalizedDecision, sourceMessage = '') {
  if (!normalizedDecision?.shouldRemember || normalizedDecision.action === 'skip') {
    return { remembered: false, action: 'skip', entry: null };
  }

  const expiresAt = new Date(Date.now() + SHORT_TERM_TTL_MS).toISOString();
  const patch = {
    content: normalizedDecision.content,
    source: 'inferred',
    tags: normalizedDecision.tags,
    importance: normalizedDecision.importance,
    topic: normalizedDecision.topic,
    sourceMessage,
    profileCandidate: normalizedDecision.profileCandidate,
    profileReason: normalizedDecision.profileReason,
    expiresAt
  };

  if (normalizedDecision.action === 'update') {
    const entry = updateMemory(appInstance, 'shortTerm', normalizedDecision.targetId, patch);
    return { remembered: true, action: 'update', entry };
  }

  const entry = addMemory(appInstance, 'shortTerm', normalizedDecision.content, patch);
  return { remembered: true, action: 'create', entry };
}

function applyAnalyzedMemory(appInstance, normalizedDecision) {
  if (!normalizedDecision?.shouldRemember || normalizedDecision.action === 'skip') {
    return { remembered: false, action: 'skip', type: normalizedDecision?.type || 'user', entry: null };
  }

  const options = {
    source: 'user_explicit',
    tags: normalizedDecision.tags,
    importance: normalizedDecision.importance,
    reminder: normalizedDecision.reminder || undefined
  };
  if (normalizedDecision.type === 'user') {
    options.category = normalizedDecision.category;
    options.key = normalizedDecision.key;
    options.value = normalizedDecision.value;
    options.confidence = normalizedDecision.confidence;
    options.pinned = normalizedDecision.pinned;
    options.sourceMessage = normalizedDecision.sourceMessage;
  }

  if (normalizedDecision.action === 'update') {
    const entry = updateMemory(
      appInstance,
      normalizedDecision.type,
      normalizedDecision.targetId,
      {
        content: normalizedDecision.content,
        source: options.source,
        tags: options.tags,
        importance: options.importance,
        reminder: options.reminder,
        category: options.category,
        key: options.key,
        value: options.value,
        confidence: options.confidence,
        pinned: options.pinned,
        sourceMessage: options.sourceMessage
      }
    );
    return { remembered: true, action: 'update', type: normalizedDecision.type, entry };
  }

  const entry = addMemory(appInstance, normalizedDecision.type, normalizedDecision.content, options);
  return { remembered: true, action: 'create', type: normalizedDecision.type, entry };
}

function applyAnalyzedMemories(appInstance, normalizedDecisions) {
  const applied = [];
  for (const decision of normalizedDecisions) {
    const result = applyAnalyzedMemory(appInstance, decision);
    if (result.remembered) {
      applied.push(result);
    }
  }
  return applied;
}

function getExpiredShortTermMemories(appInstance) {
  const now = Date.now();
  const data = loadPetData(appInstance);
  const bucket = getMemoryBucket(data, 'shortTerm');
  return bucket.filter((entry) => {
    if (!entry.expiresAt) return false;
    const expiresAt = Date.parse(entry.expiresAt);
    return !Number.isNaN(expiresAt) && expiresAt <= now;
  });
}

function deleteShortTermMemoriesByIds(appInstance, ids = []) {
  const idSet = new Set(ids.map(cleanText).filter(Boolean));
  if (!idSet.size) return { removed: 0 };

  let removed = 0;
  updatePetData(appInstance, (data) => {
    const bucket = getMemoryBucket(data, 'shortTerm');
    const active = bucket.filter((entry) => !idSet.has(entry.id));
    removed = bucket.length - active.length;
    data.memory.shortTerm = active;
    return data;
  });
  return { removed };
}

function detectExplicitMemoryIntent(text) {
  return {
    matched: false,
    shouldAnalyze: shouldAnalyzeMemory(text)
  };
}

module.exports = {
  listMemories,
  addMemory,
  updateMemory,
  deleteMemory,
  clearMemories,
  clearAllMemories,
  clearExpiredShortTermMemories,
  detectExplicitMemoryIntent,
  shouldAnalyzeMemory,
  shouldAnalyzeShortTermMemory,
  shouldAnalyzeUserProfileMemory,
  normalizeAiMemoryDecision,
  normalizeAiMemoryDecisions,
  normalizeShortTermDecision,
  applyShortTermMemory,
  applyAnalyzedMemory,
  applyAnalyzedMemories,
  getExpiredShortTermMemories,
  deleteShortTermMemoriesByIds
};
