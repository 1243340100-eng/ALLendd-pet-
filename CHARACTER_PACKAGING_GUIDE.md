# Character Packaging Guide

This framework is designed for one packaged desktop pet to represent one fixed character.
The conversation harness controls reply policy, but it must not change the character identity.

## Character Source Of Truth

Edit `app/config/pet-profile.js` before packaging a new pet.

Required fields:

- `displayName`: product-facing display name.
- `characterName`: character name used by the prompt and UI.
- `conversationPersonalityId`: fixed harness personality profile for this packaged pet.
- `corePrompt`: highest-priority role identity and behavior prompt.
- `roleFidelity.coreIdentity`: stable identity facts.
- `roleFidelity.speakingStyle`: voice, rhythm, and wording preferences.
- `roleFidelity.relationshipBoundary`: relationship and emotional boundary rules.
- `roleFidelity.forbiddenDrift`: things the model must not drift into.
- `roleFidelity.commonTone`: short tone tags for quick review.
- `roleFidelity.sampleDialogues`: packaging-time examples for manual role checks.

Optional animation fields:

- `spriteCell`: one frame's width and height.
- `spriteSheetSize`: full atlas width and height.
- `animationRows`: packaged character-specific state rows.
- `responseEmotion`: enables post-reply AI emotion selection only after matching assets exist.

## Layer Priority

The final prompt should be understood in this order:

1. Character core setting from `corePrompt`.
2. Character fidelity constraints from `roleFidelity`.
3. Safety and relationship boundaries.
4. Conversation harness policy for the current turn.
5. Relevant user memory.

The harness may decide whether a reply should be brief, deep, playful, or boundary-setting.
It must not decide who the pet is.

## Personality Profile Role

Personality profiles live in:

```text
app/services/conversation-harness/personalities/
```

They are packaging-time dialogue behavior presets, not runtime character-switching options.

Use them for:

- reply length and density
- whether the pet asks follow-up questions
- how direct or gentle the pet sounds
- how the pet sets boundaries
- whether light playful wording is allowed
- how often playful wording may appear

Do not use them for:

- character identity
- worldbuilding
- relationship canon
- names, titles, or backstory
- role restoration rules

Those belong in `app/config/pet-profile.js`, especially `corePrompt` and `roleFidelity`.

Before packaging, set:

```js
conversationPersonalityId: 'your_profile_id',
```

in `app/config/pet-profile.js`. The packaged pet should keep this fixed and should not expose a personality switcher to end users.

## How To Add A New Character

1. Replace `displayName`, `characterName`, and `corePrompt`.
2. Choose or create one fixed `conversationPersonalityId`.
3. Fill `roleFidelity` with concrete rules for the character.
4. Replace sprites, icon, and product name as needed.
5. Run the checks below before packaging.

## Pre-Pack Checks

Run:

```powershell
cd "D:\Documents\展示项目内容\roxy-electron-pet-framework"
npm.cmd run test:character
npm.cmd run test:harness
npm.cmd run test:memory-flow
npm.cmd run test:shell
node --check .\app\main.js
node --check .\app\preload.js
node --check .\app\renderer.js
node --check .\app\services\prompt-builder.js
node --check .\app\config\pet-profile.js
```

Manual checks:

- The pet does not introduce itself as a generic AI assistant.
- The pet does not switch into another personality because of the user's topic or language.
- The pet keeps the target character voice under casual chat, task pressure, and boundary cases.
- The pet's warmth, jokes, or playful wording stay inside the packaged character style.
- Relevant saved memories are used naturally without scripted memory confirmations.
- Recall wording such as "remember / previously / continue earlier" uses bounded memory retrieval.
- If Safe Shell remains enabled in the product, the character only describes fixed read-only diagnostics.
- Character prompts never imply administrator, TrustedInstaller, arbitrary PowerShell, file-write, or system-control capability.

## v1.5.0 Safe Shell Packaging Boundary

Safe Shell is default-off and implemented in `app/services/safe-shell-service.js`.

- First use requires explicit user confirmation to enable.
- Every command requires a separate confirmation.
- Only the fixed read-only allowlist may execute.
- The personality profile, `corePrompt`, `roleFidelity`, memory, and harness cannot expand the allowlist.
- Remove the chat integration entirely if a packaged character should not expose local diagnostic commands; do not replace it with arbitrary command execution.

## v1.6.0 Response Emotion Packaging

Response emotion selection is default-off. When enabled, every successful normal AI reply is followed by a separate low-token classification call.

- Provide animation rows named `happy`, `disgusted`, `tsundere`, `shocked`, `angry`, `blushing`, and `helpless`.
- Keep `fallbackState` mapped to an existing row such as `waving`.
- Verify the full atlas dimensions and frame counts before enabling the feature.
- Local paths, code blocks, and credential-like strings are removed from the classifier context.
- Character personality files must not control this feature; it is a packaging and asset capability.
- Run `npm.cmd run test:emotion` before packaging.

## Test Entry

After packaging, test this executable:

```text
D:\Documents\展示项目内容\roxy-electron-pet-framework\release\win-unpacked\PetFramework.exe
```
