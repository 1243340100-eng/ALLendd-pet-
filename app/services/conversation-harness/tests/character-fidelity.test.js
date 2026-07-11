const fs = require('fs');
const path = require('path');
const { assert, test } = require('./test-utils');
const petProfile = require('../../../config/pet-profile');
const { buildRoxyPrompt, buildPetPrompt } = require('../../prompt-builder');
const { getPersonalityProfile } = require('..');

const projectRoot = path.resolve(__dirname, '../../../..');

function readProjectFile(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
}

function buildSampleHarness() {
  return {
    policy: {
      leadMode: 'shared_lead',
      responseDepth: 'normal',
      boundaryAction: 'comply',
      playfulness: 'none',
      maxMainPoints: 2,
      toneHints: ['tone:warm_friend', 'acknowledge user state briefly']
    },
    plan: {
      openingStyle: 'direct',
      pacing: 'steady',
      mustInclude: ['answer the user intent'],
      mustAvoid: ['do not change character identity']
    }
  };
}

test('pet profile declares one fixed conversation personality', () => {
  assert.strictEqual(typeof petProfile.conversationPersonalityId, 'string');
  assert.ok(petProfile.conversationPersonalityId.trim());
  assert.strictEqual(getPersonalityProfile(petProfile.conversationPersonalityId).id, petProfile.conversationPersonalityId);
});

test('pet profile includes role fidelity constraints for packaging', () => {
  const fidelity = petProfile.roleFidelity || {};
  assert.ok(Array.isArray(fidelity.coreIdentity) && fidelity.coreIdentity.length > 0);
  assert.ok(Array.isArray(fidelity.speakingStyle) && fidelity.speakingStyle.length > 0);
  assert.ok(Array.isArray(fidelity.relationshipBoundary) && fidelity.relationshipBoundary.length > 0);
  assert.ok(Array.isArray(fidelity.forbiddenDrift) && fidelity.forbiddenDrift.length > 0);
  assert.ok(Array.isArray(fidelity.sampleDialogues) && fidelity.sampleDialogues.length > 0);
});

test('sampleDialogues have valid user/expected structure and meet character constraints', () => {
  const samples = petProfile.roleFidelity?.sampleDialogues || [];
  assert.ok(samples.length >= 3, '应至少提供 3 条示例对话，便于回归');
  const characterName = petProfile.characterName || 'Pet';
  const forbiddenDrift = petProfile.roleFidelity?.forbiddenDrift || [];
  for (const sample of samples) {
    assert.ok(
      sample && typeof sample === 'object',
      `sampleDialogue 必须是对象，实际值：${typeof sample}`
    );
    assert.ok(
      typeof sample.user === 'string' && sample.user.trim().length >= 2,
      `sampleDialogue.user 必须是非空字符串（≥2 字符）`
    );
    assert.ok(
      typeof sample.expected === 'string' && sample.expected.trim().length >= 2,
      `sampleDialogue.expected 必须是非空字符串（≥2 字符）`
    );
    // 角色回复应偏短，符合桌宠气泡场景
    assert.ok(
      sample.expected.length <= 200,
      `sampleDialogue.expected 过长 (${sample.expected.length})，不符合桌宠气泡场景：${sample.expected}`
    );
    // 不得包含 forbiddenDrift 关键词
    for (const drift of forbiddenDrift) {
      // forbiddenDrift 是英文描述，这里只检查关键的中文/英文标记词，避免误判
      const marker = drift.match(/[\u4e00-\u9fff]+|[A-Za-z_]{3,}/)?.[0];
      if (!marker) continue;
      if (marker.length >= 4 && /作为一个|语言模型|warm_friend|calm_expert|playful_companion/i.test(marker)) {
        assert.ok(
          !sample.expected.includes(marker),
          `sampleDialogue.expected 不应包含 forbiddenDrift 关键词：${marker}`
        );
      }
    }
    // 不得自称 AI
    assert.ok(
      !/\bAI\b|人工智能|语言模型/i.test(sample.expected),
      `sampleDialogue.expected 不应包含 AI/人工智能/语言模型：${sample.expected}`
    );
  }
});

test('main process reads harness personality from pet-profile, not runtime user data', () => {
  const mainSource = readProjectFile('app/main.js');
  assert.ok(mainSource.includes('petProfile.conversationPersonalityId'));
  assert.ok(!mainSource.includes('petData.prompt?.conversationPersonalityId ||'));
});

test('prompt keeps character fidelity above harness policy', () => {
  const result = buildRoxyPrompt({
    userText: '今天有点累。',
    memories: {},
    affection: {},
    historyMessages: [],
    harness: buildSampleHarness()
  });
  const prompt = result.prompt;
  const coreIndex = prompt.indexOf('角色核心设定');
  const fidelityIndex = prompt.indexOf('角色还原约束');
  const harnessIndex = prompt.indexOf('对话策略控制');
  assert.ok(coreIndex >= 0);
  assert.ok(fidelityIndex > coreIndex);
  assert.ok(harnessIndex > fidelityIndex);
  assert.ok(prompt.includes('不能改写角色身份'));
});

test('buildPetPrompt is the canonical export and alias buildRoxyPrompt still works', () => {
  // 新代码应使用 buildPetPrompt，旧代码可通过 buildRoxyPrompt 别名继续工作
  assert.strictEqual(typeof buildPetPrompt, 'function');
  assert.strictEqual(typeof buildRoxyPrompt, 'function');
  assert.strictEqual(buildPetPrompt, buildRoxyPrompt);
});

test('prompt output actually contains character name and core prompt content', () => {
  const result = buildPetPrompt({
    userText: '今天好累。',
    memories: {},
    affection: { score: 50, level: 'familiar' },
    historyMessages: [],
    harness: buildSampleHarness()
  });
  // 角色 prompt 应包含核心设定区块
  assert.ok(result.prompt.includes('角色核心设定'), 'prompt 应包含角色核心设定区块');
  // 如果 petProfile 声明了 characterName，prompt 应能体现该角色名（在 corePrompt 或 roleFidelity.coreIdentity 中）
  if (petProfile.characterName) {
    const nameAppearsInPrompt = result.prompt.includes(petProfile.characterName);
    const nameAppearsInFidelity = (petProfile.roleFidelity?.coreIdentity || []).some((line) =>
      String(line).includes(petProfile.characterName)
    );
    assert.ok(
      nameAppearsInPrompt || nameAppearsInFidelity,
      `prompt 中找不到 characterName (${petProfile.characterName})，可能是 corePrompt 配置缺失`
    );
  }
});

test('prompt for sample dialogue user input produces consistent character framing', () => {
  // 验证示例对话的用户输入最终能产生符合角色框架的 prompt
  const samples = petProfile.roleFidelity?.sampleDialogues || [];
  for (const sample of samples) {
    const result = buildPetPrompt({
      userText: sample.user,
      memories: {},
      affection: { score: 50, level: 'familiar' },
      historyMessages: [],
      harness: buildSampleHarness()
    });
    // prompt 必须保持稳定的区块结构
    assert.ok(result.prompt.includes('角色核心设定'), `输入 ${sample.user} 的 prompt 缺少角色核心设定区块`);
    assert.ok(result.prompt.includes('安全与边界'), `输入 ${sample.user} 的 prompt 缺少安全与边界区块`);
    assert.ok(result.prompt.includes('对话策略控制'), `输入 ${sample.user} 的 prompt 缺少对话策略控制区块`);
  }
});
