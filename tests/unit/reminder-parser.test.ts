/**
 * ReminderParserService 单元测试。
 * 验证：
 *   1. "5分钟后提醒我开会" → content="开会", triggerAt ≈ now+5min
 *   2. "半小时后提醒我喝水" → triggerAt ≈ now+30min
 *   3. "两小时后提醒我休息" → triggerAt ≈ now+120min
 *   4. "明天下午3点提醒我开会" → triggerAt 为明天15:00
 *   5. "提醒我明天开会" → 缺少时间，missingFields 包含"触发时间"
 *   6. "今天好累" → detectCandidate 返回 false
 *   7. 模型不可用时本地 fallback 正常工作
 *
 * 运行：npx tsx tests/unit/reminder-parser.test.ts
 */
import { TimeService } from '../../src/services/TimeService';
import { ReminderParserService } from '../../src/services/ReminderParserService';

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

/** 创建不使用模型的 parser（模拟模型不可用） */
function createOfflineParser(): ReminderParserService {
  const timeService = new TimeService('Asia/Shanghai');
  return new ReminderParserService(timeService, null);
}

/** 测试 "5分钟后提醒我开会" */
async function test5MinutesLater(): Promise<void> {
  const parser = createOfflineParser();
  const result = await parser.parse('5分钟后提醒我开会');

  check('5分钟后: content 为 "开会"', result.draft.content === '开会');
  check('5分钟后: triggerAt 存在', !!result.draft.triggerAt);

  if (result.draft.triggerAt) {
    const triggerMs = new Date(result.draft.triggerAt).getTime();
    const now = Date.now();
    const diffMin = (triggerMs - now) / 60000;
    // 允许 ±1 分钟误差（测试执行时间）
    check('5分钟后: triggerAt 约为 now+5min（4-6分钟范围）', diffMin >= 4 && diffMin <= 6);
  }

  check('5分钟后: confidence >= 0.8', result.confidence >= 0.8);
  check('5分钟后: source 为 local_regex', result.source === 'local_regex');
  check('5分钟后: missingFields 为空', result.missingFields.length === 0);
}

/** 测试 "半小时后提醒我喝水" */
async function testHalfHourLater(): Promise<void> {
  const parser = createOfflineParser();
  const result = await parser.parse('半小时后提醒我喝水');

  check('半小时后: content 为 "喝水"', result.draft.content === '喝水');
  check('半小时后: triggerAt 存在', !!result.draft.triggerAt);

  if (result.draft.triggerAt) {
    const triggerMs = new Date(result.draft.triggerAt).getTime();
    const now = Date.now();
    const diffMin = (triggerMs - now) / 60000;
    // 允许 ±2 分钟误差
    check('半小时后: triggerAt 约为 now+30min（28-32分钟范围）', diffMin >= 28 && diffMin <= 32);
  }

  check('半小时后: missingFields 为空', result.missingFields.length === 0);
}

/** 测试 "两小时后提醒我休息" */
async function testTwoHoursLater(): Promise<void> {
  const parser = createOfflineParser();
  const result = await parser.parse('两小时后提醒我休息');

  check('两小时后: content 为 "休息"', result.draft.content === '休息');
  check('两小时后: triggerAt 存在', !!result.draft.triggerAt);

  if (result.draft.triggerAt) {
    const triggerMs = new Date(result.draft.triggerAt).getTime();
    const now = Date.now();
    const diffMin = (triggerMs - now) / 60000;
    // 两小时 = 120 分钟，允许 ±2 分钟误差
    check('两小时后: triggerAt 约为 now+120min（118-122分钟范围）', diffMin >= 118 && diffMin <= 122);
  }
}

