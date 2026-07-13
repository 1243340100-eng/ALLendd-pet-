const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { atomicWriteJson, readJsonWithFallback } = require('./pet-data-store');

const MATERIALS_DIR_NAME = 'runtime-materials';
const LIBRARY_FILE_NAME = 'material-library.json';
const MAX_FILE_BYTES = 24 * 1024 * 1024;
const REQUIRED_SHEET = Object.freeze({
  width: 1536,
  height: 1872,
  cellWidth: 192,
  cellHeight: 208,
  columns: 8,
  rows: 9
});
const ALLOWED_EXTENSIONS = new Set(['.png', '.webp']);

function getMaterialsDir(userDataDir) {
  return path.join(userDataDir, MATERIALS_DIR_NAME);
}

function getLibraryPath(userDataDir) {
  return path.join(getMaterialsDir(userDataDir), LIBRARY_FILE_NAME);
}

function normalizeMaterial(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || '').trim();
  const fileName = String(raw.fileName || '').trim();
  if (!/^[a-z0-9-]{8,80}$/i.test(id)) return null;
  if (!/^[a-z0-9-]+\.(?:png|webp)$/i.test(fileName)) return null;
  return {
    id,
    name: String(raw.name || '未命名动作图集').trim().slice(0, 80) || '未命名动作图集',
    fileName,
    createdAt: String(raw.createdAt || ''),
    width: Number(raw.width) || REQUIRED_SHEET.width,
    height: Number(raw.height) || REQUIRED_SHEET.height
  };
}

function readMaterialLibrary(userDataDir) {
  const fallback = { version: 1, activeId: null, materials: [] };
  const result = readJsonWithFallback(getLibraryPath(userDataDir));
  const raw = result?.data;
  if (!raw || typeof raw !== 'object') return fallback;
  const materials = Array.isArray(raw.materials)
    ? raw.materials.map(normalizeMaterial).filter(Boolean)
    : [];
  const activeId = materials.some((material) => material.id === raw.activeId)
    ? raw.activeId
    : null;
  return { version: 1, activeId, materials };
}

function writeMaterialLibrary(userDataDir, library) {
  const dir = getMaterialsDir(userDataDir);
  fs.mkdirSync(dir, { recursive: true });
  atomicWriteJson(getLibraryPath(userDataDir), library);
}

function getActiveMaterial(userDataDir) {
  const library = readMaterialLibrary(userDataDir);
  return library.materials.find((material) => material.id === library.activeId) || null;
}

function listMaterials(userDataDir) {
  const library = readMaterialLibrary(userDataDir);
  return {
    activeId: library.activeId,
    materials: library.materials
      .slice()
      .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
  };
}

function copyImportedSpriteSheet({ userDataDir, sourcePath, nativeImage }) {
  const source = path.resolve(String(sourcePath || ''));
  const ext = path.extname(source).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return { ok: false, error: '仅支持 PNG 或 WebP 动作图集。' };
  }
  if (!fs.existsSync(source)) {
    return { ok: false, error: '所选素材文件不存在。' };
  }

  const stat = fs.statSync(source);
  if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_FILE_BYTES) {
    return { ok: false, error: '素材文件无效，或大小超过 24 MB。' };
  }

  const image = nativeImage?.createFromPath?.(source);
  if (!image || image.isEmpty()) {
    return { ok: false, error: '无法读取该图片，请选择有效的 PNG 或 WebP 文件。' };
  }
  const size = image.getSize();
  if (size.width !== REQUIRED_SHEET.width || size.height !== REQUIRED_SHEET.height) {
    return {
      ok: false,
      error: `动作图集必须是 ${REQUIRED_SHEET.width} × ${REQUIRED_SHEET.height} 像素（8 × 9 格，每格 ${REQUIRED_SHEET.cellWidth} × ${REQUIRED_SHEET.cellHeight}）。`
    };
  }

  const id = `material-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const fileName = `${id}${ext}`;
  const targetDir = getMaterialsDir(userDataDir);
  const targetPath = path.join(targetDir, fileName);
  fs.mkdirSync(targetDir, { recursive: true });
  fs.copyFileSync(source, targetPath);

  const material = {
    id,
    name: path.basename(source, ext).trim().slice(0, 80) || '未命名动作图集',
    fileName,
    createdAt: new Date().toISOString(),
    width: size.width,
    height: size.height
  };
  const library = readMaterialLibrary(userDataDir);
  library.materials = [material, ...library.materials.filter((item) => item.id !== material.id)];
  library.activeId = material.id;
  writeMaterialLibrary(userDataDir, library);
  return { ok: true, material, activeId: material.id };
}

function applyMaterial(userDataDir, materialId) {
  const library = readMaterialLibrary(userDataDir);
  const material = library.materials.find((item) => item.id === materialId);
  if (!material) return { ok: false, error: '找不到这个已导入的素材。' };

  const sourcePath = path.join(getMaterialsDir(userDataDir), material.fileName);
  if (!fs.existsSync(sourcePath)) {
    return { ok: false, error: '素材文件已不存在，请重新导入。' };
  }
  library.activeId = material.id;
  writeMaterialLibrary(userDataDir, library);
  return { ok: true, material, activeId: material.id };
}

function restoreDefaultMaterial(userDataDir) {
  const library = readMaterialLibrary(userDataDir);
  library.activeId = null;
  writeMaterialLibrary(userDataDir, library);
  return { ok: true, activeId: null };
}

function resolveMaterialPath(userDataDir, materialId, requestedFileName) {
  const library = readMaterialLibrary(userDataDir);
  const material = library.materials.find((item) => item.id === materialId);
  if (!material || requestedFileName !== material.fileName) return null;

  const materialsDir = getMaterialsDir(userDataDir);
  const fullPath = path.resolve(materialsDir, material.fileName);
  const relative = path.relative(materialsDir, fullPath);
  if (relative.startsWith('..') || path.isAbsolute(relative) || !fs.existsSync(fullPath)) return null;
  return fullPath;
}

module.exports = {
  MATERIALS_DIR_NAME,
  REQUIRED_SHEET,
  getMaterialsDir,
  readMaterialLibrary,
  getActiveMaterial,
  listMaterials,
  copyImportedSpriteSheet,
  applyMaterial,
  restoreDefaultMaterial,
  resolveMaterialPath
};
