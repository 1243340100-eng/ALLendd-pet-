const {
  handleUserMessage,
  createDefaultConversationState,
  warmFriend,
  calmExpert,
  playfulCompanion
} = require('..');

async function run() {
  const userMessage = '帮我把这个 harness 架构拆出来，给我实现方案。';
  for (const profile of [warmFriend, calmExpert, playfulCompanion]) {
    const result = await handleUserMessage(userMessage, createDefaultConversationState(), profile);
    console.log(`\n[${profile.id}]`);
    console.log(JSON.stringify({
      leadMode: result.policy.leadMode,
      depth: result.policy.responseDepth,
      playfulness: result.policy.playfulness,
      toneHints: result.policy.toneHints,
      message: result.message
    }, null, 2));
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
