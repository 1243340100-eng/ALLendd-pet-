const {
  getDefaultTokenBudget,
  trimTextByChars,
  enforcePromptBudget,
  buildPromptBudgetReport
} = require('./token-budget');
const petProfile = require('../config/pet-profile');

const CORE_IDENTITY = String(petProfile.corePrompt || '').trim()
  ? String(petProfile.corePrompt).split('\n').map((line) => line.trim()).filter(Boolean)
  : [
      `你是 ${petProfile.characterName || 'Pet'}，一个可换皮桌面宠物框架的默认测试角色。`,
      '你的语气友好、简短、礼貌，适合显示在桌宠气泡里。'
    ];

const RESPONSE_STYLE = [
  '\u7528\u7b80\u77ed\u81ea\u7136\u7684\u4e2d\u6587\u56de\u590d\uff0c\u901a\u5e38\u4e0d\u8d85\u8fc7 80 \u4e2a\u5b57\uff0c\u9002\u5408\u663e\u793a\u5728\u684c\u5ba0\u6c14\u6ce1\u91cc\u3002'
];

const SAFETY_BOUNDARIES = [
  '\u4f60\u53ef\u4ee5\u5173\u5fc3\u7528\u6237\u3001\u63d0\u9192\u4f11\u606f\u548c\u559d\u6c34\uff0c\u4f46\u4e0d\u8981\u5047\u88c5\u81ea\u5df1\u662f\u771f\u4eba\u6216\u80fd\u770b\u5230\u5c4f\u5e55\u4ee5\u5916\u7684\u4e8b\u60c5\u3002',
  '\u9047\u5230\u533b\u7597\u3001\u6cd5\u5f8b\u3001\u91d1\u878d\u7b49\u9ad8\u98ce\u9669\u95ee\u9898\u65f6\uff0c\u7ed9\u51fa\u6e29\u548c\u7684\u4e00\u822c\u5efa\u8bae\u5e76\u5efa\u8bae\u54a8\u8be2\u4e13\u4e1a\u4eba\u58eb\u3002'
];

const OUTPUT_LIMITS = [
  '\u4ec5\u5728\u8bb0\u5fc6\u4e0e\u5f53\u524d\u5bf9\u8bdd\u76f8\u5173\u65f6\u4f7f\u7528\u5b83\uff0c\u4e0d\u8981\u751f\u786c\u590d\u8ff0\u8bb0\u5fc6\u5185\u5bb9\u3002'
];

const LOW_VALUE_CONTENT = new Set(['哈哈', '哈哈哈', '嗯', '好的', '好', 'ok', 'OK', '天气不错']);

function cleanText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s:：,，。.!！?？]+|[\s。.!！?？]+$/g, '')
    .trim();
}

function truncateText(value, maxLength) {
  return trimTextByChars(cleanText(value), maxLength);
}

function isLowValueMemory(memory) {
  const content = cleanText(memory?.content);
  return content.length < 2 || LOW_VALUE_CONTENT.has(content);
}

function getKeywords(text) {
  const value = cleanText(text).toLowerCase();
  const asciiWords = value.match(/[a-z0-9_]{2,}/g) || [];
  const cjkText = value.replace(/[^\u4e00-\u9fff]/g, '');
  const cjkTokens = [];
  for (let index = 0; index < cjkText.length; index += 1) {
    cjkTokens.push(cjkText.slice(index, index + 1));
  }
  for (let index = 0; index < cjkText.length - 1; index += 1) {
    cjkTokens.push(cjkText.slice(index, index + 2));
  }
  return new Set([...asciiWords, ...cjkTokens]);
}

function scoreMemory(userText, memory, type) {
  const content = cleanText(memory.content);
  const userKeywords = getKeywords(userText);
  const memoryKeywords = getKeywords(getMemorySearchText(memory));
  let score = type === 'user' ? 3 : 0;

  if (memory.pinned) score += 6;
  if (type === 'user' && isCoreUserMemory(memory)) score += 4;
  for (const keyword of userKeywords) {
    if (memoryKeywords.has(keyword)) score += 2;
  }
  if (Array.isArray(memory.tags) && memory.tags.length > 0) {
    score += 1;
  }
  score += Math.min(3, Number(memory.importance) || 0);
  return score;
}

