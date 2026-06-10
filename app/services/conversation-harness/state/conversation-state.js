const { LeadMode, ResponseDepth } = require('../types');

function createDefaultConversationState(overrides = {}) {
  return {
    turnIndex: 0,
    currentTopic: '',
    topicHistory: [],
    lastUserIntentStrength: '',
    leadMode: LeadMode.SHARED_LEAD,
    userEnergy: 'medium',
    userEmotion: 'neutral',
    userTaskPressure: 'low',
    boundaryPressure: 0,
    repeatedRevisionCount: 0,
    playfulnessBudget: 2,
    lastPlayfulTurn: -999,
    lastRefusalTurn: -999,
    currentDepth: ResponseDepth.NORMAL,
    pendingTopicSeeds: [],
    recentAssistantMoves: [],
    ...overrides
  };
}

function normalizeConversationState(input = {}) {
  const fallback = createDefaultConversationState();
  const state = input && typeof input === 'object' ? input : {};
  return {
    ...fallback,
    ...state,
    turnIndex: Number.isFinite(Number(state.turnIndex)) ? Number(state.turnIndex) : fallback.turnIndex,
    topicHistory: Array.isArray(state.topicHistory) ? state.topicHistory.slice(-12) : [],
    boundaryPressure: Math.max(0, Number(state.boundaryPressure) || 0),
    repeatedRevisionCount: Math.max(0, Number(state.repeatedRevisionCount) || 0),
    playfulnessBudget: Math.max(0, Number(state.playfulnessBudget ?? fallback.playfulnessBudget)),
    pendingTopicSeeds: Array.isArray(state.pendingTopicSeeds) ? state.pendingTopicSeeds.slice(-8) : [],
    recentAssistantMoves: Array.isArray(state.recentAssistantMoves) ? state.recentAssistantMoves.slice(-8) : []
  };
}

function updateConversationState(state, analysis, policy, plan, assistantMove = '') {
  const current = normalizeConversationState(state);
  const nextTopic = analysis.currentTopic || current.currentTopic || '';
  const topicHistory = nextTopic && nextTopic !== current.currentTopic
    ? [...current.topicHistory, nextTopic].slice(-12)
    : current.topicHistory;
  const recentAssistantMoves = assistantMove
    ? [...current.recentAssistantMoves, assistantMove].slice(-8)
    : current.recentAssistantMoves.slice(-8);
  const usedPlayfulness = policy.playfulness && policy.playfulness !== 'none';

  return normalizeConversationState({
    ...current,
    turnIndex: current.turnIndex + 1,
    currentTopic: nextTopic,
    topicHistory,
    lastUserIntentStrength: analysis.intentStrength,
    leadMode: policy.leadMode,
    userEnergy: analysis.userEnergy,
    userEmotion: analysis.userEmotion,
    userTaskPressure: analysis.taskPressure,
    boundaryPressure: Math.max(0, current.boundaryPressure + (analysis.boundaryPressureDelta || 0)),
    repeatedRevisionCount: analysis.userMode === 'correcting_direction'
      ? current.repeatedRevisionCount + 1
      : Math.max(0, current.repeatedRevisionCount - 1),
    playfulnessBudget: usedPlayfulness
      ? Math.max(0, current.playfulnessBudget - 1)
      : Math.min(2, current.playfulnessBudget + 0.25),
    lastPlayfulTurn: usedPlayfulness ? current.turnIndex : current.lastPlayfulTurn,
    lastRefusalTurn: policy.boundaryAction && policy.boundaryAction.startsWith('refuse')
      ? current.turnIndex
      : current.lastRefusalTurn,
    currentDepth: policy.responseDepth,
    pendingTopicSeeds: plan.topicSeed ? [plan.topicSeed] : current.pendingTopicSeeds.slice(-8),
    recentAssistantMoves
  });
}

module.exports = {
  createDefaultConversationState,
  normalizeConversationState,
  updateConversationState
};
