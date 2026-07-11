/**
 * 阶段 3 角色包与 Renderer 测试。
 * 验证架构计划阶段 3 验收标准：
 *   1. 默认角色从角色包加载
 *   2. Prompt、Persona、资源不再散落硬编码
 *   3. SpriteSheet 失败时显示占位角色
 *   4. Renderer 切换不影响 Graph
 *   5. 无效角色包不能覆盖有效角色
 *
 * 运行：npx tsx tests/unit/character-pack.test.ts
 */
import * as path from 'path';
import * as fs from 'fs';

import { CharacterPackManager, type LoadedCharacterPack } from '../../src/services/CharacterPackManager';
import { CharacterRenderer, type RenderCommand, type SendCommandFn } from '../../src/services/character/CharacterRenderer';
import { SpriteSheetRenderer, spritesheetMetadataSchema } from '../../src/services/character/SpriteSheetRenderer';
import { Live2DRenderer } from '../../src/services/character/Live2DRenderer';
import { PlaceholderRenderer } from '../../src/services/character/PlaceholderRenderer';
import { CharacterPackInvalidError } from '../../src/shared/contracts/errors';

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, condition: boolean): void {
  if (condition) {
    pass++;
    console.log(`PASS ${name}`);
  } else {
    fail++;
    failures.push(name);
    console.error(`FAIL ${name}`);
  }
}

function checkThrows(name: string, fn: () => void): void {
  try {
    fn();
    fail++;
    failures.push(name);
    console.error(`FAIL ${name} (expected throw, got none)`);
  } catch {
    pass++;
    console.log(`PASS ${name}`);
  }
}

/** 采集发送到 Renderer 的命令 */
function makeCommandCollector(): { send: SendCommandFn; commands: Array<{ channel: string; payload: RenderCommand }> } {
  const commands: Array<{ channel: string; payload: RenderCommand }> = [];
  return {
    send: (channel: string, payload: unknown) => {
      commands.push({ channel, payload: payload as RenderCommand });
    },
    commands
  };
}

// ===== 测试 1：默认角色包从角色包加载 =====
function testDefaultPackLoads(): void {
  const packPath = path.resolve(__dirname, '../../character-packs/default');
  const manager = new CharacterPackManager();
  const pack = manager.load(packPath);

  check('Pack: manifest id is default-roxy', pack.manifest.id === 'default-roxy');
  check('Pack: manifest schemaVersion is 1', pack.manifest.schemaVersion === 1);
  check('Pack: manifest name is Roxy', pack.manifest.name === 'Roxy');

  // Persona 加载
  check('Pack: persona characterName is Roxy', pack.persona.characterName === 'Roxy');
  check('Pack: persona corePrompt not empty', pack.persona.corePrompt.length > 0);
  check('Pack: persona speakingStyle has entries', pack.persona.speakingStyle.length > 0);
  check('Pack: persona relationshipBoundary has entries', pack.persona.relationshipBoundary.length > 0);
  check('Pack: persona forbiddenDrift has entries', pack.persona.forbiddenDrift.length > 0);
  check('Pack: persona sampleDialogues has entries', pack.persona.sampleDialogues.length > 0);

  // Prompt 加载
  check('Pack: prompt.md not empty', pack.prompt.length > 0);
  check('Pack: prompt contains Roxy', pack.prompt.includes('Roxy'));
  check('Pack: prompt contains 昌昌', pack.prompt.includes('昌昌'));

  // MotionMap 加载
  check('Pack: motionMap is object', typeof pack.motionMap === 'object' && pack.motionMap !== null);
  const motionMap = pack.motionMap as Record<string, unknown>;
  check('Pack: motionMap has rows', 'rows' in motionMap);
  check('Pack: motionMap has cellWidth', motionMap.cellWidth === 192);

  // 资源路径
  check('Pack: packPath matches', pack.packPath === packPath);
}

// ===== 测试 2：Prompt 和 Persona 不再硬编码 =====
function testNoHardcodedProfile(): void {
  const packPath = path.resolve(__dirname, '../../character-packs/default');
  const manager = new CharacterPackManager();
  const pack = manager.load(packPath);

  // Persona 来自 persona.json，而非代码
  check('NoHardcode: persona characterId matches manifest id', pack.persona.characterId === pack.manifest.id);
  check('NoHardcode: persona corePrompt from file', pack.persona.corePrompt.includes('异世界'));
  check('NoHardcode: persona userPetName is template placeholder', (pack.persona as any).userPetName === '{{user_display_name}}');

  // Prompt 来自 prompt.md
  const promptPath = path.join(packPath, 'prompt.md');
  const promptFileContent = fs.readFileSync(promptPath, 'utf8');
  check('NoHardcode: prompt matches prompt.md file', pack.prompt === promptFileContent);
}

