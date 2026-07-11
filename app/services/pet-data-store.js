const fs = require('fs');
const path = require('path');

const DATA_FILE_NAME = 'pet-data.json';
const BACKUP_SUFFIX = '.bak';
const TEMP_SUFFIX = '.tmp';

function nowIso() {
  return new Date().toISOString();
}

function atomicWriteJson(filePath, data) {
  const dir = path.dirname(filePath);
  const tempPath = filePath + TEMP_SUFFIX;
  const backupPath = filePath + BACKUP_SUFFIX;
  const serialized = JSON.stringify(data, null, 2);

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(tempPath, serialized, 'utf8');

  const reparsed = JSON.parse(fs.readFileSync(tempPath, 'utf8'));
  if (JSON.stringify(reparsed, null, 2) !== serialized) {
    throw new Error('Atomic write verification failed: temp file content mismatch.');
  }

  if (fs.existsSync(filePath)) {
    try {
      fs.copyFileSync(filePath, backupPath);
    } catch {
      // 备份失败不阻断写入
    }
  }

  fs.renameSync(tempPath, filePath);
}

function readJsonWithFallback(filePath) {
  const backupPath = filePath + BACKUP_SUFFIX;
  const errors = [];

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return { data: JSON.parse(raw), source: 'main', recovered: false, errors };
  } catch (error) {
    errors.push(`main: ${error?.message || error}`);
  }

  try {
    const raw = fs.readFileSync(backupPath, 'utf8');
    const parsed = JSON.parse(raw);
    return { data: parsed, source: 'backup', recovered: true, errors };
  } catch (error) {
    errors.push(`backup: ${error?.message || error}`);
  }

  return { data: null, source: 'none', recovered: false, errors };
}

function createMemoryEntry(overrides = {}) {
  const timestamp = nowIso();
  return {
    id: '',
    content: '',
    source: 'user_explicit',
    importance: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    lastUsedAt: '',
    tags: [],
    ...overrides
  };
}

function getDefaultPetData() {
  const timestamp = nowIso();
  return {
    version: 1,
    profile: {
      userName: '',
      preferredName: '',
      notes: []
    },
    memory: {
      user: [],
      longTerm: [],
      shortTerm: []
    },
    affection: {
      score: 50,
      level: 'familiar',
      lastUpdatedAt: '',
      events: [],
      cooldown: {
        lastPositiveText: '',
        lastPositiveAt: '',
        lastNegativeText: '',
        lastNegativeAt: ''
      }
    },
    chat: {
      sessions: [],
      lastSessionId: ''
    },
    prompt: {
      lastPromptStats: {
        estimatedChars: 0,
        memoryInjectedCount: 0,
        historyMessageCount: 0
      }
    },
    meta: {
      createdAt: timestamp,
      updatedAt: timestamp
    }
  };
}

function getPetDataPath(appInstance) {
  return path.join(appInstance.getPath('userData'), DATA_FILE_NAME);
}

function getAffectionLevel(score) {
  const numericScore = Number(score);
  const value = Math.max(0, Math.min(100, Number.isFinite(numericScore) ? numericScore : 50));
  if (value <= 20) return 'distant';
  if (value <= 40) return 'polite';
  if (value <= 60) return 'familiar';
  if (value <= 80) return 'close';
  return 'intimate';
}

function normalizeMemoryEntry(entry = {}, type = 'user') {
  const fallback = createMemoryEntry();
  const normalized = {
    ...fallback,
    ...entry,
    source: ['user_explicit', 'inferred', 'system'].includes(entry.source) ? entry.source : fallback.source,
    importance: Number.isFinite(Number(entry.importance)) ? Number(entry.importance) : fallback.importance,
    tags: Array.isArray(entry.tags) ? entry.tags : []
  };

  if (type === 'longTerm') {
    normalized.reminder = {
      enabled: false,
      frequency: '',
      time: '',
      note: '',
      ...(entry.reminder && typeof entry.reminder === 'object' ? entry.reminder : {})
    };
  }

  if (type === 'shortTerm') {
    normalized.expiresAt = typeof entry.expiresAt === 'string' ? entry.expiresAt : '';
    normalized.topic = typeof entry.topic === 'string' ? entry.topic : '';
    normalized.sourceMessage = typeof entry.sourceMessage === 'string' ? entry.sourceMessage : '';
    normalized.profileCandidate = Boolean(entry.profileCandidate);
    normalized.profileReason = typeof entry.profileReason === 'string' ? entry.profileReason : '';
  }

  if (type === 'user') {
    normalized.category = typeof entry.category === 'string' ? entry.category : '';
    normalized.key = typeof entry.key === 'string' ? entry.key : '';
    normalized.value = typeof entry.value === 'string' ? entry.value : '';
    normalized.confidence = Number.isFinite(Number(entry.confidence)) ? Number(entry.confidence) : 1;
    normalized.pinned = Boolean(entry.pinned);
    normalized.sourceMessage = typeof entry.sourceMessage === 'string' ? entry.sourceMessage : '';
  }

  return normalized;
}

