const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  REQUIRED_SHEET,
  getMaterialsDir,
  listMaterials,
  copyImportedSpriteSheet,
  applyMaterial,
  restoreDefaultMaterial
} = require('./runtime-material-service');
const { clearFrameworkRuntimeData } = require('./runtime-reset-service');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-framework-runtime-'));
const source = path.join(root, 'sample.webp');
fs.writeFileSync(source, 'fake-webp');

const nativeImage = {
  createFromPath: () => ({
    isEmpty: () => false,
    getSize: () => ({ width: REQUIRED_SHEET.width, height: REQUIRED_SHEET.height })
  })
};

try {
  const imported = copyImportedSpriteSheet({ userDataDir: root, sourcePath: source, nativeImage });
  assert.equal(imported.ok, true);
  assert.equal(listMaterials(root).activeId, imported.material.id);
  assert.equal(fs.existsSync(path.join(getMaterialsDir(root), imported.material.fileName)), true);

  assert.equal(restoreDefaultMaterial(root).activeId, null);
  assert.equal(applyMaterial(root, imported.material.id).ok, true);

  fs.writeFileSync(path.join(root, 'pet-data.sqlite'), 'runtime');
  fs.writeFileSync(path.join(root, 'pet-data.sqlite-wal'), 'runtime');
  fs.writeFileSync(path.join(root, 'api-config.json'), '{}');
  fs.mkdirSync(path.join(root, 'logs'));
  const builtInBlue = path.join(os.tmpdir(), 'blue-default-asset.webp');
  fs.writeFileSync(builtInBlue, 'built-in');

  clearFrameworkRuntimeData(root);
  assert.equal(fs.existsSync(path.join(root, 'pet-data.sqlite')), false);
  assert.equal(fs.existsSync(path.join(root, 'api-config.json')), false);
  assert.equal(fs.existsSync(getMaterialsDir(root)), false);
  assert.equal(fs.existsSync(builtInBlue), true);
  fs.rmSync(builtInBlue, { force: true });
  console.log('PASS runtime material and reset services');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
