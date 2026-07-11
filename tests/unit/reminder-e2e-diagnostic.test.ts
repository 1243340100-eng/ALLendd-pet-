/**
 * 提醒端到端诊断测试。
 * 验证完整链路：创建提醒 → bridge 通知 → scheduleTimer → 定时器触发 → handler 调用。
 *
 * 运行：npx tsx tests/unit/reminder-e2e-diagnostic.test.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { initDatabase, closeDatabase, getDatabase } from '../../src/infrastructure/database/connection';
import { runMigrations } from '../../src/infrastructure/database/migration-runner';
import { reminderRepository } from '../../src/infrastructure/database/repositories/reminder-repository';
import { TimeService } from '../../src/services/TimeService';
import { SchedulerService } from '../../src/services/SchedulerService';
import { setSchedulerInstance, notifyReminderCreated } from '../../src/services/reminder-scheduler-bridge';

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

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  // 1. 初始化数据库
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rem-e2e-'));
  const dbPath = path.join(dir, 'test.sqlite');
  try {
    initDatabase({ path: dbPath });
    const db = getDatabase();
    db.prepare('INSERT INTO users (id, nickname) VALUES (?, ?)').run('user-test', '测试用户');

    console.log('\n=== 测试 1：验证 scheduleTimer 定时器触发 ===');

    // 2. 创建 TimeService 和 SchedulerService
    const timeService = new TimeService('Asia/Shanghai');
    const scheduler = new SchedulerService(timeService);

    // 3. 设置 handler 记录调用
    let handlerCalled = false;
    let handlerEvent: any = null;
    scheduler.onReminderDue(async (event) => {
      console.log(`  [handler] 收到提醒事件: ${event.content}`);
      handlerCalled = true;
      handlerEvent = event;
      return true;
    });

    // 4. 创建提醒：3 秒后触发
    const triggerAt = new Date(Date.now() + 3000).toISOString();
    const reminderId = 'rem-e2e-test-1';
    reminderRepository.insert({
      id: reminderId,
      user_id: 'user-test',
      character_id: 'char-roxy',
      content: '测试提醒',
      trigger_at: triggerAt,
      timezone: 'Asia/Shanghai',
      is_repeating: 0,
      recurrence_rule: '',
      priority: 'normal',
      is_active: 1,
      next_trigger_at: triggerAt
    });

    // 5. 直接调用 scheduleTimer
    const row = reminderRepository.getById(reminderId);
    check('提醒已写入数据库', row !== null);
    check('next_trigger_at 正确', row?.next_trigger_at === triggerAt);

    scheduler.scheduleTimer(row!);
    console.log(`  定时器已设置，triggerAt=${triggerAt}`);
    console.log(`  等待 5 秒...`);

    // 6. 等待 5 秒（3 秒触发 + 2 秒余量）
    await sleep(5000);

    check('handler 被调用', handlerCalled);
    check('handler 收到正确内容', handlerEvent?.content === '测试提醒');
    check('handler 收到正确 reminderId', handlerEvent?.reminderId === reminderId);

    // 检查提醒已被停用（非重复提醒触发后应停用）
    const updatedRow = reminderRepository.getById(reminderId);
    check('提醒触发后已停用', updatedRow?.is_active === 0);

    scheduler.stop();

    console.log('\n=== 测试 2：验证 bridge 自动调度 ===');

    // 7. 注册 scheduler 到 bridge
    setSchedulerInstance(scheduler);

    // 8. 模拟技能创建提醒并调用 notifyReminderCreated
    handlerCalled = false;
    handlerEvent = null;
    const triggerAt2 = new Date(Date.now() + 3000).toISOString();
    const reminderId2 = 'rem-e2e-test-2';
    reminderRepository.insert({
      id: reminderId2,
      user_id: 'user-test',
      character_id: 'char-roxy',
      content: '通过 bridge 创建的提醒',
      trigger_at: triggerAt2,
      timezone: 'Asia/Shanghai',
      is_repeating: 0,
      recurrence_rule: '',
      priority: 'normal',
      is_active: 1,
      next_trigger_at: triggerAt2
    });

    // 9. 调用 bridge（模拟技能行为）
    notifyReminderCreated(reminderId2);
    console.log(`  bridge 已通知，triggerAt=${triggerAt2}`);
    console.log(`  等待 5 秒...`);

    await sleep(5000);

    check('bridge 创建的提醒 handler 被调用', handlerCalled);
    check('bridge 提醒内容正确', handlerEvent?.content === '通过 bridge 创建的提醒');

    scheduler.stop();

    console.log('\n=== 测试 3：验证过期提醒立即触发 ===');

    // 10. 创建一个已过期的提醒
    handlerCalled = false;
    handlerEvent = null;
    const pastTriggerAt = new Date(Date.now() - 5000).toISOString();
    const reminderId3 = 'rem-e2e-test-3';
    reminderRepository.insert({
      id: reminderId3,
      user_id: 'user-test',
      character_id: 'char-roxy',
      content: '已过期的提醒',
      trigger_at: pastTriggerAt,
      timezone: 'Asia/Shanghai',
      is_repeating: 0,
      recurrence_rule: '',
      priority: 'normal',
      is_active: 1,
      next_trigger_at: pastTriggerAt
    });

    const row3 = reminderRepository.getById(reminderId3);
    scheduler.scheduleTimer(row3!);

    // 过期提醒应立即触发，等 1 秒即可
    await sleep(1000);

    check('过期提醒立即触发', handlerCalled);
    check('过期提醒内容正确', handlerEvent?.content === '已过期的提醒');

    scheduler.stop();

    console.log('\n=== 测试 4：验证 scheduler.start 加载所有活跃提醒 ===');

    // 11. 创建多个活跃提醒，然后 start
    handlerCalled = false;
    const triggerAt4 = new Date(Date.now() + 2000).toISOString();
    const reminderId4 = 'rem-e2e-test-4';
    reminderRepository.insert({
      id: reminderId4,
      user_id: 'user-test',
      character_id: 'char-roxy',
      content: 'start 加载的提醒',
      trigger_at: triggerAt4,
      timezone: 'Asia/Shanghai',
      is_repeating: 0,
      recurrence_rule: '',
      priority: 'normal',
      is_active: 1,
      next_trigger_at: triggerAt4
    });

    // 12. start 应该加载所有活跃提醒并设置定时器
    scheduler.start();
    console.log(`  scheduler.start 已调用，等待 4 秒...`);

    await sleep(4000);

    check('start 加载的提醒被触发', handlerCalled);

    scheduler.stop();

    console.log('\n=== 测试 5：验证 ReminderParserService 相对时间解析 ===');

    // 13. 验证 "1分钟后" 能正确解析
    const { ReminderParserService } = require('../../src/services/ReminderParserService');
    const parser = new ReminderParserService(timeService, null);
    const parseResult = await parser.parse('提醒我1分钟后喝水');

    check('解析出 content', parseResult.draft.content === '喝水');
    check('解析出 triggerAt', !!parseResult.draft.triggerAt);

    // 验证 triggerAt 约为 1 分钟后
    const triggerMs = new Date(parseResult.draft.triggerAt!).getTime();
    const expectedMs = Date.now() + 60000;
    const diff = Math.abs(triggerMs - expectedMs);
    check('triggerAt 约为 1 分钟后（误差 < 5 秒）', diff < 5000);

    console.log('\n=== 测试 6：验证 timeService.resolve 不拒绝未来时间 ===');

    // 14. 验证 resolve 接受未来时间
    const futureIso = new Date(Date.now() + 60000).toISOString();
    try {
      const resolved = timeService.resolve({
        raw: futureIso,
        candidateUtc: futureIso,
        timezone: 'Asia/Shanghai'
      });
      check('resolve 接受未来时间', !!resolved.utc);
      check('resolve 返回正确 UTC', resolved.utc === futureIso);
    } catch (e) {
      check('resolve 接受未来时间', false);
      console.error(`  resolve 抛出: ${(e as Error).message}`);
    }

    closeDatabase();
  } finally {
    try {
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
      if (fs.existsSync(dir)) fs.rmdirSync(dir);
    } catch { /* ignore */ }
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`结果: ${pass} PASS / ${fail} FAIL`);
  if (failures.length > 0) {
    console.log('失败项:');
    failures.forEach((f) => console.log(`  - ${f}`));
  }
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Test crashed:', err);
  process.exit(1);
});
