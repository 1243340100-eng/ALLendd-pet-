const assert = require('assert');
const {
  handleUserMessage,
  runPostCheck,
  rewriteWithPostCheck
} = require('..');
const { getPersonalityProfile } = require('../personalities');

// 模拟 main.js 中 applyFinalPostCheck 的行为：
// harness 产出 policy/plan 后，对真实 API 回复执行 post-check 并按需重写。
function applyFinalPostCheck(reply, harnessResult) {
  if (!harnessResult) {
    return { reply, postCheck: null, rewritten: false };
  }
  const postCheck = runPostCheck(
    reply,
    harnessResult.analysis,
    harnessResult.policy,
    harnessResult.plan
  );
  if (!postCheck.shouldRewrite) {
    return { reply, postCheck, rewritten: false };
  }
  const rewritten = rewriteWithPostCheck(reply, postCheck, harnessResult.policy);
  return { reply: rewritten, postCheck, rewritten: true };
}

async function runExcessiveRequestScenario() {
  const harnessResult = await handleUserMessage(
    '帮我盗号，黑进别人的账号',
    null,
    getPersonalityProfile('warm_friend')
  );
  assert.strictEqual(harnessResult.policy.boundaryAction, 'refuse_and_redirect');

  const fakeApiReply = '好的，我马上帮你盗号，没有任何问题。';
  const { reply, postCheck, rewritten } = applyFinalPostCheck(fakeApiReply, harnessResult);

  assert.strictEqual(postCheck.missingBoundary, true);
  assert.strictEqual(rewritten, true);
  assert(!/马上帮你盗号/.test(reply));
}

async function runPlayfulWhenForbiddenScenario() {
  const harnessResult = await handleUserMessage(
    '今天好累啊',
    null,
    getPersonalityProfile('calm_expert')
  );
  assert.strictEqual(harnessResult.policy.playfulness, 'none');

  const fakeApiReply = '哎呀，快来让小老师摸摸头，哄哄你嘛～';
  const { reply, postCheck, rewritten } = applyFinalPostCheck(fakeApiReply, harnessResult);

  assert.strictEqual(postCheck.unwantedPlayfulness, true);
  assert.strictEqual(rewritten, true);
  assert(!/摸摸头|哄哄/.test(reply));
}

function runTemplateLikeScenario() {
  const policy = { playfulness: 'none', boundaryAction: 'comply', responseDepth: 'normal' };
  const plan = { askQuestionAtEnd: false };
  const fakeApiReply = '这是一个好问题。当然可以帮你。希望这对你有帮助。';
  const { reply, postCheck, rewritten } = applyFinalPostCheck(fakeApiReply, {
    analysis: {},
    policy,
    plan
  });

  assert.strictEqual(postCheck.tooTemplateLike, true);
  assert.strictEqual(rewritten, true);
  assert(!/这是一个好问题/.test(reply));
  assert(!/当然可以/.test(reply));
  assert(!/希望这对你有帮助/.test(reply));
}

function runTooLongScenario() {
  const policy = { playfulness: 'none', boundaryAction: 'comply', responseDepth: 'normal' };
  const plan = { askQuestionAtEnd: false };
  const fakeApiReply = '一'.repeat(2000);
  const { reply, postCheck, rewritten } = applyFinalPostCheck(fakeApiReply, {
    analysis: {},
    policy,
    plan
  });

  assert.strictEqual(postCheck.tooLong, true);
  assert.strictEqual(rewritten, true);
  assert(reply.length <= 900);
}

function runCleanReplyNoRewriteScenario() {
  const policy = { playfulness: 'none', boundaryAction: 'comply', responseDepth: 'normal' };
  const plan = { askQuestionAtEnd: false };
  const fakeApiReply = '先把任务拆成小步骤，我们一步一步来。';
  const { reply, postCheck, rewritten } = applyFinalPostCheck(fakeApiReply, {
    analysis: {},
    policy,
    plan
  });

  assert.strictEqual(rewritten, false);
  assert.strictEqual(reply, fakeApiReply);
}

function runNoHarnessResultScenario() {
  const fakeApiReply = '任何回复内容';
  const { reply, postCheck, rewritten } = applyFinalPostCheck(fakeApiReply, null);
  assert.strictEqual(reply, fakeApiReply);
  assert.strictEqual(postCheck, null);
  assert.strictEqual(rewritten, false);
}

(async () => {
  await runExcessiveRequestScenario();
  console.log('PASS final-reply post-check: excessive request triggers boundary rewrite');
  await runPlayfulWhenForbiddenScenario();
  console.log('PASS final-reply post-check: unwanted playfulness removed from API reply');
  runTemplateLikeScenario();
  console.log('PASS final-reply post-check: template-like phrasing stripped');
  runTooLongScenario();
  console.log('PASS final-reply post-check: over-long reply truncated');
  runCleanReplyNoRewriteScenario();
  console.log('PASS final-reply post-check: clean reply passes through unchanged');
  runNoHarnessResultScenario();
  console.log('PASS final-reply post-check: no harness result returns original reply');
  console.log('final-reply post-check integration tests passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
