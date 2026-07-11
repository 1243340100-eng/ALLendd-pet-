/**
 * 记忆 IPC 集成测试。
 * 验证架构计划第 2.3 节记忆安全 scope 校验：
 *   1. 添加记忆时强制角色隔离
 *   2. 更新记忆时校验 userId + characterId 作用域
 *   3. 删除记忆时校验作用域，跨角色删除被拒绝
 *   4. 列表只返回当前用户+角色的记忆（含全局）
 *   5. 导出只返回当前用户的记忆
 *
 * 运行：npx tsx tests/unit/memory-ipc-integration.test.ts
 */
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

import { initDatabase, closeDatabase, getDatabase } from '../../src/infrastructure/database/connection';
import { memoryRepository } from '../../src/infrastructure/database/repositories/memory-repository';
import { MemoryStore } from '../../src/services/MemoryStore';

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

function tempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'petdb-mem-ipc-'));
  return path.join(dir, 'test.sqlite');
}

function cleanupDbFile(dbPath: string): void {
  try {
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    const dir = path.dirname(dbPath);
    if (fs.existsSync(dir)) fs.rmdirSync(dir);
  } catch { /* ignore */ }
}

async function main(): Promise<void> {
  console.log('=== Memory IPC Integration Tests ===\n');

  const dbPath = tempDbPath();
  try {
    initDatabase({ path: dbPath });
    const store = new MemoryStore();

    const userA = 'user-a';
    const userB = 'user-b';
    const charX = 'char-x';
    const charY = 'char-y';

    // 插入用户记录（满足外键约束）
    const db = getDatabase();
    db.prepare('INSERT INTO users (id, nickname, preferred_name) VALUES (?, ?, ?)').run(userA, '用户A', '用户A');
    db.prepare('INSERT INTO users (id, nickname, preferred_name) VALUES (?, ?, ?)').run(userB, '用户B', '用户B');

    // ===== 测试 1：角色隔离 =====
    console.log('--- Test 1: Character Isolation ---');

    // 全局记忆：character_id 必须为 null
    store.add({
      id: 'mem-global-001',
      userId: userA,
      scope: 'global',
      type: 'preference',
      content: '用户A喜欢蓝色',
      confidence: 0.9
    });

    // 角色记忆：必须包含 characterId
    store.add({
      id: 'mem-charx-001',
      userId: userA,
      characterId: charX,
      scope: 'character',
      type: 'event',
      content: '角色X的记忆',
      confidence: 0.8
    });

    store.add({
      id: 'mem-chary-001',
      userId: userA,
      characterId: charY,
      scope: 'character',
      type: 'event',
      content: '角色Y的记忆',
      confidence: 0.8
    });

    // 用户 B 的记忆
    store.add({
      id: 'mem-userb-001',
      userId: userB,
      characterId: charX,
      scope: 'character',
      type: 'preference',
      content: '用户B的记忆',
      confidence: 0.7
    });

    // 全局记忆 character_id 为 null
    const globalMem = memoryRepository.getById('mem-global-001');
    check('Isolation: global memory has null character_id', globalMem?.character_id === null);
    check('Isolation: global memory scope is global', globalMem?.scope === 'global');

    // ===== 测试 2：列表按角色隔离 =====
    console.log('\n--- Test 2: List Isolation ---');

    // 用户A + 角色X：能看到全局 + 角色X，不能看到角色Y和用户B
    const listAX = store.retrieve(userA, charX);
    check('List: userA+charX sees global memory', listAX.some(m => m.id === 'mem-global-001'));
    check('List: userA+charX sees charX memory', listAX.some(m => m.id === 'mem-charx-001'));
    check('List: userA+charX cannot see charY memory', !listAX.some(m => m.id === 'mem-chary-001'));
    check('List: userA+charX cannot see userB memory', !listAX.some(m => m.id === 'mem-userb-001'));

    // 用户B + 角色X：能看到自己的角色X记忆，不能看到用户A的全局或角色记忆
    const listBX = store.retrieve(userB, charX);
    check('List: userB+charX cannot see userA global memory', !listBX.some(m => m.id === 'mem-global-001'));
    check('List: userB+charX sees own charX memory', listBX.some(m => m.id === 'mem-userb-001'));
    check('List: userB+charX cannot see userA charX memory', !listBX.some(m => m.id === 'mem-charx-001'));

    // ===== 测试 3：更新作用域校验 =====
    console.log('\n--- Test 3: Update Scope Validation ---');

    // 用户A可以更新自己的全局记忆
    store.update('mem-global-001', { content: '用户A喜欢绿色' }, { userId: userA, characterId: charX });
    const updated1 = memoryRepository.getById('mem-global-001');
    check('Update: owner can update global memory', updated1?.content === '用户A喜欢绿色');

    // 用户B不能更新用户A的全局记忆（作用域校验失败）
    let updateDenied = false;
    try {
      store.update('mem-global-001', { content: '篡改' }, { userId: userB, characterId: charX });
    } catch (e) {
      updateDenied = true;
    }
    check('Update: cross-user update rejected', updateDenied);

    // 修改未生效
    const notModified = memoryRepository.getById('mem-global-001');
    check('Update: content unchanged after rejected update', notModified?.content === '用户A喜欢绿色');

    // 用户A+角色Y不能更新角色X的记忆
    let crossCharUpdate = false;
    try {
      store.update('mem-charx-001', { content: '篡改角色X' }, { userId: userA, characterId: charY });
    } catch (e) {
      crossCharUpdate = true;
    }
    check('Update: cross-character update rejected', crossCharUpdate);

    // ===== 测试 4：删除作用域校验 =====
    console.log('\n--- Test 4: Delete Scope Validation ---');

    // 用户B不能删除用户A的记忆
    let deleteDenied = false;
    try {
      store.delete('mem-charx-001', { userId: userB, characterId: charX });
    } catch (e) {
      deleteDenied = true;
    }
    check('Delete: cross-user delete rejected', deleteDenied);

    // 记忆仍然存在
    const stillExists = memoryRepository.getById('mem-charx-001');
    check('Delete: memory still exists after rejected delete', stillExists !== null);
    check('Delete: memory not soft-deleted', stillExists?.deleted_at === null);

    // 用户A可以删除自己的角色记忆
    store.delete('mem-charx-001', { userId: userA, characterId: charX });
    const softDeleted = memoryRepository.getById('mem-charx-001');
    check('Delete: owner can soft-delete own memory', softDeleted?.deleted_at !== null);

    // 用户A+角色Y不能删除角色X的记忆（即使属于同一用户）
    let crossCharDelete = false;
    try {
      store.delete('mem-chary-001', { userId: userA, characterId: charX });
    } catch (e) {
      crossCharDelete = true;
    }
    check('Delete: cross-character delete rejected (same user)', crossCharDelete);

    // 角色Y的记忆仍然存在
    const charyStillExists = memoryRepository.getById('mem-chary-001');
    check('Delete: charY memory not deleted by charX context', charyStillExists?.deleted_at === null);

    // ===== 测试 5：导出 =====
    console.log('\n--- Test 5: Export ---');

    const exported = store.exportAll(userA);
    check('Export: returns userA memories', exported.memories.length >= 2);
    check('Export: all memories belong to userA', exported.memories.every(m => m.user_id === userA));
    check('Export: does not include userB memories', !exported.memories.some(m => m.user_id === userB));

    // ===== 测试 6：分页 =====
    console.log('\n--- Test 6: Pagination ---');

    // 添加多条记忆测试分页
    for (let i = 0; i < 60; i++) {
      store.add({
        id: `mem-page-${i}`,
        userId: userA,
        characterId: charX,
        scope: 'character',
        type: 'event',
        content: `分页测试记忆 ${i}`,
        confidence: 0.5
      });
    }

    const listDefault = store.retrieve(userA, charX);
    check('Pagination: default limit returns up to 20', listDefault.length === 20);

    const listLimited = store.retrieve(userA, charX, { limit: 10 });
    check('Pagination: custom limit works', listLimited.length === 10);

  } finally {
    closeDatabase();
    cleanupDbFile(dbPath);
  }

  console.log('\n=== Summary ===');
  console.log(`PASS: ${pass}, FAIL: ${fail}`);
  if (failures.length > 0) {
    console.log('Failures:');
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Test runner crashed:', error);
  process.exit(1);
});
