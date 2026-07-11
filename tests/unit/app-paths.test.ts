/**
 * 阶段 8e 路径解析测试。
 * 验证开发模式与打包模式下路径解析正确，且不依赖 Electron。
 *
 * 运行：npx tsx tests/unit/app-paths.test.ts
 */
import * as path from 'path';
import { resolveAppPaths, DEFAULT_DATABASE_FILE_NAME } from '../../src/infrastructure/config/app-paths';

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

// ===== 测试 1：开发模式默认路径 =====
function testDevDefaultPaths(): void {
  const appRoot = 'C:\\fake\\project-root';
  const paths = resolveAppPaths({ appRoot });

  check('Dev: userDataDir = {appRoot}/data',
    paths.userDataDir === path.join(appRoot, 'data'));
  check('Dev: resourcesDir = {appRoot}/resources',
    paths.resourcesDir === path.join(appRoot, 'resources'));
  check('Dev: databasePath = {userDataDir}/pet-data.sqlite',
    paths.databasePath === path.join(appRoot, 'data', DEFAULT_DATABASE_FILE_NAME));
  check('Dev: logsDir = {userDataDir}/logs',
    paths.logsDir === path.join(paths.userDataDir, 'logs'));
  check('Dev: characterPacksDir = {resourcesDir}/character-packs',
    paths.characterPacksDir === path.join(paths.resourcesDir, 'character-packs'));
  check('Dev: backupsDir = {userDataDir}/backups',
    paths.backupsDir === path.join(paths.userDataDir, 'backups'));
  check('Dev: isPackaged = false', paths.isPackaged === false);
}

// ===== 测试 2：打包模式路径 =====
function testPackagedPaths(): void {
  const userDataDir = 'C:\\Users\\Test\\AppData\\Roaming\\PetFramework';
  const resourcesDir = 'C:\\Program Files\\PetFramework\\resources';
  const paths = resolveAppPaths({
    isPackaged: true,
    userDataDir,
    resourcesDir
  });

  check('Packaged: userDataDir preserved', paths.userDataDir === userDataDir);
  check('Packaged: resourcesDir preserved', paths.resourcesDir === resourcesDir);
  check('Packaged: databasePath = {userDataDir}/pet-data.sqlite',
    paths.databasePath === path.join(userDataDir, DEFAULT_DATABASE_FILE_NAME));
  check('Packaged: logsDir = {userDataDir}/logs',
    paths.logsDir === path.join(userDataDir, 'logs'));
  check('Packaged: characterPacksDir = {resourcesDir}/character-packs',
    paths.characterPacksDir === path.join(resourcesDir, 'character-packs'));
  check('Packaged: backupsDir = {userDataDir}/backups',
    paths.backupsDir === path.join(userDataDir, 'backups'));
  check('Packaged: isPackaged = true', paths.isPackaged === true);
}

// ===== 测试 3：打包模式缺少必填参数会抛错 =====
function testPackagedMissingThrows(): void {
  let threw1 = false;
  try {
    resolveAppPaths({ isPackaged: true });
  } catch (e) {
    threw1 = true;
    check('PackagedMissing: error mentions userDataDir',
      (e as Error).message.includes('userDataDir'));
  }
  check('PackagedMissing: throws when userDataDir missing', threw1);

  let threw2 = false;
  try {
    resolveAppPaths({ isPackaged: true, userDataDir: 'C:\\fake' });
  } catch (e) {
    threw2 = true;
    check('PackagedMissing: error mentions resourcesDir',
      (e as Error).message.includes('resourcesDir'));
  }
  check('PackagedMissing: throws when resourcesDir missing', threw2);
}

// ===== 测试 4：自定义数据库文件名 =====
function testCustomDatabaseFileName(): void {
  const paths = resolveAppPaths({
    appRoot: 'C:\\fake',
    databaseFileName: 'custom.db'
  });
  check('CustomDbName: databasePath ends with custom.db',
    paths.databasePath.endsWith('custom.db'));
  check('CustomDbName: databasePath not default name',
    !paths.databasePath.endsWith(DEFAULT_DATABASE_FILE_NAME));
}

// ===== 测试 5：开发模式显式传入 userDataDir 覆盖默认 =====
function testDevExplicitOverride(): void {
  const paths = resolveAppPaths({
    isPackaged: false,
    appRoot: 'C:\\fake\\root',
    userDataDir: 'D:\\custom-data'
  });
  check('DevOverride: userDataDir uses explicit value',
    paths.userDataDir === 'D:\\custom-data');
  check('DevOverride: resourcesDir still from appRoot',
    paths.resourcesDir === path.join('C:\\fake\\root', 'resources'));
  check('DevOverride: databasePath under custom userDataDir',
    paths.databasePath === path.join('D:\\custom-data', DEFAULT_DATABASE_FILE_NAME));
}

// ===== 测试 6：打包模式与开发模式路径不同 =====
function testDevAndPackagedDiffer(): void {
  const devPaths = resolveAppPaths({ appRoot: 'C:\\fake' });
  const packagedPaths = resolveAppPaths({
    isPackaged: true,
    userDataDir: 'C:\\Users\\AppData\\Roaming\\Pet',
    resourcesDir: 'C:\\Program Files\\Pet\\resources'
  });

  check('Diff: dev databasePath != packaged databasePath',
    devPaths.databasePath !== packagedPaths.databasePath);
  check('Diff: dev characterPacksDir != packaged characterPacksDir',
    devPaths.characterPacksDir !== packagedPaths.characterPacksDir);
  check('Diff: isPackaged flag differs',
    devPaths.isPackaged !== packagedPaths.isPackaged);
}

// ===== 测试 7：CharacterPackManager 可消费 characterPacksDir =====
function testCharacterPackManagerConsumesPath(): void {
  // 验证 characterPacksDir 可拼接子路径，且不依赖 Electron
  const paths = resolveAppPaths({
    isPackaged: true,
    userDataDir: 'C:\\Users\\AppData',
    resourcesDir: 'C:\\Program Files\\Pet\\resources'
  });
  const expectedPackPath = path.join(paths.characterPacksDir, 'roxy');
  check('CharPack: can build pack path from characterPacksDir',
    expectedPackPath === path.join('C:\\Program Files\\Pet\\resources', 'character-packs', 'roxy'));
  check('CharPack: path contains character-packs segment',
    expectedPackPath.includes('character-packs'));
}

// ===== 运行所有测试 =====
function runAll(): void {
  console.log('=== app-paths tests ===');
  testDevDefaultPaths();
  testPackagedPaths();
  testPackagedMissingThrows();
  testCustomDatabaseFileName();
  testDevExplicitOverride();
  testDevAndPackagedDiffer();
  testCharacterPackManagerConsumesPath();

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.error('Failures:', failures);
    process.exit(1);
  }
}

runAll();
