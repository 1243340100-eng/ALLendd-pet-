/**
 * 应用路径解析。
 * 对应架构计划第 8 节"检查打包后的数据库、角色包和原生依赖路径"。
 *
 * 设计：
 * - 不直接依赖 Electron，保持 src/ 的 Electron 无关性
 * - 由调用方（main 进程）传入 isPackaged 和基础路径
 * - 开发模式：相对 process.cwd() 的 data/ 和 resources/
 * - 打包模式：使用 Electron 的 userData 和 resourcesPath
 * - 路径常量集中管理，避免散落的 app.getPath 调用
 */
import { join } from 'path';
import { createLogger } from '../logging/logger';

const log = createLogger('app-paths');

/** 应用解析后的路径集合 */
export interface AppPaths {
  /** 用户数据目录（数据库、设置、日志） */
  userDataDir: string;
  /** 资源目录（角色包、内置素材） */
  resourcesDir: string;
  /** 数据库文件路径 */
  databasePath: string;
  /** 日志目录 */
  logsDir: string;
  /** 默认角色包目录 */
  characterPacksDir: string;
  /** 备份目录 */
  backupsDir: string;
  /** 是否为打包环境 */
  isPackaged: boolean;
}

/** 路径解析选项 */
export interface AppPathsOptions {
  /** 是否为打包环境（默认 false） */
  isPackaged?: boolean;
  /**
   * 用户数据目录。
   * 打包环境对应 Electron app.getPath('userData')。
   * 开发环境默认为 {appRoot}/data。
   */
  userDataDir?: string;
  /**
   * 资源目录。
   * 打包环境对应 process.resourcesPath。
   * 开发环境默认为 {appRoot}/resources。
   */
  resourcesDir?: string;
  /**
   * 应用根目录（仅开发模式使用）。
   * 默认 process.cwd()。
   */
  appRoot?: string;
  /** 数据库文件名（默认 'pet-data.sqlite'） */
  databaseFileName?: string;
}

/**
 * 解析应用路径。
 *
 * 开发模式：
 *   userDataDir  = {appRoot}/data
 *   resourcesDir = {appRoot}/resources
 *   databasePath = {userDataDir}/pet-data.sqlite
 *   logsDir      = {userDataDir}/logs
 *   characterPacksDir = {resourcesDir}/character-packs
 *   backupsDir   = {userDataDir}/backups
 *
 * 打包模式：
 *   userDataDir  = app.getPath('userData')       （由调用方传入）
 *   resourcesDir = process.resourcesPath          （由调用方传入）
 *   databasePath = {userDataDir}/pet-data.sqlite
 *   logsDir      = {userDataDir}/logs
 *   characterPacksDir = {resourcesDir}/character-packs
 *   backupsDir   = {userDataDir}/backups
 */
export function resolveAppPaths(options: AppPathsOptions = {}): AppPaths {
  const isPackaged = options.isPackaged ?? false;
  const dbFileName = options.databaseFileName ?? 'pet-data.sqlite';

  const userDataDir = options.userDataDir
    ?? (isPackaged
      ? throwMissing('userDataDir', '打包环境必须由调用方传入 app.getPath(\'userData\')')
      : join(options.appRoot ?? process.cwd(), 'data'));

  const resourcesDir = options.resourcesDir
    ?? (isPackaged
      ? throwMissing('resourcesDir', '打包环境必须由调用方传入 process.resourcesPath')
      : join(options.appRoot ?? process.cwd(), 'resources'));

  const paths: AppPaths = {
    userDataDir,
    resourcesDir,
    databasePath: join(userDataDir, dbFileName),
    logsDir: join(userDataDir, 'logs'),
    characterPacksDir: join(resourcesDir, 'character-packs'),
    backupsDir: join(userDataDir, 'backups'),
    isPackaged
  };

  log.info('app paths resolved', {
    fields: {
      isPackaged,
      userDataDir: paths.userDataDir,
      resourcesDir: paths.resourcesDir,
      databasePath: paths.databasePath
    }
  });

  return paths;
}

/** 抛出"缺少必填路径"错误。使控制流返回 string 以满足类型。 */
function throwMissing(field: string, message: string): string {
  throw new Error(`[app-paths] 缺少必填参数 ${field}：${message}`);
}

/** 默认数据库文件名 */
export const DEFAULT_DATABASE_FILE_NAME = 'pet-data.sqlite';
