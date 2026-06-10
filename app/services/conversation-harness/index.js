const { handleUserMessage } = require('./core/handle-user-message');
const { createDefaultConversationState, normalizeConversationState } = require('./state/conversation-state');
const personalities = require('./personalities');
const { analyzeConversation } = require('./analyzer/conversation-analyzer');
const { detectBoundaryPressure } = require('./analyzer/boundary-engine');
const { decidePolicy } = require('./policy/policy-controller');
const { decidePlayfulness } = require('./policy/playfulness-gate');
const { createDialoguePlan } = require('./planner/dialogue-planner');
const { runPostCheck } = require('./postcheck/post-check');
const { buildHarnessPrompt } = require('./generator/prompt-builder');
const { MockLLMClient } = require('./generator/llm-client');

module.exports = {
  handleUserMessage,
  createDefaultConversationState,
  normalizeConversationState,
  ...personalities,
  analyzeConversation,
  detectBoundaryPressure,
  decidePolicy,
  decidePlayfulness,
  createDialoguePlan,
  runPostCheck,
  buildHarnessPrompt,
  MockLLMClient
};
