const { assert, test } = require('./test-utils');
const { analyzeConversation } = require('../analyzer/conversation-analyzer');
const { decidePolicy } = require('../policy/policy-controller');
const { warmFriend } = require('../personalities');

test('strong architecture request leads user_leads', () => {
  const analysis = analyzeConversation('帮我把这个 harness 架构拆出来，给我实现方案。');
  const policy = decidePolicy(analysis, {}, warmFriend);
  assert.strictEqual(analysis.intentStrength, 'strong');
  assert.strictEqual(policy.leadMode, 'user_leads');
});

test('weak continuation leads ai_soft_leads', () => {
  const analysis = analyzeConversation('嗯，对。');
  const policy = decidePolicy(analysis, {}, warmFriend);
  assert.strictEqual(analysis.intentStrength, 'weak');
  assert.strictEqual(policy.leadMode, 'ai_soft_leads');
});