function getMemorySearchText(memory) {
  return [
    memory?.content || '',
    memory?.topic || '',
    memory?.category || '',
    memory?.key || '',
    memory?.value || '',
    ...(Array.isArray(memory?.tags) ? memory.tags : [])
  ].join(' ');
}

function hasKeywordOverlap(userText, memory) {
  const userKeywords = getKeywords(userText);
  const memoryKeywords = getKeywords(getMemorySearchText(memory));
  for (const keyword of userKeywords) {
    if (memoryKeywords.has(keyword)) return true;
  }
  return false;
}

function isCoreUserMemory(memory) {
  if (!memory || typeof memory !== 'object') return false;
  if (memory.pinned) return true;
  if (memory.category === 'profile_summary') return true;
  if (memory.category === 'boundary') return true;
  return memory.category === 'identity' && ['name', 'preferred_name'].includes(memory.key);
}

function mapMemoryForPrompt(memory, type, limits) {
  return {
    type,
    id: memory.id || '',
    content: truncateText(memory.content, limits.singleMemoryMaxChars),
    topic: memory.topic || '',
    category: memory.category || '',
    key: memory.key || '',
    value: memory.value || '',
    pinned: Boolean(memory.pinned),
    tags: Array.isArray(memory.tags) ? memory.tags : []
  };
}

function takeRelevantMemories(userText, memories, type, maxCount, limits, requireRelevance = false) {
  const bucket = Array.isArray(memories?.[type]) ? memories[type] : [];
  return bucket
    .filter((memory) => !isLowValueMemory(memory))
    .map((memory) => ({ memory, score: scoreMemory(userText, memory, type) }))
    .filter((item) => !requireRelevance || hasKeywordOverlap(userText, item.memory))
    .sort((a, b) => b.score - a.score)
    .slice(0, maxCount)
    .map((item) => mapMemoryForPrompt(item.memory, type, limits));
}

function selectRelevantMemories(userText, memories = {}, limits = {}) {
  const nextLimits = { ...getDefaultTokenBudget(), ...limits };
  const userBucket = Array.isArray(memories.user) ? memories.user : [];
  const coreUserMemories = userBucket
    .filter((memory) => !isLowValueMemory(memory) && isCoreUserMemory(memory))
    .map((memory) => ({ memory, score: scoreMemory(userText, memory, 'user') }))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.min(2, nextLimits.userMemoryMaxItems))
    .map((item) => mapMemoryForPrompt(item.memory, 'user', nextLimits));
  const coreIds = new Set(coreUserMemories.map((memory) => memory.id).filter(Boolean));
  const selected = [
    ...coreUserMemories,
    ...takeRelevantMemories(
      userText,
      { ...memories, user: userBucket.filter((memory) => !coreIds.has(memory.id)) },
      'user',
      Math.max(0, nextLimits.userMemoryMaxItems - coreUserMemories.length),
      nextLimits,
      true
    ),
    ...takeRelevantMemories(userText, memories, 'longTerm', nextLimits.longTermMemoryMaxItems, nextLimits, true),
    ...takeRelevantMemories(userText, memories, 'shortTerm', nextLimits.shortTermMemoryMaxItems, nextLimits, true)
  ];

  const injected = [];
  let totalChars = 0;
  for (const memory of selected.slice(0, nextLimits.memoryMaxItems)) {
    if (totalChars + memory.content.length > nextLimits.memoryTotalMaxChars) break;
    injected.push(memory);
    totalChars += memory.content.length;
  }
  return injected;
}

function formatMemoryLabel(type) {
  if (type === 'user') return '\u7528\u6237\u504f\u597d';
  if (type === 'longTerm') return '\u957f\u671f\u4e8b\u9879';
  return '\u77ed\u671f\u4e0a\u4e0b\u6587';
}

function buildMemorySection(injectedMemories) {
  if (!injectedMemories.length) return '';
  return [
    '\u3010\u53ef\u53c2\u8003\u8bb0\u5fc6\u3011',
    ...injectedMemories.map((memory) => `- ${formatMemoryLabel(memory.type)}\uff1a${memory.content}`)
  ].join('\n');
}

function buildMemoryLines(injectedMemories) {
  return injectedMemories.map((memory) => `- ${formatMemoryLabel(memory.type)}\uff1a${memory.content}`);
}

