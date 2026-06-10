const IntentStrength = Object.freeze({
  WEAK: 'weak',
  MEDIUM: 'medium',
  STRONG: 'strong'
});

const LeadMode = Object.freeze({
  USER_LEADS: 'user_leads',
  SHARED_LEAD: 'shared_lead',
  AI_SOFT_LEADS: 'ai_soft_leads'
});

const ResponseDepth = Object.freeze({
  TEASE: 'tease',
  BRIEF: 'brief',
  NORMAL: 'normal',
  DEEP: 'deep'
});

const BoundaryAction = Object.freeze({
  COMPLY: 'comply',
  NARROW_SCOPE: 'narrow_scope',
  PUSH_BACK: 'push_back',
  REFUSE: 'refuse',
  REFUSE_AND_REDIRECT: 'refuse_and_redirect'
});

const Playfulness = Object.freeze({
  NONE: 'none',
  WARM: 'warm',
  LIGHT_TEASE: 'light_tease',
  ASK_FOR_PRAISE: 'ask_for_praise',
  SOFT_POUT: 'soft_pout'
});

module.exports = {
  IntentStrength,
  LeadMode,
  ResponseDepth,
  BoundaryAction,
  Playfulness
};
