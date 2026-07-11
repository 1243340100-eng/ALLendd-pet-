const assert = require('assert');
const memoryService = require('../memory-service');
const {
  buildRoxyPrompt,
  isConversationContinuation,
  isMemoryRecallRequest,
  selectRelevantMemories
} = require('../prompt-builder');

const memories = {
  user: [{
    id: 'user-coffee',
    content: '\u7528\u6237\u559c\u6b22\u559d\u51b0\u7f8e\u5f0f\u3002',
    category: 'preference',
    key: 'coffee',
    value: '\u559c\u6b22\u51b0\u7f8e\u5f0f',
    importance: 4
  }],
  longTerm: [{
    id: 'long-japanese',
    content: '\u7528\u6237\u8ba1\u5212\u4e0b\u4e2a\u6708\u5f00\u59cb\u5b66\u4e60\u65e5\u8bed\u3002',
    tags: ['\u65e5\u8bed', '\u5b66\u4e60'],
    importance: 4
  }],
  shortTerm: [{
    id: 'short-pet',
    content: '\u7528\u6237\u521a\u624d\u5728\u8c03\u8bd5 Electron \u684c\u5ba0\u804a\u5929\u7a97\u53e3\u3002',
    topic: '\u684c\u5ba0\u5f00\u53d1',
    tags: ['electron', '\u684c\u5ba0'],
    importance: 3
  }]
};

assert.strictEqual(memoryService.shouldAnalyzeMemory('\u6211\u6253\u7b97\u4e0b\u4e2a\u6708\u5f00\u59cb\u5b66\u65e5\u8bed'), true);
assert.strictEqual(memoryService.shouldAnalyzeUserProfileMemory('\u6211\u5e73\u65f6\u66f4\u559c\u6b22\u559d\u51b0\u7f8e\u5f0f'), true);
assert.strictEqual(isMemoryRecallRequest('\u4f60\u8fd8\u8bb0\u5f97\u6211\u4e4b\u524d\u7684\u8ba1\u5212\u5417'), true);
assert.strictEqual(isConversationContinuation('\u7ee7\u7eed\u521a\u624d\u90a3\u4e2a\u8bdd\u9898'), true);

const recall = selectRelevantMemories('\u4f60\u8fd8\u8bb0\u5f97\u6211\u4e4b\u524d\u7684\u8ba1\u5212\u5417', memories);
assert.ok(recall.some((memory) => memory.id === 'user-coffee'));
assert.ok(recall.some((memory) => memory.id === 'long-japanese'));

const continuation = selectRelevantMemories('\u7ee7\u7eed\u521a\u624d\u90a3\u4e2a\u8bdd\u9898', memories);
assert.ok(continuation.some((memory) => memory.id === 'short-pet'));

const ordinary = selectRelevantMemories('\u4eca\u5929\u8fc7\u5f97\u600e\u4e48\u6837', memories);
assert.ok(ordinary.some((memory) => memory.id === 'user-coffee'));
assert.strictEqual(ordinary.some((memory) => memory.id === 'long-japanese'), false);
assert.strictEqual(ordinary.some((memory) => memory.id === 'short-pet'), false);

const prompt = buildRoxyPrompt({
  userText: '\u4f60\u8fd8\u8bb0\u5f97\u6211\u4e4b\u524d\u7684\u8ba1\u5212\u5417',
  memories,
  historyMessages: []
});
assert.ok(prompt.injectedMemories.length >= 2);
assert.ok(prompt.prompt.includes('\u3010\u53ef\u53c2\u8003\u8bb0\u5fc6\u3011'));
assert.strictEqual(prompt.stats.warnings.includes('memory_trimmed_for_system_prompt_budget'), false);

console.log('PASS framework memory triggers and prompt selection reuse relevant memories');
