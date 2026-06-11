const fs = require('fs');
const path = require('path');
const { assert, test } = require('./test-utils');
const petProfile = require('../../../config/pet-profile');
const { buildRoxyPrompt } = require('../../prompt-builder');
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
