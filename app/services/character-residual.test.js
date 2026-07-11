'use strict';

/*
 * 角色残留扫描测试（Roxy / 昌昌 残留检查）
 *
 * 角色单一来源目标：换皮时只需修改 pet-profile.js 和 personalities/ 下的角色文件，
 * 不应在 main.js / renderer.js / styles.css / prompt-builder.js / affection-service.js
 * 等通用代码中残留 Roxy 或 昌昌 硬编码。
 *
 * 允许出现 Roxy / 昌昌 的位置：
 *   - app/config/pet-profile.js（角色配置源头）
 *   - app/services/conversation-harness/personalities/**（角色 personality 定义）
 *   - 测试文件 *.test.js
 *   - prompt-builder.js 中向后兼容别名 buildRoxyPrompt（保留别名以免破坏旧调用方）
 *
 * 本测试为源码扫描测试，不依赖 electron 运行时。
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const APP_ROOT = path.resolve(__dirname, '..');

const SCAN_FILES = [
  'main.js',
  'renderer.js',
  'styles.css',
  'preload.js',
  'index.html',
  'services/prompt-builder.js',
  'services/affection-service.js',
  'services/memory-service.js',
  'services/pet-data-store.js',
  'services/safe-shell-service.js',
  'services/token-budget.js',
  'services/response-emotion-service.js',
  'services/conversation-harness/index.js',
  'services/conversation-harness/core/handle-user-message.js',
  'services/conversation-harness/postcheck/post-check.js',
  'services/conversation-harness/policy/policy-controller.js',
  'services/conversation-harness/policy/playfulness-gate.js',
  'services/conversation-harness/analyzer/boundary-engine.js',
  'services/conversation-harness/analyzer/conversation-analyzer.js',
  'services/conversation-harness/planner/dialogue-planner.js',
  'services/conversation-harness/generator/response-generator.js',
  'services/conversation-harness/generator/llm-client.js',
  'services/conversation-harness/generator/prompt-builder.js',
  'services/conversation-harness/state/conversation-state.js'
];

const ALLOWED_HARDCODE = [
  // 兼容别名：保留 buildRoxyPrompt 作为向后兼容导出
  { file: 'services/prompt-builder.js', pattern: /buildRoxyPrompt|向后兼容别名|旧代码使用 buildRoxyPrompt/u }
];

const ROXY_PATTERN = /Roxy/u;
const CHANGCHANG_PATTERN = /\u660c\u660c/u;

function readFileSafe(relativePath) {
  const full = path.join(APP_ROOT, relativePath);
  try {
    return fs.readFileSync(full, 'utf8');
  } catch {
    return null;
  }
}

function isAllowed(file, line, pattern) {
  return ALLOWED_HARDCODE.some((rule) => {
    if (rule.file !== file) return false;
    return rule.pattern.test(line);
  });
}

function scanFile(relativePath) {
  const content = readFileSafe(relativePath);
  if (content == null) {
    return { file: relativePath, missing: true, roxyLines: [], changchangLines: [] };
  }
  const lines = content.split(/\r?\n/);
  const roxyLines = [];
  const changchangLines = [];
  lines.forEach((line, index) => {
    if (ROXY_PATTERN.test(line) && !isAllowed(relativePath, line, ROXY_PATTERN)) {
      roxyLines.push({ line: index + 1, text: line });
    }
    if (CHANGCHANG_PATTERN.test(line) && !isAllowed(relativePath, line, CHANGCHANG_PATTERN)) {
      changchangLines.push({ line: index + 1, text: line });
    }
  });
  return { file: relativePath, missing: false, roxyLines, changchangLines };
}

function run() {
  const results = SCAN_FILES.map(scanFile);

  const missingFiles = results.filter((r) => r.missing);
  assert.strictEqual(
    missingFiles.length,
    0,
    `角色残留扫描发现缺失文件：\n${missingFiles.map((r) => `  - ${r.file}`).join('\n')}`
  );

  const roxyHits = results.filter((r) => r.roxyLines.length > 0);
  const changchangHits = results.filter((r) => r.changchangLines.length > 0);

  assert.strictEqual(
    roxyHits.length,
    0,
    `通用代码中检测到 Roxy 硬编码残留：\n${roxyHits
      .map((r) => r.roxyLines.map((l) => `  - ${r.file}:${l.line} -> ${l.text.trim()}`).join('\n'))
      .join('\n')}\n请将角色名收敛到 app/config/pet-profile.js 或 personalities/ 下。`
  );

  assert.strictEqual(
    changchangHits.length,
    0,
    `通用代码中检测到 昌昌 硬编码残留：\n${changchangHits
      .map((r) => r.changchangLines.map((l) => `  - ${r.file}:${l.line} -> ${l.text.trim()}`).join('\n'))
      .join('\n')}\n请将用户称呼收敛到 app/config/pet-profile.js 的 userPetName 字段。`
  );

  // 检查 localStorage 命名空间：通用代码不应直接写死 roxy- 前缀
  const roxyLsHits = [];
  for (const relativePath of SCAN_FILES) {
    const content = readFileSafe(relativePath);
    if (!content) continue;
    const lines = content.split(/\r?\n/);
    lines.forEach((line, index) => {
      if (/roxy-/i.test(line) || /localStorage\.setItem\(\s*['"]roxy/i.test(line)) {
        roxyLsHits.push({ file: relativePath, line: index + 1, text: line });
      }
    });
  }
  assert.strictEqual(
    roxyLsHits.length,
    0,
    `通用代码中检测到直接硬编码的 roxy- localStorage 前缀：\n${roxyLsHits
      .map((h) => `  - ${h.file}:${h.line} -> ${h.text.trim()}`)
      .join('\n')}\n请使用 lsKey() 帮助函数基于 localStorageNamespace 生成 key。`
  );

  console.log(`[OK] character-residual: scanned ${SCAN_FILES.length} files, no Roxy/昌昌 residuals.`);
}

try {
  run();
  process.exit(0);
} catch (error) {
  console.error(`[FAIL] character-residual: ${error.message}`);
  process.exit(1);
}
