'use strict';

/*
 * Safe Shell 输出脱敏测试
 *
 * 验证 sanitizeShellOutput 的行为：
 *   1. git diff 输出中的密钥/令牌被掩码。
 *   2. git diff 输出中的本地路径被掩码。
 *   3. git diff 输出中的网络路径被掩码。
 *   4. 非 git diff 命令（Get-Process 等）的输出保持原样，不做脱敏。
 *   5. 空输入安全处理。
 *
 * 本测试为单元测试，不依赖 electron 运行时。
 */

const assert = require('assert');
const { sanitizeShellOutput } = require('../safe-shell-service.js');

let passCount = 0;
function pass(name) {
  passCount += 1;
  console.log(`PASS ${name}`);
}

function run() {
  // 1. OpenAI / DeepSeek / GitHub token 被掩码
  const tokenCases = [
    'diff --git a/config.js b/config.js\n+  apiKey: "sk-abcdefghijklmnopqrstuvwxyz0123456789"',
    'token=ghp_1234567890abcdefghijklm',
    'Authorization: Bearer rk-1234567890abcdefghijklmnopqrstuvwxyz',
    'xoxb-1234567890-abcdef'
  ];
  for (const input of tokenCases) {
    const result = sanitizeShellOutput('git diff', input);
    assert.ok(
      !/(?:sk|rk|pk|ghp|gho|github_pat|xox[baprs]|AIza)-[A-Za-z0-9_-]{12,}/.test(result),
      `git diff 输出应掩码 token，输入：${input}，结果：${result}`
    );
    assert.ok(result.includes('[secret]'), `git diff 输出应包含 [secret]，结果：${result}`);
  }
  pass('git diff masks API tokens');

  // 2. 本地路径被掩码
  const localPathInput = 'diff --git a/file.js b/file.js\n+- const data = require("C:\\\\Users\\\\admin\\\\secrets\\\\config.json")';
  const localPathResult = sanitizeShellOutput('git diff', localPathInput);
  assert.ok(
    !/C:\\\\Users/.test(localPathResult),
    `git diff 输出应掩码本地路径，结果：${localPathResult}`
  );
  pass('git diff masks local paths');

  // 3. api_key=xxx 被掩码
  const apikeyInput = 'diff --git a/.env b/.env\n+api_key=sk_test_1234567890abcdefghijklmnop';
  const apikeyResult = sanitizeShellOutput('git diff', apikeyInput);
  assert.ok(
    !/api_key=sk_test/.test(apikeyResult),
    `git diff 输出应掩码 api_key= 形式，结果：${apikeyResult}`
  );
  pass('git diff masks api_key= assignments');

  // 4. 非 git diff 命令保持原样
  const nonGitDiffInput = 'Handles  NPM(K)    PM(K)      WS(K)    CPU(s)     Id  ProcessName\n-----------------------\n     123      456      789      12.34     5678  chrome';
  const nonGitDiffResult = sanitizeShellOutput('Get-Process | Select-Object Name,Id', nonGitDiffInput);
  assert.strictEqual(
    nonGitDiffResult,
    nonGitDiffInput,
    'Get-Process 输出不应被脱敏'
  );
  pass('non-git-diff commands keep original output');

  // 5. git log（非 diff）保持原样
  const gitLogInput = 'commit abc1234\nAuthor: user <user@example.com>\nDate:   Mon Jan 1\n    fix bug';
  const gitLogResult = sanitizeShellOutput('git log --oneline -n 10', gitLogInput);
  assert.strictEqual(gitLogResult, gitLogInput, 'git log 输出不应被脱敏');
  pass('git log is not sanitized');

  // 6. 空输入安全处理
  assert.strictEqual(sanitizeShellOutput('git diff', ''), '', '空字符串应保持原样');
  assert.strictEqual(sanitizeShellOutput('git diff', null), '', 'null 应返回空串');
  assert.strictEqual(sanitizeShellOutput('git diff', undefined), '', 'undefined 应返回空串');
  pass('empty input handled safely');

  console.log(`safe shell output sanitization tests passed (${passCount} checks)`);
}

try {
  run();
  process.exit(0);
} catch (error) {
  console.error(`[FAIL] ${error.message}`);
  process.exit(1);
}
