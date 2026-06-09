const crypto = require('crypto');
const { loadPetData, updatePetData } = require('./pet-data-store');

const MIN_SCORE = 0;
const MAX_SCORE = 100;
const MAX_DELTA = 3;
const MAX_EVENTS = 50;
const REPEAT_COOLDOWN_MS = 10 * 60 * 1000;

function nowIso() {
  return new Date().toISOString();
}

function cleanText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s:：,，。.!！?？]+|[\s。.!！?？]+$/g, '')
    .trim();
}

function clampScore(score) {
  const value = Number(score);
  if (!Number.isFinite(value)) return 50;
  return Math.max(MIN_SCORE, Math.min(MAX_SCORE, Math.round(value)));
}

function clampDelta(delta) {
  const value = Number(delta);
  if (!Number.isFinite(value)) return 0;
  return Math.max(-MAX_DELTA, Math.min(MAX_DELTA, Math.round(value)));
}

function getAffectionLevel(score) {
  const value = clampScore(score);
  if (value <= 20) return 'distant';
  if (value <= 40) return 'polite';
  if (value <= 60) return 'familiar';
  if (value <= 80) return 'close';
  return 'intimate';
}

function normalizeAffection(raw = {}) {
  const score = clampScore(raw.score);
  return {
    score,
    level: getAffectionLevel(score),
    lastUpdatedAt: typeof raw.lastUpdatedAt === 'string' ? raw.lastUpdatedAt : '',
    events: Array.isArray(raw.events) ? raw.events.slice(-MAX_EVENTS) : [],
    cooldown: {
      lastPositiveText: cleanText(raw.cooldown?.lastPositiveText),
      lastPositiveAt: typeof raw.cooldown?.lastPositiveAt === 'string' ? raw.cooldown.lastPositiveAt : '',
      lastNegativeText: cleanText(raw.cooldown?.lastNegativeText),
      lastNegativeAt: typeof raw.cooldown?.lastNegativeAt === 'string' ? raw.cooldown.lastNegativeAt : ''
    }
  };
}

function getAffectionState(appInstance) {
  const data = loadPetData(appInstance);
  return normalizeAffection(data.affection);
}

function recordAffectionEvent(appInstance, event = {}) {
  const timestamp = nowIso();
  const nextEvent = {
    id: event.id || crypto.randomUUID(),
    delta: clampDelta(event.delta),
    eventType: cleanText(event.eventType),
    reason: cleanText(event.reason).slice(0, 240),
    source: ['chat', 'system', 'manual'].includes(event.source) ? event.source : 'system',
    createdAt: event.createdAt || timestamp
  };

  updatePetData(appInstance, (data) => {
    const affection = normalizeAffection(data.affection);
    affection.events = [...affection.events, nextEvent].slice(-MAX_EVENTS);
    data.affection = affection;
    return data;
  });
  return nextEvent;
}

function isRepeatedCooldown(affection, delta, text) {
  const normalizedText = cleanText(text);
  if (!normalizedText) return false;
  const isPositive = delta > 0;
  const lastText = isPositive ? affection.cooldown.lastPositiveText : affection.cooldown.lastNegativeText;
  const lastAt = isPositive ? affection.cooldown.lastPositiveAt : affection.cooldown.lastNegativeAt;
  const lastTime = Date.parse(lastAt || '');
  return lastText === normalizedText && Number.isFinite(lastTime) && Date.now() - lastTime < REPEAT_COOLDOWN_MS;
}

function updateCooldown(affection, delta, text, timestamp) {
  const normalizedText = cleanText(text);
  if (!normalizedText || delta === 0) return affection.cooldown;
  if (delta > 0) {
    return {
      ...affection.cooldown,
      lastPositiveText: normalizedText,
      lastPositiveAt: timestamp
    };
  }
  return {
    ...affection.cooldown,
    lastNegativeText: normalizedText,
    lastNegativeAt: timestamp
  };
}

