/**
 * 阶段 1 契约测试。
 * 验证：IPC 校验、AppEvent 校验、日志脱敏。
 * 运行：npx tsx tests/unit/contracts.test.ts
 */
import { validateAppEvent } from '../../src/shared/schemas/app-event';
import { validateIpcInput, isKnownIpcChannel, IPC_CHANNELS } from '../../src/shared/schemas/ipc';
import { createLogger, setLogSink, type LogEntry, type LogSink } from '../../src/infrastructure/logging/logger';
import { MAX_MODEL_CALLS_PER_TURN, MODEL_ALIAS, APP_EVENT_TYPE } from '../../src/shared/constants';

let pass = 0;
let fail = 0;

function check(name: string, condition: boolean) {
  if (condition) {
    pass++;
    console.log(`PASS ${name}`);
  } else {
    fail++;
    console.error(`FAIL ${name}`);
  }
}

// 1. AppEvent 校验
function testAppEventValidation() {
  const validEvent = {
    schemaVersion: 1 as const,
    eventId: 'evt-1',
    type: APP_EVENT_TYPE.CHAT,
    occurredAt: new Date().toISOString(),
    timezone: 'Asia/Shanghai',
    source: 'renderer',
    userId: 'user-1',
    characterId: 'char-1',
    correlationId: 'corr-1',
    priority: 'normal',
    payload: { message: 'hello' }
  };
  const ok = validateAppEvent(validEvent);
  check('AppEvent: valid event passes', ok.valid === true);

  const badType = { ...validEvent, type: 'unknown_type' };
  check('AppEvent: invalid type rejected', validateAppEvent(badType).valid === false);

  const missingUser = { ...validEvent, userId: '' };
  check('AppEvent: empty userId rejected', validateAppEvent(missingUser).valid === false);

  const wrongVersion = { ...validEvent, schemaVersion: 99 };
  check('AppEvent: wrong schemaVersion rejected', validateAppEvent(wrongVersion).valid === false);

  const nullInput = validateAppEvent(null);
  check('AppEvent: null rejected', nullInput.valid === false);

  const undefInput = validateAppEvent(undefined);
  check('AppEvent: undefined rejected', undefInput.valid === false);
}

// 2. IPC 校验
function testIpcValidation() {
  check('IPC: unknown channel rejected', !isKnownIpcChannel('evil:command'));

  const knownCheck = IPC_CHANNELS.length > 0;
  check('IPC: whitelist non-empty', knownCheck);
  check('IPC: material import channel is allowlisted', isKnownIpcChannel('material:import'));
  check(
    'IPC: valid material id passes',
    validateIpcInput('material:apply', 'material-12345678-abcd').valid === true
  );
  check(
    'IPC: invalid material id rejected',
    validateIpcInput('material:apply', '../outside').valid === false
  );

  // chat-send valid
  const chatOk = validateIpcInput('chat-send', {
    message: 'hello',
    history: [{ role: 'user', content: 'hi' }]
  });
  check('IPC: valid chat-send passes', chatOk.valid === true);

  // chat-send empty message
  const chatEmpty = validateIpcInput('chat-send', { message: '' });
  check('IPC: empty chat message rejected', chatEmpty.valid === false);

  // api-config-save non-URL endpoint
  const badEndpoint = validateIpcInput('api-config-save', {
    provider: 'deepseek',
    endpoint: 'not-a-url',
    model: 'deepseek-chat'
  });
  check('IPC: invalid endpoint rejected', badEndpoint.valid === false);

  // set-window-scale out of range
  const badScale = validateIpcInput('set-window-scale', 0.01);
  check('IPC: out-of-range scale rejected', badScale.valid === false);

  // malicious channel
  const evil = validateIpcInput('require:child_process', { __proto__: {} });
  check('IPC: malicious channel rejected', evil.valid === false);
}

// 3. 日志脱敏
function testLoggerRedaction() {
  const captured: LogEntry[] = [];
  const testSink: LogSink = { write: (e) => captured.push(e) };
  setLogSink(testSink);

  const logger = createLogger('test-module');

  // 日志中包含 API Key
  logger.info('api call', {
    fields: {
      endpoint: 'https://api.deepseek.com/v1',
      apiKey: 'sk-abcdef1234567890abcdef',
      authorization: 'Bearer sk-secrettoken1234567890'
    }
  });

  const lastEntry = captured[captured.length - 1];
  const serialized = JSON.stringify(lastEntry.fields);

  check('Logger: apiKey redacted', !serialized.includes('sk-abcdef1234567890abcdef'));
  check('Logger: bearer token redacted', !serialized.includes('sk-secrettoken1234567890'));

  // 密钥字段名
  logger.info('config', {
    fields: { password: 'mySecret123', token: 'tok_abc' }
  });
  const pwEntry = captured[captured.length - 1];
  const pwStr = JSON.stringify(pwEntry.fields);
  check('Logger: password field redacted', !pwStr.includes('mySecret123'));

  // prompt 正文不展开
  logger.info('prompt built', {
    fields: { prompt: 'very long secret prompt with user memories'.repeat(10) }
  });
  const promptEntry = captured[captured.length - 1];
  const promptStr = JSON.stringify(promptEntry.fields);
  check('Logger: prompt content not fully exposed', !promptStr.includes('secret prompt with user memories'));

  // 恢复默认 sink
  setLogSink({ write: () => {} });
}

// 4. 常量
function testConstants() {
  check('Constants: MAX_MODEL_CALLS_PER_TURN = 3', MAX_MODEL_CALLS_PER_TURN === 3);
  check('Constants: model aliases defined', MODEL_ALIAS.FAST === 'fastModel');
}

function main() {
  console.log('--- Stage 1 Contracts Tests ---');
  testAppEventValidation();
  testIpcValidation();
  testLoggerRedaction();
  testConstants();
  console.log('---');
  console.log(`Results: ${pass} passed, ${fail} failed`);
  if (fail > 0) {
    process.exit(1);
  }
  console.log('Stage 1 contracts tests passed.');
}

main();
