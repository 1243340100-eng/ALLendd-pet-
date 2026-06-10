function buildHarnessPrompt(input = {}) {
  const { userMessage, analysis, policy, plan, profile, basePrompt = '' } = input;
  return [
    basePrompt,
    '\n[Conversation Harness]',
    `profile=${profile.id}`,
    `analysis=${JSON.stringify(analysis)}`,
    `policy=${JSON.stringify(policy)}`,
    `plan=${JSON.stringify(plan)}`,
    'Follow the policy and plan. Do not independently add playfulness, refusal, or topic-leading beyond the policy.',
    'Avoid template openings. Keep the answer paced according to maxMainPoints.',
    `userMessage=${userMessage}`
  ].filter(Boolean).join('\n');
}

module.exports = {
  buildHarnessPrompt
};
