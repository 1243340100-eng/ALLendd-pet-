const { assert, test } = require('./test-utils');
const { runPostCheck } = require('../postcheck/post-check');

test('post-check detects unwanted playfulness', () => {
  const result = runPostCheck('可以，不过你等会儿要夸我一下。', {}, {
    playfulness: 'none',
    boundaryAction: 'comply',
    responseDepth: 'normal'
  }, { askQuestionAtEnd: false });
  assert.strictEqual(result.unwantedPlayfulness, true);
  assert.strictEqual(result.shouldRewrite, true);
});