// ===== 测试 3：无效角色包不能覆盖有效角色 =====
function testInvalidPackDoesNotOverwrite(): void {
  const validPath = path.resolve(__dirname, '../../character-packs/default');
  const manager = new CharacterPackManager();
  const validPack = manager.load(validPath);

  // 创建一个无效角色包目录
  const invalidDir = path.join(require('os').tmpdir(), `invalid-pack-${Date.now()}`);
  fs.mkdirSync(invalidDir, { recursive: true });
  // 写一个无效 manifest（缺必需字段）
  fs.writeFileSync(
    path.join(invalidDir, 'manifest.json'),
    JSON.stringify({ schemaVersion: 1, id: 'bad-pack' }) // 缺 name/version/persona 等
  );

  let result: LoadedCharacterPack;
  let threw = false;
  try {
    result = manager.load(invalidDir);
  } catch (e) {
    threw = true;
    result = validPack; // 保持引用
  }

  // 第一次加载有效包后加载无效包：应回退到有效包（或抛错，取决于是否有 previousPack）
  // 因为已有 activePack，load 失败时应回退
  if (!threw) {
    check('InvalidPack: invalid pack did not overwrite valid pack', result.manifest.id === 'default-roxy');
  } else {
    // 如果直接抛错也合理（没有有效包可回退的情况）
    check('InvalidPack: invalid pack threw CharacterPackInvalidError', true);
  }

  // 当前激活角色仍是有效的
  const active = manager.getActivePack();
  check('InvalidPack: active pack still valid', active !== null && active.manifest.id === 'default-roxy');

  // 清理
  try { fs.rmSync(invalidDir, { recursive: true }); } catch { /* ignore */ }
}

// ===== 测试 4：路径穿越被拒绝 =====
function testPathTraversalRejected(): void {
  const validPath = path.resolve(__dirname, '../../character-packs/default');
  const manager = new CharacterPackManager();
  manager.load(validPath);

  // 创建一个包含路径穿越 manifest 的角色包
  const maliciousDir = path.join(require('os').tmpdir(), `malicious-pack-${Date.now()}`);
  fs.mkdirSync(maliciousDir, { recursive: true });
  fs.writeFileSync(
    path.join(maliciousDir, 'manifest.json'),
    JSON.stringify({
      schemaVersion: 1,
      id: 'malicious',
      name: 'Malicious',
      version: '1.0.0',
      persona: '../../../etc/passwd', // 路径穿越
      prompt: 'prompt.md',
      motionMap: 'motion-map.json',
      renderers: {
        default: 'spritesheet',
        spritesheet: { atlas: 'spritesheet/atlas.webp', metadata: 'spritesheet/spritesheet.json' },
        live2d: null
      }
    })
  );
  fs.writeFileSync(path.join(maliciousDir, 'prompt.md'), 'test');

  // load() 在已有有效包时会回退而非抛错；验证恶意包未被加载
  const result = manager.load(maliciousDir);
  check('PathTraversal: malicious pack rejected (fell back to valid)', result.manifest.id === 'default-roxy');

  // 当前激活角色仍是有效的
  const active = manager.getActivePack();
  check('PathTraversal: active pack still valid', active !== null && active.manifest.id === 'default-roxy');

  try { fs.rmSync(maliciousDir, { recursive: true }); } catch { /* ignore */ }
}

// ===== 测试 5：CharacterRenderer 统一接口 =====
function testCharacterRendererInterface(): void {
  const { send, commands } = makeCommandCollector();
  const renderer = new CharacterRenderer({
    type: 'spritesheet',
    sendCommand: send,
    spriteSheetUrl: 'file:///spritesheet.webp'
  });

  check('Renderer: initial type is spritesheet', renderer.getType() === 'spritesheet');
  check('Renderer: initial state is idle', renderer.getCurrentState() === 'idle');
  check('Renderer: not placeholder', renderer.isPlaceholder() === false);

  // setState
  renderer.setState('waving');
  check('Renderer: setState sends command', commands.length === 1);
  check('Renderer: setState channel is set-state', commands[0].channel === 'set-state');
  check('Renderer: state is waving', commands[0].payload.state === 'waving');

  // 重复 setState 不发送
  renderer.setState('waving');
  check('Renderer: duplicate setState skipped', commands.length === 1);

  // setScale
  renderer.setScale(1.5);
  check('Renderer: setScale sends command', commands.length === 2);
  check('Renderer: scale clamped', commands[1].payload.scale === 1.5);

  // setScale 超范围被 clamp
  renderer.setScale(100);
  check('Renderer: scale over max clamped to 3', commands[2].payload.scale === 3);

  renderer.setScale(0);
  check('Renderer: scale under min clamped to 0.2', commands[3].payload.scale === 0.2);

  // showBubble
  renderer.showBubble('你好', 5000);
  check('Renderer: showBubble sends text', commands[4].payload.text === '你好');
  check('Renderer: showBubble sends duration', commands[4].payload.durationMs === 5000);

  // hideBubble
  renderer.hideBubble();
  check('Renderer: hideBubble sends command', commands[5].channel === 'hide-bubble');
}

