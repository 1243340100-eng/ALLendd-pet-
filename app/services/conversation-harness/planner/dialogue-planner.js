const { BoundaryAction, LeadMode, ResponseDepth } = require('../types');

function createDialoguePlan(analysis, policy) {
  const mustAvoid = ['template openings', 'asking the user to restate the goal'];
  const mustInclude = [];
  let openingStyle = 'direct_acknowledgement';
  let goal = 'answer the user';
  let pacing = 'few_points';
  const structure = [];

  if (policy.boundaryAction === BoundaryAction.REFUSE_AND_REDIRECT) {
    openingStyle = 'refusal';
    goal = 'refuse unsafe request and offer safe alternative';
    mustInclude.push('clear refusal', 'safe alternative');
  } else if (policy.boundaryAction === BoundaryAction.NARROW_SCOPE) {
    openingStyle = 'gentle_pushback';
    goal = 'narrow scope while still helping';
    mustInclude.push('scope limit', 'useful first chunk');
  } else if (policy.boundaryAction === BoundaryAction.PUSH_BACK) {
    openingStyle = 'gentle_pushback';
    goal = 'set a boundary and continue if possible';
    mustInclude.push('boundary statement');
  } else if (policy.leadMode === LeadMode.AI_SOFT_LEADS) {
    openingStyle = 'topic_seed';
    goal = 'continue the topic with a small useful next thought';
    pacing = 'single_point';
  }

  if (policy.responseDepth === ResponseDepth.TEASE) {
    pacing = 'single_point';
    structure.push('one compact thought');
  } else if (policy.responseDepth === ResponseDepth.DEEP) {
    pacing = 'deep_but_chunked';
    structure.push('brief framing', 'core structure', 'next useful step');
  } else if (policy.responseDepth === ResponseDepth.BRIEF) {
    pacing = 'single_point';
    structure.push('short answer');
  } else {
    structure.push('acknowledge', 'answer', 'optional next step');
  }

  if (policy.playfulness !== 'none') mustInclude.push(`low-frequency ${policy.playfulness}`);
  if (analysis.needsDirectAnswer) mustInclude.push('direct task progress');
  if (policy.playfulness === 'none') mustAvoid.push('playfulness');

  return {
    goal,
    openingStyle,
    structure,
    maxMainPoints: policy.maxMainPoints,
    pacing,
    mustInclude,
    mustAvoid,
    askQuestionAtEnd: Boolean(policy.shouldAskQuestion),
    topicSeed: policy.leadMode === LeadMode.AI_SOFT_LEADS ? analysis.currentTopic || 'related small topic' : ''
  };
}

module.exports = {
  createDialoguePlan
};
