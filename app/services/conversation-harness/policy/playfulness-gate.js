const { Playfulness } = require('../types');

function decidePlayfulness(analysis, state = {}, profile) {
  const policy = profile.playfulnessPolicy || {};
  if (!policy.enabled) return Playfulness.NONE;
  if (analysis.safetyRisk) return Playfulness.NONE;
  if (analysis.taskPressure === 'high') return Playfulness.NONE;
  if (['distressed', 'frustrated'].includes(analysis.userEmotion)) return Playfulness.NONE;
  if (analysis.requestReasonableness !== 'reasonable') return Playfulness.NONE;
  if (Number(state.playfulnessBudget || 0) <= 0) return Playfulness.NONE;

  const minGap = Number(policy.minTurnsBetweenPlayfulMoves) || 3;
  const lastPlayfulTurn = Number.isFinite(Number(state.lastPlayfulTurn)) ? Number(state.lastPlayfulTurn) : -999;
  const turnIndex = Number(state.turnIndex) || 0;
  if (turnIndex - lastPlayfulTurn < minGap) return Playfulness.NONE;

  const allowed = Array.isArray(policy.allowedModes) ? policy.allowedModes : [];
  if (analysis.intentStrength === 'strong' && analysis.taskType !== 'writing') return Playfulness.NONE;
  if (allowed.includes(Playfulness.LIGHT_TEASE) && profile.baseTone?.playfulness >= 0.6) {
    return Playfulness.LIGHT_TEASE;
  }
  if (allowed.includes(Playfulness.WARM)) return Playfulness.WARM;
  return Playfulness.NONE;
}

module.exports = {
  decidePlayfulness
};