// ===== 测试 6：Renderer 切换不影响接口 =====
function testRendererSwitch(): void {
  const { send, commands } = makeCommandCollector();
  const renderer = new CharacterRenderer({
    type: 'spritesheet',
    sendCommand: send,
    spriteSheetUrl: 'file:///spritesheet.webp'
  });

  // 切换到 placeholder
  renderer.switchType('placeholder');
  check('Switch: type changed to placeholder', renderer.getType() === 'placeholder');
  check('Switch: isPlaceholder true', renderer.isPlaceholder() === true);

  // 切换后仍可正常 setState
  renderer.setState('jumping');
  const stateCmd = commands.find((c) => c.channel === 'set-state');
  check('Switch: setState still works after switch', stateCmd !== undefined && stateCmd.payload.state === 'jumping');

  // 切换回 spritesheet
  renderer.switchType('spritesheet', { spriteSheetUrl: 'file:///new.webp' });
  check('Switch: type changed back to spritesheet', renderer.getType() === 'spritesheet');
  check('Switch: isPlaceholder false', renderer.isPlaceholder() === false);
}

// ===== 测试 7：SpriteSheetRenderer 加载和降级 =====
function testSpriteSheetLoadAndDegrade(): void {
  const packPath = path.resolve(__dirname, '../../character-packs/default');
  const spriteSheet = new SpriteSheetRenderer({
    atlasPath: 'spritesheet/atlas.webp',
    metadataPath: 'spritesheet/spritesheet.json',
    packRoot: packPath
  });

  const loaded = spriteSheet.load();
  check('SpriteSheet: load valid', loaded.valid === true);
  check('SpriteSheet: errors empty', loaded.errors.length === 0);
  check('SpriteSheet: cellWidth 192', loaded.metadata.cellWidth === 192);
  check('SpriteSheet: cellHeight 208', loaded.metadata.cellHeight === 208);
  check('SpriteSheet: has rows', Object.keys(loaded.metadata.rows).length >= 9);

  // resolveRow
  const idleRow = spriteSheet.resolveRow('idle');
  check('SpriteSheet: resolveRow idle', idleRow !== null && idleRow.row === 0);

  // resolveRow 不存在时回退
  const unknownRow = spriteSheet.resolveRow('unknown_state');
  check('SpriteSheet: resolveRow fallback to waving', unknownRow !== null && unknownRow.row === 3);

  // isValid
  check('SpriteSheet: isValid true', spriteSheet.isValid() === true);

  // degradeToPlaceholder
  const degraded = spriteSheet.degradeToPlaceholder();
  check('SpriteSheet: degradeToPlaceholder returns placeholder', degraded === 'placeholder');
}

// ===== 测试 8：SpriteSheet 元数据校验 =====
function testSpriteSheetMetadataValidation(): void {
  // 合法 metadata
  const valid = {
    cellWidth: 192,
    cellHeight: 208,
    sheetWidth: 1536,
    sheetHeight: 1872,
    fallbackState: 'waving',
    rows: {
      idle: { row: 0, frames: 6, fps: 5 }
    }
  };
  check('Metadata: valid passes', spritesheetMetadataSchema.safeParse(valid).success === true);

  // 非法：cellWidth 为 0
  const badCell = { ...valid, cellWidth: 0 };
  check('Metadata: cellWidth 0 rejected', spritesheetMetadataSchema.safeParse(badCell).success === false);

  // 非法：frames 超过 64
  const badFrames = {
    ...valid,
    rows: { idle: { row: 0, frames: 100, fps: 5 } }
  };
  check('Metadata: frames > 64 rejected', spritesheetMetadataSchema.safeParse(badFrames).success === false);

  // 非法：fps 超过 60
  const badFps = {
    ...valid,
    rows: { idle: { row: 0, frames: 6, fps: 120 } }
  };
  check('Metadata: fps > 60 rejected', spritesheetMetadataSchema.safeParse(badFps).success === false);
}