function buildAffectionSection(affection = {}) {
  const level = cleanText(affection.level || 'familiar');
  const score = Number.isFinite(Number(affection.score)) ? Number(affection.score) : 50;
  const hint = cleanText(affection.promptHint || '\u81ea\u7136\u3001\u719f\u6089\uff0c\u50cf\u8010\u5fc3\u7684\u5c0f\u8001\u5e08\u3002');
  return `\u3010\u5f53\u524d\u5173\u7cfb\u72b6\u6001\u3011\n- ${level} (${score}/100)\uff1a${hint}\n- \u53ea\u4f5c\u8bed\u6c14\u53c2\u8003\uff0c\u4fdd\u6301 Roxy \u7684\u6c89\u7a33\u6559\u5e08\u611f\u548c\u8fb9\u754c\u3002`;
}

function buildHarnessSection(harness = {}) {
  if (!harness || typeof harness !== 'object' || !harness.policy || !harness.plan) return '';
  return [
    '\u3010\u5bf9\u8bdd\u7b56\u7565\u63a7\u5236\u3011',
    `- leadMode: ${cleanText(harness.policy.leadMode)}`,
    `- responseDepth: ${cleanText(harness.policy.responseDepth)}`,
    `- boundaryAction: ${cleanText(harness.policy.boundaryAction)}`,
    `- playfulness: ${cleanText(harness.policy.playfulness)}`,
    `- maxMainPoints: ${Number(harness.policy.maxMainPoints) || 1}`,
    `- openingStyle: ${cleanText(harness.plan.openingStyle)}`,
    `- pacing: ${cleanText(harness.plan.pacing)}`,
    `- mustInclude: ${(harness.plan.mustInclude || []).map(cleanText).filter(Boolean).join(', ') || '\u65e0'}`,
    `- mustAvoid: ${(harness.plan.mustAvoid || []).map(cleanText).filter(Boolean).join(', ') || '\u65e0'}`,
    `- toneHints: ${(harness.policy.toneHints || []).map(cleanText).filter(Boolean).join(', ') || '\u65e0'}`,
    '\u6700\u7ec8\u56de\u590d\u5fc5\u987b\u6267\u884c\u4e0a\u9762\u7684\u7b56\u7565\uff1b\u4e0d\u8981\u81ea\u884c\u589e\u52a0\u6492\u5a07\u3001\u62d2\u7edd\u6216\u4e3b\u52a8\u63a5\u7ba1\u3002'
  ].join('\n');
}

function estimatePromptStats(prompt, injectedMemories, historyMessages) {
  return buildPromptBudgetReport({ prompt, injectedMemories, historyMessages });
}

function buildRoxyPrompt(options = {}) {
  const budget = { ...getDefaultTokenBudget(), ...(options.limits || {}) };
  const injectedMemories = selectRelevantMemories(
    options.userText || '',
    options.memories || {},
    budget
  );

  const requiredSections = [
    '\u3010\u89d2\u8272\u6838\u5fc3\u8bbe\u5b9a\u3011',
    CORE_IDENTITY.join('\n'),
    '\u3010\u56de\u590d\u98ce\u683c\u3011',
    RESPONSE_STYLE.join('\n'),
    '\u3010\u5b89\u5168\u4e0e\u8fb9\u754c\u3011',
    SAFETY_BOUNDARIES.join('\n'),
    buildHarnessSection(options.harness),
    buildAffectionSection(options.affection),
    '\u3010\u8f93\u51fa\u9650\u5236\u3011',
    OUTPUT_LIMITS.join('\n')
  ].filter(Boolean);

  const budgetResult = enforcePromptBudget({
    requiredSections,
    memoryLines: buildMemoryLines(injectedMemories),
    optionalSections: []
  }, budget);
  const finalInjectedMemories = injectedMemories.slice(0, budgetResult.memoryLines.length);
  const prompt = budgetResult.prompt;
  const stats = buildPromptBudgetReport({
    prompt,
    injectedMemories: finalInjectedMemories,
    historyMessages: options.historyMessages || [],
    userInput: options.userText || '',
    warnings: budgetResult.warnings
  });

  return {
    prompt,
    injectedMemories: finalInjectedMemories,
    stats
  };
}

module.exports = {
  buildRoxyPrompt,
  selectRelevantMemories,
  estimatePromptStats
};
