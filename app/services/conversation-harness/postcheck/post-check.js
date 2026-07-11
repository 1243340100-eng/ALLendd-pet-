const TEMPLATE_PATTERNS = [/这是一个好问题/u, /当然可以/u, /希望这对你有帮助/u];
const PLAYFUL_PATTERNS = [/夸我|哄我|哄哄|撒娇|小小抗议|摸摸/u, /\bpraise me\b|\btease\b/i];

function runPostCheck(message = '', analysis = {}, policy = {}, plan = {}) {
  const text = String(message || '');
  const questionCount = (text.match(/[?？]/g) || []).length;
  const tooLong = text.length > (policy.responseDepth === 'tease' ? 160 : 1200);
  const tooTemplateLike = TEMPLATE_PATTERNS.some((pattern) => pattern.test(text));
  const unwantedPlayfulness = policy.playfulness === 'none'
    && PLAYFUL_PATTERNS.some((pattern) => pattern.test(text));
  const missingBoundary = policy.boundaryAction
    && policy.boundaryAction !== 'comply'
    && !/不|不能|先|范围|拒绝|安全|边界/u.test(text);
  const overAskedQuestions = questionCount > (plan.askQuestionAtEnd ? 1 : 0);
  const ignoredUserIntent = analysis.needsDirectAnswer && text.length < 8;

  return {
    tooLong,
    tooTemplateLike,
    ignoredUserIntent,
    unwantedPlayfulness,
    missingBoundary,
    overAskedQuestions,
    shouldRewrite: tooLong || tooTemplateLike || ignoredUserIntent || unwantedPlayfulness || missingBoundary || overAskedQuestions
  };
}

function rewriteWithPostCheck(message = '', postCheck = {}, policy = {}) {
  let next = String(message || '');
  if (postCheck.tooTemplateLike) {
    next = next.replace(/这是一个好问题。?/gu, '').replace(/当然可以。?/gu, '').replace(/希望这对你有帮助。?/gu, '').trim();
  }
  if (postCheck.unwantedPlayfulness) {
    next = next.replace(/[^。！？]*?(夸我|哄我|哄哄|撒娇|小小抗议|摸摸)[^。！？]*?[。！？]?/gu, '').trim();
  }
  if (postCheck.missingBoundary) {
    if (policy.boundaryAction === 'refuse_and_redirect') {
      return '这个请求我不能帮你做。我们可以换一个安全的方式来做你想做的事。';
    }
    if (policy.boundaryAction === 'refuse') {
      return '这个超出我能帮的范围了。';
    }
    if (policy.boundaryAction === 'push_back') {
      return '先等一下，我们先把需求和边界理清楚再继续。';
    }
    if (policy.boundaryAction === 'narrow_scope') {
      return '我先把范围收窄一点，只处理最关键的部分。';
    }
  }
  if (postCheck.tooLong) {
    next = next.slice(0, policy.responseDepth === 'tease' ? 150 : 900).trim();
  }
  if (!next) next = '我先把这一轮收窄处理，直接给你最有用的部分。';
  return next;
}

module.exports = {
  runPostCheck,
  rewriteWithPostCheck
};
