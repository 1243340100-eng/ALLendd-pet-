/**
 * UserContextService 和 RuntimePersonaBuilder 测试。
 * 验证：
 *   1. UserContextService.load 从 users 表正确读取 nickname/preferred_name
 *   2. displayName 优先级：preferred_name > nickname > fallbackPersona.userPetName > '用户'
 *   3. RuntimePersonaBuilder.build 正确替换 {{user_display_name}} 占位符
 *   4. RuntimePersonaBuilder.build 不修改原始 persona 对象
 *   5. RuntimePersonaBuilder.build 不覆盖 characterName 等角色身份字段
 *
 * 运行：npx tsx tests/unit/user-context.test.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { initDatabase, closeDatabase, getDatabase } from '../../src/infrastructure/database/connection';
import { settingsRepository } from '../../src/infrastructure/database/repositories/settings-repository';
import { UserContextService } from '../../src/services/UserContextService';
import { RuntimePersonaBuilder } from '../../src/services/RuntimePersonaBuilder';
import type { PersonaConfig } from '../../src/shared/contracts/graph-state';

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

/** 临时数据库文件路径 */
function tempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'petdb-uctx-'));
  return path.join(dir, 'test.sqlite');
}

function cleanupDbFile(dbPath: string): void {
  try {
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    const dir = path.dirname(dbPath);
    if (fs.existsSync(dir)) fs.rmdirSync(dir);
  } catch {
    // 忽略清理失败
  }
}

/** 构造测试用 base persona */
function makeBasePersona(): PersonaConfig {
  return {
    characterId: 'default-roxy',
    characterName: 'Roxy',
    corePrompt: '你是 Roxy，也是{{user_display_name}}身边的小老师。',
    speakingStyle: ['当{{user_display_name}}累了时，温柔引导。'],
    relationshipBoundary: ['不控制{{user_display_name}}。'],
    forbiddenDrift: ['不自称 AI。'],
    commonTone: ['calm', 'gentle'],
    sampleDialogues: [
      { user: '你好', expected: '{{user_display_name}}，你好。' }
    ],
    userPetName: '{{user_display_name}}',
    defaultLanguage: 'zh',
    memoryGuidance: ['记住{{user_display_name}}的长期信息。'],
    reminderGuidance: ['提醒{{user_display_name}}不要透支。']
  };
}