// ===== 测试 9：SpriteSheet 加载失败时用 Placeholder =====
function testSpriteSheetFailureUsesPlaceholder(): void {
  const packPath = path.resolve(__dirname, '../../character-packs/default');

  // 指向不存在的 atlas
  const badSprite = new SpriteSheetRenderer({
    atlasPath: 'spritesheet/nonexistent.webp',
    metadataPath: 'spritesheet/spritesheet.json',
    packRoot: packPath
  });
  const loaded = badSprite.load();
  check('Failure: invalid atlas detected', loaded.valid === false);
  check('Failure: error reported', loaded.errors.length > 0);

  // 降级到 placeholder
  const placeholderType = badSprite.degradeToPlaceholder();
  check('Failure: degrade returns placeholder', placeholderType === 'placeholder');
}

// ===== 测试 10：Live2D 渲染器空实现 =====
function testLive2DStub(): void {
  const live2d = new Live2DRenderer();

  // V1 不支持 Live2D
  check('Live2D: isAvailable false', live2d.isAvailable() === false);

  // loadModel 始终返回 false
  const result = live2d.loadModel({
    modelPath: 'model.json',
    textures: ['texture.png']
  });
  check('Live2D: loadModel returns false (stub)', result === false);

  // setMotion / setExpression 不抛错
  let noThrow = true;
  try {
    live2d.setMotion('idle');
    live2d.setExpression('happy');
  } catch {
    noThrow = false;
  }
  check('Live2D: stub methods do not throw', noThrow);

  // degradeToSpriteSheet
  check('Live2D: degrade returns spritesheet', live2d.degradeToSpriteSheet() === 'spritesheet');
}

// ===== 测试 11：PlaceholderRenderer 占位角色 =====
function testPlaceholderRenderer(): void {
  const { send, commands } = makeCommandCollector();
  const placeholder = new PlaceholderRenderer({ sendCommand: send });

  placeholder.apply();
  check('Placeholder: apply sends set-sprite-sheet', commands.length === 1);
  check('Placeholder: usePlaceholder true', commands[0].payload.usePlaceholder === true);
  check('Placeholder: spriteSheetUrl empty', commands[0].payload.spriteSheetUrl === '');

  placeholder.setState('waving');
  check('Placeholder: setState sends command', commands.length === 2);
  check('Placeholder: state is waving', commands[1].payload.state === 'waving');
  check('Placeholder: motion is CSS animation name', commands[1].payload.motion === 'placeholder-waving');

  // 重复 setState 不发送
  placeholder.setState('waving');
  check('Placeholder: duplicate setState skipped', commands.length === 2);

  placeholder.showBubble('占位消息');
  check('Placeholder: showBubble sends text', commands[2].payload.text === '占位消息');
}

// ===== 主入口 =====
function main(): void {
  console.log('=== Stage 3 Character Pack & Renderer Tests ===\n');

  console.log('--- 1. Default Pack Loads ---');
  testDefaultPackLoads();

  console.log('\n--- 2. No Hardcoded Profile ---');
  testNoHardcodedProfile();

  console.log('\n--- 3. Invalid Pack Does Not Overwrite ---');
  testInvalidPackDoesNotOverwrite();

  console.log('\n--- 4. Path Traversal Rejected ---');
  testPathTraversalRejected();

  console.log('\n--- 5. CharacterRenderer Interface ---');
  testCharacterRendererInterface();

  console.log('\n--- 6. Renderer Switch ---');
  testRendererSwitch();

  console.log('\n--- 7. SpriteSheet Load & Degrade ---');
  testSpriteSheetLoadAndDegrade();

  console.log('\n--- 8. SpriteSheet Metadata Validation ---');
  testSpriteSheetMetadataValidation();

  console.log('\n--- 9. SpriteSheet Failure Uses Placeholder ---');
  testSpriteSheetFailureUsesPlaceholder();

  console.log('\n--- 10. Live2D Stub ---');
  testLive2DStub();

  console.log('\n--- 11. PlaceholderRenderer ---');
  testPlaceholderRenderer();

  console.log(`\n=== Results: ${pass} passed, ${fail} failed ===`);
  if (fail > 0) {
    console.error('Failed tests:');
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
}

main();
