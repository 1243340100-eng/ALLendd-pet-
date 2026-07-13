const fs = require('fs');
const path = require('path');

const RUNTIME_FILES = [
  'pet-data.sqlite',
  'pet-data.sqlite-shm',
  'pet-data.sqlite-wal',
  'pet-data.json',
  'pet-data.json.bak',
  'pet-data.json.tmp',
  'api-config.json',
  'api-config.json.bak',
  'api-config.json.tmp',
  'architecture-status.json',
  'safe-shell-config.json',
  'safe-shell-config.json.bak',
  'safe-shell-config.json.tmp',
  'runtime-materials',
  'logs',
  'backups'
];

function safeRuntimePath(userDataDir, entryName) {
  const root = path.resolve(userDataDir);
  const target = path.resolve(root, entryName);
  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`拒绝清理用户目录外的路径：${entryName}`);
  }
  return target;
}

function removePath(targetPath, removed) {
  if (!fs.existsSync(targetPath)) return;
  fs.rmSync(targetPath, { recursive: true, force: true, maxRetries: 2 });
  removed.push(path.basename(targetPath));
}

/**
 * Clears only files produced in Electron userData. Built-in character packs live
 * in the app/resources directory and are intentionally outside this allowlist.
 */
function clearFrameworkRuntimeData(userDataDir) {
  const root = path.resolve(userDataDir);
  const removed = [];
  for (const entry of RUNTIME_FILES) {
    removePath(safeRuntimePath(root, entry), removed);
  }

  if (fs.existsSync(root)) {
    for (const entry of fs.readdirSync(root)) {
      if (entry.startsWith('pet-data.sqlite.backup-')) {
        removePath(safeRuntimePath(root, entry), removed);
      }
    }
  }
  return { removed };
}

module.exports = {
  RUNTIME_FILES,
  clearFrameworkRuntimeData
};
