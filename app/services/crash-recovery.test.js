const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { atomicWriteJson, readJsonWithFallback } = require('./pet-data-store');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-crash-test-'));
const dataPath = path.join(tmpDir, 'test-data.json');
const backupPath = dataPath + '.bak';
const tempPath = dataPath + '.tmp';

function cleanup() {
  for (const file of [dataPath, backupPath, tempPath]) {
    try { fs.unlinkSync(file); } catch { /* ignore */ }
  }
  try { fs.mkdirSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
}

function testAtomicWriteCreatesValidFile() {
  cleanup();
  const data = { name: 'Roxy', score: 42, items: [1, 2, 3] };
  atomicWriteJson(dataPath, data);
  const raw = fs.readFileSync(dataPath, 'utf8');
  assert.deepStrictEqual(JSON.parse(raw), data);
  assert(!fs.existsSync(tempPath), 'temp file should be renamed away');
}

function testAtomicWriteCreatesBackup() {
  cleanup();
  atomicWriteJson(dataPath, { version: 1 });
  atomicWriteJson(dataPath, { version: 2 });
  const backupRaw = fs.readFileSync(backupPath, 'utf8');
  assert.deepStrictEqual(JSON.parse(backupRaw), { version: 1 });
  const mainRaw = fs.readFileSync(dataPath, 'utf8');
  assert.deepStrictEqual(JSON.parse(mainRaw), { version: 2 });
}

function testReadFallbackRecoversFromCorruptedMain() {
  cleanup();
  atomicWriteJson(dataPath, { name: 'first', score: 1 });
  atomicWriteJson(dataPath, { name: 'second', score: 10 });
  fs.writeFileSync(dataPath, '{ corrupted json }}}', 'utf8');
  const result = readJsonWithFallback(dataPath);
  assert.strictEqual(result.source, 'backup');
  assert.strictEqual(result.recovered, true);
  // 备份保存的是上一版本（崩溃前的版本）
  assert.deepStrictEqual(result.data, { name: 'first', score: 1 });
}

function testReadFallbackReturnsNullWhenBothCorrupt() {
  cleanup();
  fs.writeFileSync(dataPath, 'not json', 'utf8');
  fs.writeFileSync(backupPath, 'also not json', 'utf8');
  const result = readJsonWithFallback(dataPath);
  assert.strictEqual(result.data, null);
  assert.strictEqual(result.source, 'none');
  assert.ok(result.errors.length >= 2);
}

function testAtomicWriteVerificationFailsOnCorruptTemp() {
  cleanup();
  let caught = null;
  try {
    const data = { valid: true };
    fs.writeFileSync(tempPath, 'corrupt', 'utf8');
    // atomicWriteJson 会先写 temp 再校验，这里测试校验逻辑本身
    atomicWriteJson(dataPath, data);
    // 如果 temp 被正确覆盖，应该成功
    const raw = fs.readFileSync(dataPath, 'utf8');
    assert.deepStrictEqual(JSON.parse(raw), data);
  } catch (error) {
    caught = error;
  }
  assert.strictEqual(caught, null);
}

function testNoBackupOnFirstWrite() {
  cleanup();
  atomicWriteJson(dataPath, { first: true });
  assert(!fs.existsSync(backupPath), 'no backup should exist on first write');
}

cleanup();
testAtomicWriteCreatesValidFile();
console.log('PASS crash-recovery: atomic write creates valid file');
testAtomicWriteCreatesBackup();
console.log('PASS crash-recovery: atomic write creates backup of previous version');
testReadFallbackRecoversFromCorruptedMain();
console.log('PASS crash-recovery: corrupted main file falls back to backup');
testReadFallbackReturnsNullWhenBothCorrupt();
console.log('PASS crash-recovery: both corrupt returns null with errors');
testAtomicWriteVerificationFailsOnCorruptTemp();
console.log('PASS crash-recovery: atomic write overwrites stale temp correctly');
testNoBackupOnFirstWrite();
console.log('PASS crash-recovery: no backup created on first write');
cleanup();
console.log('crash recovery tests passed');