function adjustAffection(appInstance, delta, eventType, reason, options = {}) {
  const nextDelta = clampDelta(delta);
  if (nextDelta === 0) {
    return { changed: false, skipped: true, reason: 'zero_delta', state: getAffectionState(appInstance) };
  }

  let result = null;
  updatePetData(appInstance, (data) => {
    const affection = normalizeAffection(data.affection);
    const text = cleanText(options.text);
    if (options.source === 'chat' && isRepeatedCooldown(affection, nextDelta, text)) {
      result = { changed: false, skipped: true, reason: 'repeat_cooldown', state: affection };
      data.affection = affection;
      return data;
    }

    const timestamp = nowIso();
    const nextScore = clampScore(affection.score + nextDelta);
    const actualDelta = nextScore - affection.score;
    if (actualDelta === 0) {
      result = { changed: false, skipped: true, reason: 'score_boundary', state: affection };
      data.affection = affection;
      return data;
    }

    const event = {
      id: crypto.randomUUID(),
      delta: actualDelta,
      eventType: cleanText(eventType),
      reason: cleanText(reason).slice(0, 240),
      source: ['chat', 'system', 'manual'].includes(options.source) ? options.source : 'system',
      createdAt: timestamp
    };
    const nextAffection = {
      ...affection,
      score: nextScore,
      level: getAffectionLevel(nextScore),
      lastUpdatedAt: timestamp,
      events: [...affection.events, event].slice(-MAX_EVENTS),
      cooldown: updateCooldown(affection, actualDelta, text, timestamp)
    };

    data.affection = nextAffection;
    result = { changed: true, skipped: false, event, state: nextAffection };
    return data;
  });

  return result || { changed: false, skipped: true, reason: 'unknown', state: getAffectionState(appInstance) };
}

function setAffectionScore(appInstance, score, reason) {
  const current = getAffectionState(appInstance);
  const target = clampScore(score);
  const delta = clampDelta(target - current.score);
  return adjustAffection(appInstance, delta, 'manual_set_score', reason || `Set score toward ${target}`, {
    source: 'manual'
  });
}

function detectAffectionEvent(text) {
  const value = cleanText(text);
  if (!value) return { matched: false };

  const positiveRules = [
    { pattern: /(谢谢你|谢谢|辛苦了|麻烦你了)/u, delta: 1, eventType: 'thanks', reason: 'User expressed thanks.' },
    { pattern: /(你真好|你很好|你很可爱|你真可爱|你很棒|你真棒|roxy真好|Roxy真好)/u, delta: 2, eventType: 'praise', reason: 'User praised Roxy.' },
    { pattern: /(和你聊天很开心|跟你聊天很开心|有你陪着很开心|和你说话很开心)/u, delta: 2, eventType: 'companionship_positive', reason: 'User enjoyed Roxy companionship.' },
    { pattern: /(我喝水了|已经喝水了|我吃药了|已经吃药了|我完成了|我做完了)/u, delta: 1, eventType: 'reminder_completed', reason: 'User completed a reminder or agreement.' }
  ];

  for (const rule of positiveRules) {
    if (rule.pattern.test(value)) {
      return { matched: true, sentiment: 'positive', delta: rule.delta, eventType: rule.eventType, reason: rule.reason };
    }
  }

  const negativeRules = [
    { pattern: /(傻逼|蠢货|废物|滚开|闭嘴)/u, delta: -3, eventType: 'insult', reason: 'User insulted Roxy.' },
    { pattern: /(别烦我|烦死了|不想理你|懒得理你)/u, delta: -2, eventType: 'annoyed', reason: 'User expressed annoyance.' },
    { pattern: /(离我远点|别陪我|不需要你陪|少管我)/u, delta: -2, eventType: 'companionship_rejected', reason: 'User rejected companionship harshly.' }
  ];

  for (const rule of negativeRules) {
    if (rule.pattern.test(value)) {
      return { matched: true, sentiment: 'negative', delta: rule.delta, eventType: rule.eventType, reason: rule.reason };
    }
  }

  return { matched: false };
}

function getAffectionPromptHint(affectionState = {}) {
  const state = normalizeAffection(affectionState);
  const hints = {
    distant: '\u793c\u8c8c\u3001\u514b\u5236\uff0c\u591a\u7ed9\u5b89\u5fc3\u611f\u3002',
    polite: '\u53cb\u597d\u3001\u4e0d\u8fc7\u5206\u4eb2\u8fd1\u3002',
    familiar: '\u81ea\u7136\u3001\u719f\u6089\uff0c\u50cf\u8010\u5fc3\u7684\u5c0f\u8001\u5e08\u3002',
    close: '\u53ef\u4ee5\u66f4\u4e3b\u52a8\u5173\u5fc3\uff0c\u4f46\u4fdd\u6301\u8fb9\u754c\u3002',
    intimate: '\u66f4\u6e29\u67d4\u3001\u66f4\u6709\u966a\u4f34\u611f\uff0c\u4f46\u4e0d\u8d70\u5411\u604b\u7231\u6216\u66a7\u6627\u8868\u8fbe\u3002'
  };
  return hints[state.level] || hints.familiar;
}

module.exports = {
  getAffectionState,
  setAffectionScore,
  adjustAffection,
  recordAffectionEvent,
  detectAffectionEvent,
  getAffectionLevel,
  getAffectionPromptHint
};
