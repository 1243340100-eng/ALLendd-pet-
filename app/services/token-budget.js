const DEFAULT_TOKEN_BUDGET = {
  systemPromptMaxChars: 3500,
  memoryTotalMaxChars: 600,
  singleMemoryMaxChars: 120,
  historyMaxMessages: 10,
  singleHistoryMessageMaxChars: 600,
  userInputMaxChars: 1000,
  responseMaxTokens: 220,
  memoryMaxItems: 5,
  userMemoryMaxItems: 3,
  longTermMemoryMaxItems: 2,
  shortTermMemoryMaxItems: 1
};

function getDefaultTokenBudget() {
  return { ...DEFAULT_TOKEN_BUDGET };
}

function normalizeLimits(limits = {}) {
  const next = { ...DEFAULT_TOKEN_BUDGET, ...(limits && typeof limits === 'object' ? limits : {}) };
  for (const [key, value] of Object.entries(DEFAULT_TOKEN_BUDGET)) {
    const numberValue = Number(next[key]);
    next[key] = Number.isFinite(numberValue) && numberValue >= 0 ? numberValue : value;
  }
  return next;
}

function estimateTextSize(text) {
  return String(text || '').length;
}

function trimTextByChars(text, maxChars) {
  const value = String(text || '');
  const limit = Math.max(0, Number(maxChars) || 0);
  if (value.length <= limit) return value;
  if (limit <= 1) return value.slice(0, limit);
  return `${value.slice(0, limit - 1)}\u2026`;
}

function trimMessagesByBudget(messages, limits = {}) {
  const budget = normalizeLimits(limits);
  const warnings = [];
  const source = Array.isArray(messages) ? messages : [];
  const validMessages = source
    .filter((item) => item && (item.role === 'user' || item.role === 'assistant') && item.content)
    .slice(-budget.historyMaxMessages)
    .map((item) => {
      const content = String(item.content);
      const trimmed = trimTextByChars(content, budget.singleHistoryMessageMaxChars);
      if (trimmed.length < content.length) {
        warnings.push('history_message_trimmed');
      }
      return { role: item.role, content: trimmed };
    });

  if (source.length > validMessages.length) {
    warnings.push('history_messages_limited');
  }

  return {
    messages: validMessages,
    chars: validMessages.reduce((sum, item) => sum + estimateTextSize(item.content), 0),
    warnings: Array.from(new Set(warnings))
  };
}

function enforcePromptBudget(promptParts = {}, limits = {}) {
  const budget = normalizeLimits(limits);
  const warnings = [];
  const requiredSections = Array.isArray(promptParts.requiredSections) ? promptParts.requiredSections : [];
  const optionalSections = Array.isArray(promptParts.optionalSections) ? promptParts.optionalSections : [];
  let memoryLines = Array.isArray(promptParts.memoryLines) ? [...promptParts.memoryLines] : [];

  function buildPrompt() {
    const sections = [
      ...requiredSections,
      memoryLines.length ? ['\u3010\u53ef\u53c2\u8003\u8bb0\u5fc6\u3011', ...memoryLines].join('\n') : '',
      ...optionalSections
    ].filter(Boolean);
    return sections.join('\n\n');
  }

  let prompt = buildPrompt();
  while (estimateTextSize(prompt) > budget.systemPromptMaxChars && memoryLines.length > 0) {
    memoryLines = memoryLines.slice(0, -1);
    warnings.push('memory_trimmed_for_system_prompt_budget');
    prompt = buildPrompt();
  }

  if (estimateTextSize(prompt) > budget.systemPromptMaxChars) {
    warnings.push('system_prompt_over_budget_minimal_prompt_used');
    prompt = [...requiredSections, ...optionalSections].filter(Boolean).join('\n\n');
  }

  if (estimateTextSize(prompt) > budget.systemPromptMaxChars) {
    warnings.push('system_prompt_still_over_budget');
  }

  return {
    prompt,
    memoryLines,
    warnings: Array.from(new Set(warnings))
  };
}

function buildPromptBudgetReport(input = {}) {
  const prompt = String(input.prompt || '');
  const injectedMemories = Array.isArray(input.injectedMemories) ? input.injectedMemories : [];
  const historyMessages = Array.isArray(input.historyMessages) ? input.historyMessages : [];
  const userInput = String(input.userInput || '');
  const warnings = Array.isArray(input.warnings) ? input.warnings : [];

  return {
    estimatedChars: estimateTextSize(prompt),
    systemPromptChars: estimateTextSize(prompt),
    memoryInjectedCount: injectedMemories.length,
    memoryInjectedChars: injectedMemories.reduce((sum, memory) => sum + estimateTextSize(memory.content), 0),
    historyMessageCount: historyMessages.length,
    historyChars: historyMessages.reduce((sum, item) => sum + estimateTextSize(item.content), 0),
    userInputChars: estimateTextSize(userInput),
    userMemoryCount: injectedMemories.filter((memory) => memory.type === 'user').length,
    longTermMemoryCount: injectedMemories.filter((memory) => memory.type === 'longTerm').length,
    shortTermMemoryCount: injectedMemories.filter((memory) => memory.type === 'shortTerm').length,
    warnings: Array.from(new Set(warnings.filter(Boolean))),
    updatedAt: new Date().toISOString()
  };
}

module.exports = {
  getDefaultTokenBudget,
  estimateTextSize,
  trimTextByChars,
  trimMessagesByBudget,
  enforcePromptBudget,
  buildPromptBudgetReport
};
