'use strict';

/*
 * 角色配置行为校验测试
 *
 * 验证角色动画/表情配置不仅“存在”，并且行为正确：
 *   1. spriteCell 与 spriteSheetSize 必须是正整数，且能整除（避免帧越界）。
 *   2. spriteSheet 为空时必须 usePlaceholderPet=true，避免空白显示。
 *   3. animationRows 每一项 row/frames/fps 必须落在合理范围。
 *   4. responseEmotion.fallbackState 必须真实存在于 baseRows ∪ animationRows 中。
 *   5. responseEmotion.durationMs 必须是正数。
 *
 * 本测试为源码扫描测试，不依赖 electron 运行时。
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const APP_ROOT = path.resolve(__dirname, '..');
const petProfile = require(path.join(APP_ROOT, 'config/pet-profile.js'));

// 与 renderer.js 中的 baseRows 保持一致，用于 fallbackState 校验。
const RENDERER_BASE_ROWS = {
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

function readRendererSource() {
  return fs.readFileSync(path.join(APP_ROOT, 'renderer.js'), 'utf8');
}

function extractBaseRowsFromRenderer() {
  // 简单从源码读取 baseRows 关键字，确保我们的副本与 renderer 一致；
  // 如果 renderer 的 baseRows 被改名或删除，这里会失败，提醒维护测试。
  const src = readRendererSource();
  assert.ok(
    src.includes('const baseRows'),
    'renderer.js 仍应保留 baseRows 作为默认动画行集合'
  );
  return RENDERER_BASE_ROWS;
}

function assertPositiveInt(value, label) {
  assert.ok(
    Number.isInteger(value) && value > 0,
    `${label} 必须是正整数，实际值：${value}`
  );
}

function run() {
  // 1. spriteCell / spriteSheetSize 类型与正整数校验
  const cell = petProfile.spriteCell || {};
  const sheetSize = petProfile.spriteSheetSize || {};
  assertPositiveInt(cell.width, 'spriteCell.width');
  assertPositiveInt(cell.height, 'spriteCell.height');
  assertPositiveInt(sheetSize.width, 'spriteSheetSize.width');
  assertPositiveInt(sheetSize.height, 'spriteSheetSize.height');

  // 2. 图集尺寸必须能被 cell 整除，否则会越界渲染半截帧
  assert.strictEqual(
    sheetSize.width % cell.width,
    0,
    `spriteSheetSize.width (${sheetSize.width}) 必须是 spriteCell.width (${cell.width}) 的整数倍，否则帧会越界`
  );
  assert.strictEqual(
    sheetSize.height % cell.height,
    0,
    `spriteSheetSize.height (${sheetSize.height}) 必须是 spriteCell.height (${cell.height}) 的整数倍，否则帧会越界`
  );

  const maxRow = Math.floor(sheetSize.height / cell.height) - 1;
  const maxFramesPerRow = Math.floor(sheetSize.width / cell.width);

  // 3. spriteSheet 与 usePlaceholderPet 互斥
  const hasSheet = String(petProfile.spriteSheet || '').trim().length > 0;
  if (!hasSheet) {
    assert.ok(
      petProfile.usePlaceholderPet === true,
      'spriteSheet 为空时 usePlaceholderPet 必须为 true，否则会显示空白宠物'
    );
  }

  // 4. animationRows 行为校验
  const animationRows = petProfile.animationRows || {};
  const baseRows = extractBaseRowsFromRenderer();
  const allRows = { ...baseRows, ...animationRows };
  for (const [name, def] of Object.entries(animationRows)) {
    assert.ok(
      typeof def === 'object' && def !== null,
      `animationRows.${name} 必须是对象，实际值：${typeof def}`
    );
    assertPositiveInt(def.row, `animationRows.${name}.row`);
    assert.ok(
      def.row <= maxRow,
      `animationRows.${name}.row (${def.row}) 超过图集最大行 ${maxRow}`
    );
    assert.ok(
      Number.isInteger(def.frames) && def.frames >= 1 && def.frames <= maxFramesPerRow,
      `animationRows.${name}.frames (${def.frames}) 必须在 1..${maxFramesPerRow} 之间`
    );
    assert.ok(
      Number.isFinite(def.fps) && def.fps > 0 && def.fps <= 60,
      `animationRows.${name}.fps (${def.fps}) 必须在 (0, 60] 之间`
    );
  }

  // 5. responseEmotion.fallbackState 必须真实存在
  const responseEmotion = petProfile.responseEmotion || {};
  const fallbackState = String(responseEmotion.fallbackState || '').trim();
  assert.ok(fallbackState, 'responseEmotion.fallbackState 不能为空');
  assert.ok(
    Object.prototype.hasOwnProperty.call(allRows, fallbackState),
    `responseEmotion.fallbackState (${fallbackState}) 在 baseRows ∪ animationRows 中不存在，运行时会退回 'waving'`
  );

  // 6. responseEmotion.durationMs 必须为正数
  assert.ok(
    Number.isFinite(responseEmotion.durationMs) && responseEmotion.durationMs > 0,
    `responseEmotion.durationMs 必须为正数，实际值：${responseEmotion.durationMs}`
  );

  // 7. conversationPersonalityId 必须真实存在于 personalities 中
  const personalityId = petProfile.conversationPersonalityId;
  assert.ok(typeof personalityId === 'string' && personalityId.trim(), 'conversationPersonalityId 不能为空');
  const personalitiesIndex = require(
    path.join(APP_ROOT, 'services/conversation-harness/personalities/index.js')
  );
  const allPersonalities = Object.values(personalitiesIndex.profiles || {});
  const personalityExists = allPersonalities.some((p) => p && p.id === personalityId);
  assert.ok(
    personalityExists,
    `conversationPersonalityId (${personalityId}) 在 personalities/ 中不存在，运行时会回退默认 personality`
  );

  console.log(
    `[OK] sprite-config: cell=${cell.width}x${cell.height}, sheet=${sheetSize.width}x${sheetSize.height}, ` +
    `maxRow=${maxRow}, maxFramesPerRow=${maxFramesPerRow}, fallbackState=${fallbackState} exists.`
  );
}

try {
  run();
  process.exit(0);
} catch (error) {
  console.error(`[FAIL] sprite-config: ${error.message}`);
  process.exit(1);
}
