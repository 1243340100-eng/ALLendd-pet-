const { analyzeConversation } = require('../analyzer/conversation-analyzer');
const { decidePolicy } = require('../policy/policy-controller');
const { createDialoguePlan } = require('../planner/dialogue-planner');
const { generateResponse } = require('../generator/response-generator');
const { runPostCheck, rewriteWithPostCheck } = require('../postcheck/post-check');
const { getPersonalityProfile } = require('../personalities');
const {
  createDefaultConversationState,
  normalizeConversationState,
  updateConversationState
} = require('../state/conversation-state');

async function handleUserMessage(userMessage, conversationState, personalityProfile, options = {}) {
  const state = normalizeConversationState(conversationState || createDefaultConversationState());
  const profile = personalityProfile || getPersonalityProfile(options.profileId);
  const analysis = analyzeConversation(userMessage, state);
  const policy = decidePolicy(analysis, state, profile);
  const plan = createDialoguePlan(analysis, policy);
  const generated = await generateResponse({
    userMessage,
    analysis,
    policy,
    plan,
    profile,
    llmClient: options.llmClient,
    basePrompt: options.basePrompt,
    useExternalGenerator: Boolean(options.useExternalGenerator)
  });
  const postCheck = runPostCheck(generated.message, analysis, policy, plan);
  const message = postCheck.shouldRewrite
    ? rewriteWithPostCheck(generated.message, postCheck, policy)
    : generated.message;
  const newState = updateConversationState(state, analysis, policy, plan, plan.openingStyle);

  return {
    message,
    newState,
    analysis,
    policy,
    plan,
    postCheck,
    prompt: generated.prompt
  };
}

module.exports = {
  handleUserMessage
};
