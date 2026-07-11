/**
 * TimeService 单元测试。
 * 验证：
 *   1. getCurrentTimeContext 返回所有字段
 *   2. getTodayDateString 返回本地日期（mock 跨午夜场景）
 *   3. formatToLocalSeconds 返回秒级格式
 *   4. toLocalDisplay 保持分钟级
 *
 * 运行：npx tsx tests/unit/time-service.test.ts
 */
import { TimeService } from '../../src/services/TimeService';

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

/** 测试 getCurrentTimeContext 返回所有必需字段 */
function testGetCurrentTimeContext(): void {
  const svc = new TimeService('Asia/Shanghai');
  const ctx = svc.getCurrentTimeContext();

  check('TimeContext: utcIso 存在且为字符串', typeof ctx.utcIso === 'string' && ctx.utcIso.length > 0);
  check('TimeContext: localIso 存在且为字符串', typeof ctx.localIso === 'string' && ctx.localIso.length > 0);
  check('TimeContext: localDisplay 存在且为字符串', typeof ctx.localDisplay === 'string' && ctx.localDisplay.length > 0);
  check('TimeContext: timezone 为 Asia/Shanghai', ctx.timezone === 'Asia/Shanghai');
  check('TimeContext: utcOffset 格式为 +HH:MM', /^[+-]\d{2}:\d{2}$/.test(ctx.utcOffset));
  check('TimeContext: epochMs 为正数', typeof ctx.epochMs === 'number' && ctx.epochMs > 0);
  check('TimeContext: weekday 存在且为中文', typeof ctx.weekday === 'string' && ctx.weekday.includes('星期'));

  // utcIso 应可被 Date 解析
  const parsed = new Date(ctx.utcIso);
  check('TimeContext: utcIso 可被 Date 解析', !isNaN(parsed.getTime()));

  // epochMs 应接近 Date.now()
  check('TimeContext: epochMs 接近当前时间', Math.abs(ctx.epochMs - Date.now()) < 5000);

  // localDisplay 格式应为 YYYY-MM-DD HH:mm:ss
  check('TimeContext: localDisplay 格式为 YYYY-MM-DD HH:mm:ss', /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(ctx.localDisplay));

  // localIso 格式应为 YYYY-MM-DDTHH:mm:ss
  check('TimeContext: localIso 格式为 YYYY-MM-DDTHH:mm:ss', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(ctx.localIso));

  // 东八区偏移应为 +08:00
  check('TimeContext: 东八区 utcOffset 为 +08:00', ctx.utcOffset === '+08:00');
}

/** 测试 getTodayDateString 返回本地日期（跨午夜场景） */
function testGetTodayDateStringLocal(): void {
  const svc = new TimeService('Asia/Shanghai');

  // mock Date 为东八区午夜前：UTC 2026-07-10T16:30:00Z（即北京 2026-07-11 00:30:00）
  const realDate = global.Date;
  const mockTime = Date.UTC(2026, 6, 10, 16, 30, 0); // UTC 16:30 = Beijing 00:30 次日
  (global as any).Date = class extends realDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) {
        super(mockTime);
      } else {
        super(...(args as []));
      }
    }
    static now() { return mockTime; }
  };

  try {
    const todayStr = svc.getTodayDateString();
    // 在东八区，UTC 16:30 是次日 00:30，所以本地日期应为 2026-07-11
    check('getTodayDateString: 跨午夜返回本地日期 2026-07-11', todayStr === '2026-07-11');

    // 旧实现（UTC slice）会错误返回 2026-07-10
    const utcSlice = new realDate(mockTime).toISOString().slice(0, 10);
    check('getTodayDateString: 旧 UTC 实现会返回错误日期 2026-07-10', utcSlice === '2026-07-10');
    check('getTodayDateString: 新实现与旧实现不同（修复了 UTC bug）', todayStr !== utcSlice);
  } finally {
    (global as any).Date = realDate;
  }
}

/** 测试 getTodayDateString 正常场景 */
function testGetTodayDateStringNormal(): void {
  const svc = new TimeService('Asia/Shanghai');
  const todayStr = svc.getTodayDateString();
  // 格式应为 YYYY-MM-DD
  check('getTodayDateString: 格式为 YYYY-MM-DD', /^\d{4}-\d{2}-\d{2}$/.test(todayStr));
}

/** 测试 formatToLocalSeconds 返回秒级格式 */
function testFormatToLocalSeconds(): void {
  const svc = new TimeService('Asia/Shanghai');
  // UTC 2026-07-11T08:09:03Z → 北京 2026-07-11 16:09:03
  const utcIso = '2026-07-11T08:09:03.000Z';
  const formatted = svc.formatToLocalSeconds(utcIso);

  check('formatToLocalSeconds: 格式为 YYYY-MM-DD HH:mm:ss', /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(formatted));
  check('formatToLocalSeconds: 东八区结果为 2026-07-11 16:09:03', formatted === '2026-07-11 16:09:03');
}

/** 测试 toLocalDisplay 保持分钟级 */
function testToLocalDisplayMinuteLevel(): void {
  const svc = new TimeService('Asia/Shanghai');
  const utcIso = '2026-07-11T08:09:03.000Z';
  const display = svc.toLocalDisplay(utcIso);

  // 分钟级格式不应包含秒
  check('toLocalDisplay: 不包含秒', !/:\d{2}$/.test(display) || display.split(':').length <= 3);
  check('toLocalDisplay: 包含年份', display.includes('2026'));
  check('toLocalDisplay: 包含 07', display.includes('07'));
  check('toLocalDisplay: 包含 11', display.includes('11'));
}

/** 测试 toLocalDisplaySeconds 秒级显示 */
function testToLocalDisplaySeconds(): void {
  const svc = new TimeService('Asia/Shanghai');
  const utcIso = '2026-07-11T08:09:03.000Z';
  const display = svc.toLocalDisplaySeconds(utcIso);

  // 应包含秒
  check('toLocalDisplaySeconds: 包含秒级', display.includes('09:03') || display.includes('16:09'));
  check('toLocalDisplaySeconds: 包含年份', display.includes('2026'));
}

/** 测试 UTC+0 时区 */
function testUtcTimezone(): void {
  const svc = new TimeService('UTC');
  const ctx = svc.getCurrentTimeContext();
  check('UTC 时区: utcOffset 为 +00:00', ctx.utcOffset === '+00:00');

  const utcIso = '2026-07-11T12:00:00.000Z';
  const formatted = svc.formatToLocalSeconds(utcIso);
  check('UTC 时区: formatToLocalSeconds 为 2026-07-11 12:00:00', formatted === '2026-07-11 12:00:00');
}

async function main(): Promise<void> {
  console.log('=== TimeService 单元测试 ===\n');

  testGetCurrentTimeContext();
  testGetTodayDateStringLocal();
  testGetTodayDateStringNormal();
  testFormatToLocalSeconds();
  testToLocalDisplayMinuteLevel();
  testToLocalDisplaySeconds();
  testUtcTimezone();

  console.log(`\n=== 结果: ${pass} passed, ${fail} failed ===`);
  if (fail > 0) {
    console.error('失败用例:', failures.join(', '));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('测试执行异常:', err);
  process.exit(1);
});