/** 测试 "明天下午3点提醒我开会" */
async function testTomorrowAfternoon3(): Promise<void> {
  const parser = createOfflineParser();
  const timeService = new TimeService('Asia/Shanghai');
  const ctx = timeService.getCurrentTimeContext();
  const result = await parser.parse('明天下午3点提醒我开会');

  check('明天下午3点: content 为 "开会"', result.draft.content === '开会');
  check('明天下午3点: triggerAt 存在', !!result.draft.triggerAt);

  if (result.draft.triggerAt) {
    const triggerDate = new Date(result.draft.triggerAt);
    // 验证是明天
    const now = new Date(ctx.epochMs);
    const dayDiff = Math.round(
      (new Date(triggerDate.getFullYear(), triggerDate.getMonth(), triggerDate.getDate()).getTime()
        - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 86400000
    );
    check('明天下午3点: 日期为明天（dayDiff=1）', dayDiff === 1);

    // 验证小时为 15（下午3点 → 15:00）
    // 使用东八区时间验证
    const localParts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Shanghai',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).formatToParts(triggerDate);
    const hourPart = localParts.find((p) => p.type === 'hour')?.value ?? '';
    const hour = hourPart === '24' ? '00' : hourPart;
    check('明天下午3点: 小时为 15（东八区）', hour === '15');
  }
}

/** 测试 "提醒我明天开会" → 缺少时间 */
async function testMissingTime(): Promise<void> {
  const parser = createOfflineParser();
  const result = await parser.parse('提醒我明天开会');

  check('缺少时间: content 为 "开会"', result.draft.content === '开会');
  check('缺少时间: triggerAt 不存在', !result.draft.triggerAt);
  check('缺少时间: missingFields 包含 "触发时间"', result.missingFields.includes('触发时间'));
  check('缺少时间: confidence < 0.8', result.confidence < 0.8);
}

/** 测试 detectCandidate 对非提醒文本返回 false */
function testDetectCandidateFalse(): void {
  const parser = createOfflineParser();
  check('今天好累: detectCandidate 返回 false', !parser.detectCandidate('今天好累'));
  check('你好: detectCandidate 返回 false', !parser.detectCandidate('你好'));
  check('今天天气不错: detectCandidate 返回 false', !parser.detectCandidate('今天天气不错'));
}

/** 测试 detectCandidate 对提醒文本返回 true */
function testDetectCandidateTrue(): void {
  const parser = createOfflineParser();
  check('提醒我开会: detectCandidate 返回 true', parser.detectCandidate('提醒我开会'));
  check('帮我提醒: detectCandidate 返回 true', parser.detectCandidate('帮我提醒一下'));
  check('设个提醒: detectCandidate 返回 true', parser.detectCandidate('设个提醒'));
  check('定个提醒: detectCandidate 返回 true', parser.detectCandidate('定个提醒'));
}

/** 测试模型不可用时本地 fallback */
async function testOfflineFallback(): Promise<void> {
  const parser = createOfflineParser();
  const result = await parser.parse('10分钟后提醒我测试');

  check('Offline fallback: source 为 local_regex', result.source === 'local_regex');
  check('Offline fallback: content 为 "测试"', result.draft.content === '测试');
  check('Offline fallback: triggerAt 存在', !!result.draft.triggerAt);
  check('Offline fallback: missingFields 为空', result.missingFields.length === 0);

  if (result.draft.triggerAt) {
    const triggerMs = new Date(result.draft.triggerAt).getTime();
    const now = Date.now();
    const diffMin = (triggerMs - now) / 60000;
    check('Offline fallback: triggerAt 约为 now+10min', diffMin >= 8 && diffMin <= 12);
  }
}

/** 测试 "一小时后提醒我吃饭" */
async function testOneHourLater(): Promise<void> {
  const parser = createOfflineParser();
  const result = await parser.parse('一小时后提醒我吃饭');

  check('一小时后: content 为 "吃饭"', result.draft.content === '吃饭');
  check('一小时后: triggerAt 存在', !!result.draft.triggerAt);

  if (result.draft.triggerAt) {
    const triggerMs = new Date(result.draft.triggerAt).getTime();
    const now = Date.now();
    const diffMin = (triggerMs - now) / 60000;
    // 一小时 = 60 分钟
    check('一小时后: triggerAt 约为 now+60min', diffMin >= 58 && diffMin <= 62);
  }
}

/** 测试 checkpoint 恢复场景：第一轮缺时间，第二轮补充 */
async function testCheckpointRecovery(): Promise<void> {
  const parser = createOfflineParser();

  // 第一轮："提醒我开会" → 缺时间
  const result1 = await parser.parse('提醒我开会');
  check('Checkpoint: 第一轮 content 为 "开会"', result1.draft.content === '开会');
  check('Checkpoint: 第一轮缺触发时间', !result1.draft.triggerAt);
  check('Checkpoint: 第一轮 missingFields 包含 "触发时间"', result1.missingFields.includes('触发时间'));

  // 第二轮："明天下午3点" → 补充时间（传 existingDraft）
  const result2 = await parser.parse('明天下午3点', result1.draft);
  check('Checkpoint: 第二轮 content 仍为 "开会"', result2.draft.content === '开会');
  check('Checkpoint: 第二轮 triggerAt 存在', !!result2.draft.triggerAt);
  check('Checkpoint: 第二轮 missingFields 为空', result2.missingFields.length === 0);
}

/** 测试重复规则和优先级 */
async function testRecurrenceAndPriority(): Promise<void> {
  const parser = createOfflineParser();

  // "每天早上9点提醒我打卡"
  const result1 = await parser.parse('每天早上9点提醒我打卡');
  check('每天: isRepeating 为 true', result1.draft.isRepeating === true);
  check('每天: recurrenceRule 包含 daily', result1.draft.recurrenceRule?.includes('daily') === true);

  // "紧急提醒我5分钟后开会"
  const result2 = await parser.parse('紧急提醒我5分钟后开会');
  check('紧急: priority 为 high', result2.draft.priority === 'high');

  // "不急，10分钟后提醒我喝水"
  const result3 = await parser.parse('不急，10分钟后提醒我喝水');
  check('不急: priority 为 low', result3.draft.priority === 'low');
}

/** 测试 "30秒后提醒我测试" */
async function testSecondsLater(): Promise<void> {
  const parser = createOfflineParser();
  const result = await parser.parse('30秒后提醒我测试');

  check('30秒后: content 为 "测试"', result.draft.content === '测试');
  check('30秒后: triggerAt 存在', !!result.draft.triggerAt);

  if (result.draft.triggerAt) {
    const triggerMs = new Date(result.draft.triggerAt).getTime();
    const now = Date.now();
    const diffSec = (triggerMs - now) / 1000;
    check('30秒后: triggerAt 约为 now+30s（25-35秒范围）', diffSec >= 25 && diffSec <= 35);
  }
}

async function main(): Promise<void> {
  console.log('=== ReminderParserService 单元测试 ===\n');

  await test5MinutesLater();
  await testHalfHourLater();
  await testTwoHoursLater();
  await testTomorrowAfternoon3();
  await testMissingTime();
  testDetectCandidateFalse();
  testDetectCandidateTrue();
  await testOfflineFallback();
  await testOneHourLater();
  await testCheckpointRecovery();
  await testRecurrenceAndPriority();
  await testSecondsLater();

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
