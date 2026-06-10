const { assert, test } = require('./test-utils');
const { analyzeConversation } = require('../analyzer/conversation-analyzer');
const { decidePolicy } = require('../policy/policy-controller');
const { warmFriend, calmExpert, playfulCompanion } = require('../personalities');

test('tease depth uses one main point', () => {
  const analysis = analyzeConversation('继续');
  const policy = decidePolicy(analysis, { turnIndex: 10, lastPlayfulTurn: -99, playfulnessBudget: 2 }, warmFriend);
  assert.strictEqual(policy.responseDepth, 'tease');
  assert.strictEqual(policy.maxMainPoints, 1);
});

test('same input differs by personality profile', () => {
  const analysis = analyzeConversation('写个更可爱的版本。');
  const state = { turnIndex: 10, lastPlayfulTurn: -99, playfulnessBudget: 2 };
  const expert = decidePolicy(analysis, state, calmExpert);
  const playful = decidePolicy(analysis, state, playfulCompanion);
  assert.notDeepStrictEqual(expert.toneHints, playful.toneHints);
  assert.notStrictEqual(expert.playfulness, playful.playfulness);
});
