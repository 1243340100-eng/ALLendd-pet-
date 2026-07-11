const assert = require('assert');
const fs = require('fs');
const path = require('path');
const asar = require('@electron/asar');

const projectRoot = path.resolve(__dirname, '..', '..', '..');
const archivePath = path.join(projectRoot, 'release', 'win-unpacked', 'resources', 'app.asar');
assert.strictEqual(fs.existsSync(archivePath), true, `Packaged archive missing: ${archivePath}`);

const checks = [
  ['app\\main.js', 'petProfile.responseEmotion?.enabled'],
  ['app\\renderer.js', 'getResponseAnimationState'],
  ['app\\renderer.js', 'petProfile.spriteSheetSize'],
  ['app\\config\\pet-profile.js', 'responseEmotion:'],
  ['app\\services\\response-emotion-service.js', 'classifyResponseEmotion']
];

for (const [filePath, marker] of checks) {
  const content = asar.extractFile(archivePath, filePath).toString('utf8');
  assert.ok(content.includes(marker), `${filePath} is missing ${marker}`);
}

console.log('PASS packaged framework contains configurable response emotion support');
