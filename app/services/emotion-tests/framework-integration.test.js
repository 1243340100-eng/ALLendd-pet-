'use strict';

/*
 * 表情系统行为集成测试
 *
 * 旧版本仅用字符串搜索校验调用链，即使调用失效也能通过。
 * 本测试改为真正调用 response-emotion-service 的导出函数：
 *   - parseEmotionLabel 行为
 *   - inferEmotionFallback 行为
 *   - classifyResponseEmotion 在无 API 配置 / mock fetch 成功 / mock fetch 失败 三种情况下的行为
 *   - petProfile.responseEmotion 与 baseRows 的 fallbackState 行为
 *
 * 仍保留少量源码扫描作为补充，确保调用链没有被无意删除。
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const appRoot = path.resolve(__dirname, '..', '..');
const {
  EMOTIONS,
  DEFAULT_EMOTION,
  parseEmotionLabel,
  inferEmotionFallback,
  classifyResponseEmotion
} = require(path.join(appRoot, 'services', 'response-emotion-service.js'));
const petProfile = require(path.join(appRoot, 'config', 'pet-profile.js'));

let passCount = 0;
function pass(name) {
  passCount += 1;
  console.log(`PASS ${name}`);
}

// --- 源码扫描：调用链保留 ---
const main = fs.readFileSync(path.join(appRoot, 'main.js'), 'utf8');
const renderer = fs.readFileSync(path.join(appRoot, 'renderer.js'), 'utf8');
const profileSource = fs.readFileSync(path.join(appRoot, 'config', 'pet-profile.js'), 'utf8');

assert(main.includes('petProfile.responseEmotion?.enabled'), 'main.js 应保留 responseEmotion.enabled 检查');
assert(main.includes('classifyResponseEmotion('), 'main.js 应调用 classifyResponseEmotion');
assert(renderer.includes('petProfile.animationRows'), 'renderer.js 应读取 animationRows');
assert(renderer.includes('petProfile.spriteSheetSize'), 'renderer.js 应读取 spriteSheetSize');
assert(renderer.includes('getResponseAnimationState'), 'renderer.js 应保留 getResponseAnimationState');
assert(profileSource.includes('responseEmotion:'), 'pet-profile.js 应声明 responseEmotion');
assert(profileSource.includes('fallbackState:'), 'pet-profile.js 应声明 fallbackState');

// --- 行为测试 1: parseEmotionLabel ---
function testParseEmotionLabel() {
  for (const e of EMOTIONS) {
    assert.strictEqual(parseEmotionLabel(e), e, `parseEmotionLabel 应接受合法 emotion: ${e}`);
    assert.strictEqual(parseEmotionLabel(e.toUpperCase()), e, `parseEmotionLabel 应忽略大小写: ${e}`);
  }
  assert.strictEqual(parseEmotionLabel('not-an-emotion'), null, 'parseEmotionLabel 应拒绝未知 emotion');
  assert.strictEqual(parseEmotionLabel(''), null, 'parseEmotionLabel 应拒绝空串');
  assert.strictEqual(parseEmotionLabel(null), null, 'parseEmotionLabel 应拒绝 null');
  pass('parseEmotionLabel behavior');
}

// --- 行为测试 2: inferEmotionFallback 永远返回合法 emotion ---
function testInferEmotionFallback() {
  const samples = [
    '今天好累',
    '谢谢你',
    '我要把电脑砸了',
    '什么？！居然会这样',
    '又来这一套，唉',
    '笨蛋杂鱼',
    '太好了，搞定了'
  ];
  for (const sample of samples) {
    const emotion = inferEmotionFallback(sample, '');
    assert.ok(
      EMOTIONS.includes(emotion),
      `inferEmotionFallback 返回了非法 emotion: ${emotion} (输入: ${sample})`
    );
  }
  assert.strictEqual(
    inferEmotionFallback('', ''),
    DEFAULT_EMOTION,
    `inferEmotionFallback 默认应返回 ${DEFAULT_EMOTION}`
  );
  pass('inferEmotionFallback always returns valid emotion');
}

// --- 行为测试 3: classifyResponseEmotion 无 API 配置时回退 ---
async function testFallbackWithoutConfig() {
  const result = await classifyResponseEmotion(null, '你好', '你好呀');
  assert.strictEqual(result.source, 'fallback', '无 config 应返回 fallback');
  assert.ok(EMOTIONS.includes(result.emotion), 'fallback emotion 应合法');

  const result2 = await classifyResponseEmotion({ apiKey: '', endpoint: '', model: '' }, '你好', '你好呀');
  assert.strictEqual(result2.source, 'fallback', '缺字段 config 应返回 fallback');
  pass('classifyResponseEmotion falls back without config');
}

// --- 行为测试 4: classifyResponseEmotion mock fetch 成功 ---
async function testMockFetchSuccess() {
  let capturedUrl = null;
  let capturedBody = null;
  const mockFetch = async (url, options) => {
    capturedUrl = url;
    capturedBody = JSON.parse(options.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: 'blushing' } }],
        model: 'mock-model'
      })
    };
  };
  const config = {
    apiKey: 'test-key',
    endpoint: 'https://example.com/v1/chat/completions',
    model: 'mock-model'
  };
  const result = await classifyResponseEmotion(config, '谢谢你', '不客气', mockFetch);
  assert.strictEqual(result.source, 'ai', 'mock fetch 成功应返回 source=ai');
  assert.strictEqual(result.emotion, 'blushing', 'mock fetch 应解析 emotion');
  assert.strictEqual(result.model, 'mock-model', '应保留 model 字段');
  assert.strictEqual(capturedUrl, config.endpoint, '应请求正确 endpoint');
  assert.ok(Array.isArray(capturedBody.messages), '应发送 messages 数组');
  assert.strictEqual(capturedBody.temperature, 0, '应使用 temperature=0');
  pass('classifyResponseEmotion uses AI when fetch succeeds');
}

// --- 行为测试 5: classifyResponseEmotion mock fetch 失败时回退 ---
async function testMockFetchFailure() {
  const mockFetch = async () => {
    throw new Error('network error');
  };
  const config = {
    apiKey: 'test-key',
    endpoint: 'https://example.com/v1/chat/completions',
    model: 'mock-model'
  };
  const result = await classifyResponseEmotion(config, '谢谢你', '不客气', mockFetch);
  assert.strictEqual(result.source, 'fallback', 'fetch 失败应回退');
  assert.ok(EMOTIONS.includes(result.emotion), '回退 emotion 应合法');
  assert.ok(result.error, 'fetch 失败应携带 error 字段');
  pass('classifyResponseEmotion falls back on fetch error');
}

// --- 行为测试 6: mock fetch 返回非法 label 时回退 ---
async function testMockFetchInvalidLabel() {
  const mockFetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { content: 'invalid-label' } }]
    })
  });
  const config = {
    apiKey: 'test-key',
    endpoint: 'https://example.com/v1/chat/completions',
    model: 'mock-model'
  };
  const result = await classifyResponseEmotion(config, '你好', '你好', mockFetch);
  assert.strictEqual(result.source, 'fallback', '非法 label 应回退');
  assert.ok(result.error, '非法 label 应携带 error');
  pass('classifyResponseEmotion rejects invalid AI label');
}

// --- 行为测试 7: petProfile.responseEmotion 与动画配置的一致性 ---
function testResponseEmotionConsistency() {
  const responseEmotion = petProfile.responseEmotion || {};
  assert.ok(
    typeof responseEmotion.enabled === 'boolean',
    'responseEmotion.enabled 必须是 boolean'
  );
  assert.ok(
    responseEmotion.fallbackState,
    'responseEmotion.fallbackState 必须存在'
  );

  // 即便 enabled=false，fallbackState 也必须是 renderer 真的能渲染的状态
  const baseRows = {
    idle: { row: 0, frames: 6, fps: 5 },
    'running-right': { row: 1, frames: 8, fps: 9 },
    'running-left': { row: 2, frames: 8, fps: 9 },
    waving: { row: 3, frames: 4, fps: 5 },
    jumping: { row: 4, frames: 5, fps: 7 },
    failed: { row: 5, frames: 8, fps: 7 },
    waiting: { row: 6, frames: 6, fps: 5 },
    running: { row: 7, frames: 6, fps: 6 },
    review: { row: 8, frames: 6, fps: 5 }
  };
  const allRows = { ...baseRows, ...(petProfile.animationRows || {}) };
  assert.ok(
    Object.prototype.hasOwnProperty.call(allRows, responseEmotion.fallbackState),
    `responseEmotion.fallbackState (${responseEmotion.fallbackState}) 必须存在于 baseRows ∪ animationRows，否则表情回退会再次回退到 'waving'`
  );

  // 当 enabled=true 时，response-emotion-service 返回的每个 emotion 都应该有对应的动画行；
  // 否则所有 AI 分类都会被 fallbackState 吞掉。
  if (responseEmotion.enabled) {
    for (const emotion of EMOTIONS) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(allRows, emotion),
        `responseEmotion.enabled=true 但 animationRows 中缺少 emotion 行: ${emotion}；` +
        '该 emotion 在运行时会被 fallbackState 替代，AI 分类失去意义'
      );
    }
  }
  pass('responseEmotion and animation rows are consistent');
}

async function mainRunner() {
  testParseEmotionLabel();
  testInferEmotionFallback();
  testResponseEmotionConsistency();
  await testFallbackWithoutConfig();
  await testMockFetchSuccess();
  await testMockFetchFailure();
  await testMockFetchInvalidLabel();
  console.log(`framework response emotion integration tests passed (${passCount} behavior checks)`);
}

mainRunner().catch((error) => {
  console.error(`[FAIL] ${error.message}`);
  process.exit(1);
});
