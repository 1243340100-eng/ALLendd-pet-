const { buildHarnessPrompt } = require('./prompt-builder');

function createTemplateMessage(userMessage, analysis, policy, plan, profile) {
  if (policy.boundaryAction === 'refuse_and_redirect') {
    return '这类请求我不能照做。我可以把它转成安全的替代方向，帮你处理不伤害人的部分。';
  }
  if (policy.boundaryAction === 'narrow_scope') {
    return profile.boundaryStyle?.allowLightComplaint
      ? '这个要求有点大，我先帮你抓住核心部分，剩下的可以再一段段展开。'
      : '我会先收窄范围，优先处理最关键的部分。';
  }
  if (policy.boundaryAction === 'push_back') {
    return '我可以继续帮你，但需要把表达放回到清楚、可合作的方式里。先说目标，我来处理。';
  }
  if (policy.leadMode === 'ai_soft_leads') {
    return '那我顺着这个往下讲一点。真正让对话像有节奏的，不是一次说满，而是知道什么时候只推进半步。';
  }
  if (policy.playfulness !== 'none') {
    return '可以，我先接住这个活。小小抗议一下它有点重，不过我会继续帮你把核心拆清楚。';
  }
  if (analysis.taskType === 'architecture_design') {
    return '我会按模块来拆：先定状态和策略层，再接生成层，最后补测试入口。这样 harness 不会和某一个人格绑死。';
  }
  return `我先按这一轮的重点处理：${String(userMessage || '').slice(0, 80)}`;
}

async function generateResponse(input = {}) {
  const { userMessage, analysis, policy, plan, profile, llmClient, basePrompt } = input;
  const prompt = buildHarnessPrompt({ userMessage, analysis, policy, plan, profile, basePrompt });
  if (llmClient && typeof llmClient.generate === 'function' && input.useExternalGenerator) {
    return {
      message: await llmClient.generate(prompt),
      prompt
    };
  }
  return {
    message: createTemplateMessage(userMessage, analysis, policy, plan, profile),
    prompt
  };
}

module.exports = {
  generateResponse,
  createTemplateMessage
};
