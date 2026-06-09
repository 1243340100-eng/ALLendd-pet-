const crypto = require('crypto');
const { loadPetData, updatePetData } = require('./pet-data-store');

const VALID_TYPES = new Set(['user', 'longTerm', 'shortTerm']);
const VALID_SOURCES = new Set(['user_explicit', 'inferred', 'system']);
const MAX_EDIT_CONTENT_CHARS = 300;
const LOW_VALUE_CONTENT = new Set([
  '哈哈',
  '哈哈哈',
  '嗯',
  '好的',
  '好',
  'ok',
  'OK',
  '天气不错'
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
    entry.expiresAt = cleanText(options.expiresAt);
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

function makeMatch(type, content, tags = [], reminder = null) {
  const cleaned = cleanText(content);
  if (isLowValueContent(cleaned)) {
    return { matched: false };
  }
  return {
    matched: true,
    type,
    content: cleaned,
    tags,
    reminder
  };
}

function detectReminderFrequency(text) {
  if (/每天|每日/u.test(text)) return 'daily';
  if (/每周|每星期/u.test(text)) return 'weekly';
  if (/每月/u.test(text)) return 'monthly';
  if (/以后/u.test(text)) return 'recurring';
  return 'once';
}

function detectReminderTime(text) {
  const value = cleanText(text);
  const match = value.match(/(?:早上|上午|中午|下午|晚上|夜里|睡前)?\s*(?:[0-2]?\d|[一二三四五六七八九十两]{1,3})\s*(?:点|:|：)\s*(?:[0-5]?\d\s*分?)?/u);
  if (match) return cleanText(match[0]);
  if (/睡前/u.test(value)) return '睡前';
  if (/饭后/u.test(value)) return '饭后';
  if (/饭前/u.test(value)) return '饭前';
  return '';
}

function makeReminderMatch(content, tags = ['reminder']) {
  const cleaned = cleanText(content);
  return makeMatch('longTerm', cleaned, tags, {
    enabled: true,
    frequency: detectReminderFrequency(cleaned),
    time: detectReminderTime(cleaned),
    note: cleaned
  });
}

function detectExplicitMemoryIntent(text) {
  const value = cleanText(text);
  if (!value) return { matched: false };

  const medicationKeywords = /(吃药|用药|服药|药|复查)/u;
  const reminderIntent = /(提醒我|记住|帮我记住|以后|每天|每日|每周|每星期|时间是|要吃药|要用药|要服药)/u;
  if (medicationKeywords.test(value) && reminderIntent.test(value)) {
    return makeReminderMatch(value, ['reminder', 'medication']);
  }

  const genericReminderPatterns = [
    /^(?:请你)?(?:以后)?(?:每天|每日|每周|每星期|每月)?.*提醒我(.+)/u,
    /^提醒我(.+)/u,
    /^(.+?)提醒我(.+)/u
  ];

  for (const pattern of genericReminderPatterns) {
    if (pattern.test(value)) {
      return makeReminderMatch(value, ['reminder']);
    }
  }

  const userPatterns = [
    { pattern: /(?:请你)?记住我叫(.+)/u, tag: 'name', format: (match) => `我叫${cleanText(match[1])}` },
    { pattern: /我的名字是(.+)/u, tag: 'name', format: (match) => `我的名字是${cleanText(match[1])}` },
    { pattern: /以后叫我(.+)/u, tag: 'preferredName', format: (match) => `以后叫我${cleanText(match[1])}` },
    { pattern: /我喜欢(.+)/u, tag: 'preference', format: (match) => `我喜欢${cleanText(match[1])}` },
    { pattern: /我不喜欢(.+)/u, tag: 'preference', format: (match) => `我不喜欢${cleanText(match[1])}` },
    { pattern: /我的生日是(.+)/u, tag: 'birthday', format: (match) => `我的生日是${cleanText(match[1])}` },
    { pattern: /我是(.+)/u, tag: 'profile', format: (match) => `我是${cleanText(match[1])}` }
  ];

  for (const rule of userPatterns) {
    const match = value.match(rule.pattern);
    if (match) {
      return makeMatch('user', rule.format(match), [rule.tag], null);
    }
  }

  const reminderRules = [
    { pattern: /(?:请你)?以后提醒我(.+)/u, frequency: 'once' },
    { pattern: /(?:请你)?每天提醒我(.+)/u, frequency: 'daily' },
    { pattern: /(?:请你)?每周提醒我(.+)/u, frequency: 'weekly' }
  ];

  for (const rule of reminderRules) {
    const match = value.match(rule.pattern);
    if (match) {
      const note = cleanText(match[1]);
      return makeMatch('longTerm', note, ['reminder'], {
        enabled: true,
        frequency: rule.frequency,
        time: '',
        note
      });
    }
  }

  const longTermPatterns = [
    { pattern: /(?:请你)?记住这件事(.+)/u, tag: 'longTerm' },
    { pattern: /(?:请你)?帮我记住(.+)/u, tag: 'longTerm' }
  ];

  for (const rule of longTermPatterns) {
    const match = value.match(rule.pattern);
    if (match) {
      return makeMatch('longTerm', match[1], [rule.tag], null);
    }
  }

  return { matched: false };
}

module.exports = {
  listMemories,
  addMemory,
  updateMemory,
  deleteMemory,
  clearMemories,
  clearAllMemories,
  clearExpiredShortTermMemories,
  detectExplicitMemoryIntent
};