function normalizePetData(input = {}) {
  const fallback = getDefaultPetData();
  const data = input && typeof input === 'object' ? input : {};
  const memory = data.memory && typeof data.memory === 'object' ? data.memory : {};
  const prompt = data.prompt && typeof data.prompt === 'object' ? data.prompt : {};
  const affection = data.affection && typeof data.affection === 'object' ? data.affection : {};
  const affectionScore = Number.isFinite(Number(affection.score)) ? Number(affection.score) : fallback.affection.score;

  return {
    ...fallback,
    ...data,
    version: 1,
    profile: {
      ...fallback.profile,
      ...(data.profile && typeof data.profile === 'object' ? data.profile : {}),
      notes: Array.isArray(data.profile?.notes) ? data.profile.notes : []
    },
    memory: {
      user: Array.isArray(memory.user) ? memory.user.map((entry) => normalizeMemoryEntry(entry, 'user')) : [],
      longTerm: Array.isArray(memory.longTerm)
        ? memory.longTerm.map((entry) => normalizeMemoryEntry(entry, 'longTerm'))
        : [],
      shortTerm: Array.isArray(memory.shortTerm)
        ? memory.shortTerm.map((entry) => normalizeMemoryEntry(entry, 'shortTerm'))
        : []
    },
    affection: {
      ...fallback.affection,
      ...affection,
      score: Math.max(0, Math.min(100, Math.round(affectionScore))),
      level: getAffectionLevel(affectionScore),
      events: Array.isArray(affection.events) ? affection.events.slice(-50) : [],
      cooldown: {
        ...fallback.affection.cooldown,
        ...(affection.cooldown && typeof affection.cooldown === 'object' ? affection.cooldown : {})
      }
    },
    chat: {
      ...fallback.chat,
      ...(data.chat && typeof data.chat === 'object' ? data.chat : {}),
      sessions: Array.isArray(data.chat?.sessions) ? data.chat.sessions : []
    },
    prompt: {
      ...fallback.prompt,
      ...prompt,
      profileSummaryLastUpdatedAt: typeof prompt.profileSummaryLastUpdatedAt === 'string'
        ? prompt.profileSummaryLastUpdatedAt
        : '',
      conversationPersonalityId: typeof prompt.conversationPersonalityId === 'string'
        ? prompt.conversationPersonalityId
        : '',
      conversationHarnessState: prompt.conversationHarnessState && typeof prompt.conversationHarnessState === 'object'
        ? prompt.conversationHarnessState
        : {},
      lastPromptStats: {
        ...fallback.prompt.lastPromptStats,
        ...(prompt.lastPromptStats && typeof prompt.lastPromptStats === 'object' ? prompt.lastPromptStats : {})
      }
    },
    meta: {
      ...fallback.meta,
      ...(data.meta && typeof data.meta === 'object' ? data.meta : {})
    }
  };
}

function writePetData(appInstance, data) {
  const dataPath = getPetDataPath(appInstance);
  const nextData = normalizePetData(data);
  nextData.meta.updatedAt = nowIso();
  atomicWriteJson(dataPath, nextData);
  return nextData;
}

function loadPetData(appInstance) {
  const dataPath = getPetDataPath(appInstance);
  const result = readJsonWithFallback(dataPath);
  if (result.data) {
    const normalized = normalizePetData(result.data);
    if (result.recovered || JSON.stringify(result.data) !== JSON.stringify(normalized)) {
      atomicWriteJson(dataPath, normalized);
    }
    return normalized;
  }
  return writePetData(appInstance, getDefaultPetData());
}

function savePetData(appInstance, data) {
  return writePetData(appInstance, data);
}

function updatePetData(appInstance, updater) {
  const current = loadPetData(appInstance);
  const next = typeof updater === 'function' ? updater(current) : updater;
  return savePetData(appInstance, next || current);
}

module.exports = {
  getDefaultPetData,
  loadPetData,
  savePetData,
  updatePetData,
  atomicWriteJson,
  readJsonWithFallback
};
