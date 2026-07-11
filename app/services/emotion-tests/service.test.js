const assert = require('assert');
const {
  sanitizeEmotionContext,
  parseEmotionLabel,
  inferEmotionFallback,
  classifyResponseEmotion
} = require('../response-emotion-service');

function testSanitization() {
  const source = [
    '检查 C:\\Windows\\System32\\abc.dll',
    '```powershell',
    'Remove-Item C:\\secret.txt',
    '```',
    'api_key=sk-super-secret-token-123456'
  ].join('\n');
  const sanitized = sanitizeEmotionContext(source);

  assert(!sanitized.includes('C:\\Windows'));
  assert(!sanitized.includes('Remove-Item'));
  assert(!sanitized.includes('sk-super'));
  assert(sanitized.includes('[local path]'));
  assert(sanitized.includes('[code omitted]'));
}

function testLabelParsingAndFallback() {
  assert.strictEqual(parseEmotionLabel('blushing'), 'blushing');
  assert.strictEqual(parseEmotionLabel('Label: angry.'), 'angry');
  assert.strictEqual(parseEmotionLabel('neutral'), null);
  assert.strictEqual(inferEmotionFallback('', '修复成功了，做得很好。'), 'happy');
  assert.strictEqual(inferEmotionFallback('', '这是高危破坏请求，不能执行。'), 'angry');
  assert.strictEqual(inferEmotionFallback('', '先把目的说清楚。'), 'tsundere');
}

async function testAiClassificationAndPrivacy() {
  let capturedRequest = null;
  const result = await classifyResponseEmotion({
    apiKey: 'test-key',
    endpoint: 'https://example.invalid/chat',
    model: 'test-model'
  }, '看 C:\\private\\notes.txt，key=sk-secret-token-123456', '```text\nprivate contents\n```\n谢谢夸奖。', async (_endpoint, request) => {
    capturedRequest = JSON.parse(request.body);
    return {
      ok: true,
      json: async () => ({
        model: 'test-model',
        choices: [{ message: { content: 'blushing' } }]
      })
    };
  });

  assert.strictEqual(result.emotion, 'blushing');
  assert.strictEqual(result.source, 'ai');
  assert.strictEqual(capturedRequest.temperature, 0);
  assert.strictEqual(capturedRequest.max_tokens, 8);

  const serialized = JSON.stringify(capturedRequest);
  assert(!serialized.includes('C:\\\\private'));
  assert(!serialized.includes('private contents'));
  assert(!serialized.includes('sk-secret'));
}

async function testFailureFallback() {
  const result = await classifyResponseEmotion({
    apiKey: 'test-key',
    endpoint: 'https://example.invalid/chat',
    model: 'test-model'
  }, '', '这个请求很危险，不能执行。', async () => {
    throw new Error('offline');
  });

  assert.strictEqual(result.emotion, 'angry');
  assert.strictEqual(result.source, 'fallback');
}

(async () => {
  testSanitization();
  testLabelParsingAndFallback();
  await testAiClassificationAndPrivacy();
  await testFailureFallback();
  console.log('response emotion service tests passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
