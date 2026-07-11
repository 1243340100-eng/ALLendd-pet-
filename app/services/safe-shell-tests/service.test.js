const assert = require('assert');
const os = require('os');
const path = require('path');
const {
  SafeShellService,
  analyzeSafeCommand,
  inferSafeShellCommand
} = require('../safe-shell-service');

const workingRoot = path.resolve(__dirname, '..', '..', '..');

assert.strictEqual(
  inferSafeShellCommand('\u5e2e\u6211\u770b\u770b\u5f53\u524d\u76ee\u5f55\u6709\u54ea\u4e9b\u6587\u4ef6'),
  'Get-ChildItem'
);
assert.strictEqual(
  inferSafeShellCommand('\u770b\u770b git \u4ed3\u5e93\u73b0\u5728\u6709\u4ec0\u4e48\u6539\u52a8'),
  'git status'
);
assert.strictEqual(analyzeSafeCommand('Get-Location', workingRoot).allowed, true);
assert.strictEqual(analyzeSafeCommand('Remove-Item .\\README.md', workingRoot).allowed, false);
assert.strictEqual(analyzeSafeCommand('Get-ChildItem; shutdown /s', workingRoot).allowed, false);
assert.strictEqual(
  analyzeSafeCommand(`Get-Item -LiteralPath '${path.join(workingRoot, '.env')}'`, workingRoot).allowed,
  false
);

const userData = path.join(os.tmpdir(), `safe-shell-framework-${Date.now()}`);
let executedCommand = '';
const fakeChild = {
  stdout: { on(event, callback) { if (event === 'data') setTimeout(() => callback('framework-output'), 0); } },
  stderr: { on() {} },
  on(event, callback) { if (event === 'close') setTimeout(() => callback(0), 5); },
  kill() {}
};
const service = new SafeShellService({
  app: {
    getAppPath: () => workingRoot,
    getPath: () => userData
  },
  workingRoot,
  spawnProcess(_file, args) {
    executedCommand = args.at(-1);
    return fakeChild;
  }
});

(async () => {
  const request = service.interpret('\u5e2e\u6211\u770b\u770b\u5f53\u524d\u76ee\u5f55\u6709\u54ea\u4e9b\u6587\u4ef6');
  assert.strictEqual(request.handled, true);
  assert.ok(request.pendingAction?.id);
  assert.strictEqual(service.getSettings().enabled, false);
  const result = await service.confirm(request.pendingAction.id);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(service.getSettings().enabled, true);
  assert.ok(executedCommand.includes('Get-ChildItem'));
  assert.ok(result.reply.includes('framework-output'));

  const blocked = service.interpret('\u6267\u884c Remove-Item .\\README.md');
  assert.strictEqual(blocked.handled, true);
  assert.strictEqual(blocked.ok, false);
  assert.strictEqual(Boolean(blocked.pendingAction), false);

  console.log('PASS framework Safe Shell translates natural language and stays fail-closed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