// ===== 测试 1：preferred_name 非空时，displayName = preferred_name =====
function testDisplayNamePrefersPreferredName(): void {
  const dbPath = tempDbPath();
  try {
    initDatabase({ path: dbPath });
    const db = getDatabase();
    db.prepare('INSERT INTO users (id, nickname, preferred_name) VALUES (?, ?, ?)').run(
      'user-1', '小昌', '昌哥'
    );

    const service = new UserContextService();
    const ctx = service.load('user-1');

    check('Load: preferred_name 非空时 displayName = preferred_name', ctx.displayName === '昌哥');
    check('Load: nickname 正确读取', ctx.nickname === '小昌');
    check('Load: preferredName 正确读取', ctx.preferredName === '昌哥');
    check('Load: timezone 默认 Asia/Shanghai', ctx.timezone === 'Asia/Shanghai');
    check('Load: locale 默认 zh-CN', ctx.locale === 'zh-CN');

    closeDatabase();
  } finally {
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 2：只有 nickname 时，displayName = nickname =====
function testDisplayNameFallsBackToNickname(): void {
  const dbPath = tempDbPath();
  try {
    initDatabase({ path: dbPath });
    const db = getDatabase();
    db.prepare('INSERT INTO users (id, nickname, preferred_name) VALUES (?, ?, ?)').run(
      'user-2', '小昌', ''
    );

    const service = new UserContextService();
    const ctx = service.load('user-2');

    check('Load: 无 preferred_name 时 displayName = nickname', ctx.displayName === '小昌');
    check('Load: preferredName 为空字符串', ctx.preferredName === '');

    closeDatabase();
  } finally {
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 3：nickname 和 preferred_name 都为空时，displayName = fallbackPersona.userPetName =====
function testDisplayNameFallsBackToPersonaUserPetName(): void {
  const dbPath = tempDbPath();
  try {
    initDatabase({ path: dbPath });
    const db = getDatabase();
    db.prepare('INSERT INTO users (id, nickname, preferred_name) VALUES (?, ?, ?)').run(
      'user-3', '', ''
    );

    const fallbackPersona: PersonaConfig = {
      ...makeBasePersona(),
      userPetName: '主人'
    };

    const service = new UserContextService();
    const ctx = service.load('user-3', fallbackPersona);

    check('Load: 都为空时 displayName = fallbackPersona.userPetName', ctx.displayName === '主人');

    closeDatabase();
  } finally {
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 4：都为空且无 fallbackPersona 时，displayName = '用户' =====
function testDisplayNameFallsBackToDefault(): void {
  const dbPath = tempDbPath();
  try {
    initDatabase({ path: dbPath });
    const db = getDatabase();
    db.prepare('INSERT INTO users (id, nickname, preferred_name) VALUES (?, ?, ?)').run(
      'user-4', '', ''
    );

    const service = new UserContextService();
    const ctx = service.load('user-4');

    check('Load: 都为空且无 fallback 时 displayName = "用户"', ctx.displayName === '用户');

    closeDatabase();
  } finally {
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 5：app_settings 中有 timezone/locale 时正确读取 =====
function testLoadReadsTimezoneAndLocaleFromSettings(): void {
  const dbPath = tempDbPath();
  try {
    initDatabase({ path: dbPath });
    const db = getDatabase();
    db.prepare('INSERT INTO users (id, nickname, preferred_name) VALUES (?, ?, ?)').run(
      'user-5', '测试', '测试'
    );
    settingsRepository.set('user_timezone', 'America/New_York');
    settingsRepository.set('user_locale', 'en-US');

    const service = new UserContextService();
    const ctx = service.load('user-5');

    check('Load: timezone 从 app_settings 读取', ctx.timezone === 'America/New_York');
    check('Load: locale 从 app_settings 读取', ctx.locale === 'en-US');

    closeDatabase();
  } finally {
    cleanupDbFile(dbPath);
  }
}

// ===== 测试 6：RuntimePersonaBuilder 替换 {{user_display_name}} 占位符 =====
function testRuntimePersonaBuilderReplacesPlaceholder(): void {
  const basePersona = makeBasePersona();
  const userContext = {
    userId: 'user-test',
    nickname: '小昌',
    preferredName: '昌哥',
    displayName: '昌哥',
    timezone: 'Asia/Shanghai',
    locale: 'zh-CN'
  };

  const builder = new RuntimePersonaBuilder();
  const runtime = builder.build(basePersona, userContext);

  check('Build: corePrompt 占位符被替换', !runtime.corePrompt.includes('{{user_display_name}}'));
  check('Build: corePrompt 包含实际名称', runtime.corePrompt.includes('昌哥'));
  check('Build: speakingStyle 占位符被替换', !runtime.speakingStyle[0].includes('{{user_display_name}}'));
  check('Build: speakingStyle 包含实际名称', runtime.speakingStyle[0].includes('昌哥'));
  check('Build: relationshipBoundary 占位符被替换', !runtime.relationshipBoundary[0].includes('{{user_display_name}}'));
  check('Build: memoryGuidance 占位符被替换', !runtime.memoryGuidance![0].includes('{{user_display_name}}'));
  check('Build: reminderGuidance 占位符被替换', !runtime.reminderGuidance![0].includes('{{user_display_name}}'));
  check('Build: sampleDialogues user 占位符被替换', !runtime.sampleDialogues[0].user.includes('{{user_display_name}}'));
  check('Build: sampleDialogues expected 占位符被替换', !runtime.sampleDialogues[0].expected.includes('{{user_display_name}}'));
  check('Build: sampleDialogues expected 包含实际名称', runtime.sampleDialogues[0].expected.includes('昌哥'));
  check('Build: userPetName 被替换为 displayName', runtime.userPetName === '昌哥');
}

// ===== 测试 7：RuntimePersonaBuilder 不修改原始 persona 对象 =====
function testRuntimePersonaBuilderDoesNotMutateOriginal(): void {
  const basePersona = makeBasePersona();
  const originalCorePrompt = basePersona.corePrompt;
  const originalSpeakingStyle = [...basePersona.speakingStyle];
  const originalUserPetName = basePersona.userPetName;
  const originalSampleDialogues = JSON.parse(JSON.stringify(basePersona.sampleDialogues));

  const userContext = {
    userId: 'user-test',
    nickname: '',
    preferredName: '',
    displayName: '用户',
    timezone: 'Asia/Shanghai',
    locale: 'zh-CN'
  };

  const builder = new RuntimePersonaBuilder();
  builder.build(basePersona, userContext);

  check('Build: 原始 corePrompt 未被修改', basePersona.corePrompt === originalCorePrompt);
  check('Build: 原始 speakingStyle 未被修改',
    JSON.stringify(basePersona.speakingStyle) === JSON.stringify(originalSpeakingStyle));
  check('Build: 原始 userPetName 未被修改', basePersona.userPetName === originalUserPetName);
  check('Build: 原始 sampleDialogues 未被修改',
    JSON.stringify(basePersona.sampleDialogues) === JSON.stringify(originalSampleDialogues));
  check('Build: 原始对象仍包含占位符', basePersona.corePrompt.includes('{{user_display_name}}'));
}

// ===== 测试 8：RuntimePersonaBuilder 不覆盖 characterName 等角色身份字段 =====
function testRuntimePersonaBuilderPreservesCharacterIdentity(): void {
  const basePersona = makeBasePersona();
  const userContext = {
    userId: 'user-test',
    nickname: '某某',
    preferredName: '某某',
    displayName: '某某',
    timezone: 'Asia/Shanghai',
    locale: 'zh-CN'
  };

  const builder = new RuntimePersonaBuilder();
  const runtime = builder.build(basePersona, userContext);

  check('Build: characterId 不被覆盖', runtime.characterId === 'default-roxy');
  check('Build: characterName 不被覆盖', runtime.characterName === 'Roxy');
  check('Build: characterId 不包含用户名称', !runtime.characterId.includes('某某'));
  check('Build: characterName 不包含用户名称', !runtime.characterName.includes('某某'));
}

// ===== 主入口 =====
async function main(): Promise<void> {
  console.log('=== UserContext & RuntimePersonaBuilder Tests ===\n');

  console.log('--- 1. displayName 优先 preferred_name ---');
  testDisplayNamePrefersPreferredName();

  console.log('\n--- 2. displayName 回退到 nickname ---');
  testDisplayNameFallsBackToNickname();

  console.log('\n--- 3. displayName 回退到 fallbackPersona.userPetName ---');
  testDisplayNameFallsBackToPersonaUserPetName();

  console.log('\n--- 4. displayName 回退到默认"用户" ---');
  testDisplayNameFallsBackToDefault();

  console.log('\n--- 5. 从 app_settings 读取 timezone/locale ---');
  testLoadReadsTimezoneAndLocaleFromSettings();

  console.log('\n--- 6. RuntimePersonaBuilder 替换占位符 ---');
  testRuntimePersonaBuilderReplacesPlaceholder();

  console.log('\n--- 7. RuntimePersonaBuilder 不修改原始对象 ---');
  testRuntimePersonaBuilderDoesNotMutateOriginal();

  console.log('\n--- 8. RuntimePersonaBuilder 不覆盖角色身份字段 ---');
  testRuntimePersonaBuilderPreservesCharacterIdentity();

  console.log(`\n=== Results: ${pass} passed, ${fail} failed ===`);
  if (fail > 0) {
    console.error('Failed tests:');
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('Test runner crashed:', e);
  process.exit(1);
});
