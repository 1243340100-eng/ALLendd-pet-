const { BoundaryAction, LeadMode, ResponseDepth } = require('../types');
const { decidePlayfulness } = require('./playfulness-gate');

function decideBoundaryAction(analysis, profile) {
  if (analysis.safetyRisk) return BoundaryAction.REFUSE_AND_REDIRECT;
  if (analysis.requestReasonableness === 'abusive') {
    return profile.boundaryStyle?.canPushBack ? BoundaryAction.PUSH_BACK : BoundaryAction.REFUSE;
  }
  if (analysis.requestReasonableness === 'excessive') return BoundaryAction.NARROW_SCOPE;
  if (analysis.requestReasonableness === 'heavy_but_ok') return BoundaryAction.NARROW_SCOPE;
  return BoundaryAction.COMPLY;
}

function buildToneHints(analysis, profile, boundaryAction, playfulness) {
  const hints = [];
  hints.push(`tone:${profile.id}`);
  hints.push(`leadStyle:${profile.dialogueBehavior?.leadStyle || 'gentle'}`);
  if (profile.baseTone?.directness >= 0.75) hints.push('be direct and concise');
  if (profile.baseTone?.empathy >= 0.7) hints.push('acknowledge user state briefly');
  if (boundaryAction !== BoundaryAction.COMPLY) hints.push(`boundary:${profile.boundaryStyle?.refusalTone || 'soft'}`);
  if (playfulness !== 'none') hints.push(`playfulness:${playfulness}`);
  if (analysis.taskPressure === 'high') hints.push('avoid banter');
  return hints;
}

function decidePolicy(analysis, state = {}, profile) {
  const boundaryAction = decideBoundaryAction(analysis, profile);
  let leadMode = LeadMode.SHARED_LEAD;
  if (analysis.safetyRisk || analysis.intentStrength === 'strong') leadMode = LeadMode.USER_LEADS;
  else if (analysis.intentStrength === 'weak') leadMode = profile.dialogueBehavior?.canTakeLead
    ? LeadMode.AI_SOFT_LEADS
    : LeadMode.SHARED_LEAD;

  let responseDepth = ResponseDepth.NORMAL;
  if (analysis.safetyRisk || boundaryAction !== BoundaryAction.COMPLY) responseDepth = ResponseDepth.BRIEF;
  else if (analysis.intentStrength === 'weak') responseDepth = ResponseDepth.TEASE;
  else if (analysis.wantsDepth) responseDepth = ResponseDepth.DEEP;
  else if (profile.dialogueBehavior?.prefersShortReplies) responseDepth = ResponseDepth.BRIEF;

  const playfulness = decidePlayfulness(analysis, state, profile);
  const maxMainPoints = responseDepth === ResponseDepth.TEASE
    ? 1
    : Math.max(1, Math.min(5, Number(profile.dialogueBehavior?.maxMainPointsDefault) || 3));

  return {
    leadMode,
    responseDepth,
    boundaryAction,
    playfulness,
    maxMainPoints,
    shouldAskQuestion: profile.dialogueBehavior?.likesToAskQuestions
      && analysis.intentStrength !== 'strong'
      && responseDepth !== ResponseDepth.TEASE,
    shouldHoldBackInfo: responseDepth === ResponseDepth.TEASE || responseDepth === ResponseDepth.BRIEF,
    shouldAvoidLongSummary: profile.dialogueBehavior?.avoidsOverExplaining !== false,
    toneHints: buildToneHints(analysis, profile, boundaryAction, playfulness)
  };
}

module.exports = {
  decidePolicy,
  decideBoundaryAction
};
