const { assert, test } = require('./test-utils');
const { analyzeConversation } = require('../analyzer/conversation-analyzer');
const { decidePlayfulness } = require('../policy/playfulness-gate');
const { playfulCompanion } = require('../personalities');

test('high pressure forbids playfulness', () => {
  const analysis = analyzeConversation('马上帮我写完整方案，立刻。');
  const playfulness = decidePlayfulness(analysis, { turnIndex: 10, lastPlayfulTurn: -99, playfulnessBudget: 2 }, playfulCompanion);
  assert.strictEqual(playfulness, 'none');
});

test('distressed emotion forbids playfulness', () => {
  const analysis = analyzeConversation('我现在很崩溃，救命。');
  const playfulness = decidePlayfulness(analysis, { turnIndex: 10, lastPlayfulTurn: -99, playfulnessBudget: 2 }, playfulCompanion);
  assert.strictEqual(playfulness, 'none');
});

test('playfulness cannot appear too frequently', () => {
  const analysis = analyzeConversation('写个更可爱的版本。');
  const playfulness = decidePlayfulness(analysis, { turnIndex: 4, lastPlayfulTurn: 2, playfulnessBudget: 2 }, playfulCompanion);
  assert.strictEqual(playfulness, 'none');
});
