/**
 * 结构化日志。
 * 对应架构计划第 1 节"日志不包含 API Key、完整 Prompt 或隐私记忆正文"。
 *
 * 安全要求：
 * - 不输出 API Key、Token、密码
 * - 不输出完整 system prompt（可能包含角色核心设定和记忆正文）
 * - 不输出记忆正文，只输出记忆 ID 和数量
 * - 不输出用户完整隐私输入，超出长度截断
 */
import type { ErrorCode } from '../../shared/constants';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  level: LogLevel;
  /** ISO 时间 */
  timestamp: string;
  /** 模块名 */
  module: string;
  /** 简短消息 */
  message: string;
  /** 追踪 ID */
  traceId?: string;
  /** 关联 ID */
  correlationId?: string;
  /** 节点名（Graph 节点） */
  node?: string;
  /** 错误码 */
  code?: ErrorCode;
  /** 结构化字段 */
  fields?: Record<string, unknown>;
}

/** 敏感字段名，值会被脱敏 */
const SENSITIVE_FIELD_NAMES = new Set([
  'apikey', 'api_key', 'key', 'secret', 'token', 'password', 'passwd', 'pwd',
  'authorization', 'credential', 'accesstoken', 'access_token', 'refreshtoken',
  'privatekey', 'private_key'
]);

/** 内容字段名：包含 prompt/记忆正文，整值替换为 [content-redacted] */
const CONTENT_FIELD_NAMES = new Set([
  'prompt', 'systemprompt', 'content', 'memorycontent', 'reply', 'assistantreply'
]);

/** 敏感正则：在任意字符串值中匹配并脱敏 */
const SENSITIVE_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // Bearer token
  { pattern: /Bearer\s+[A-Za-z0-9._\-]{8,}/g, replacement: 'Bearer [redacted]' },
  // DeepSeek / OpenAI style keys
  { pattern: /\bsk-[A-Za-z0-9]{16,}\b/g, replacement: 'sk-[redacted]' },
  // Generic api_key=xxx / token=xxx
  { pattern: /\b(?:api[_-]?key|token|secret|password)\s*[:=]\s*\S+/gi, replacement: '[redacted]' },
  // 长十六进制串（可能是密钥）
  { pattern: /\b[a-f0-9]{32,}\b/gi, replacement: '[hex-redacted]' }
];

/** 字符串值的最大长度，超出截断 */
const MAX_STRING_VALUE_LENGTH = 200;

function redactString(value: string): string {
  let result = value;
  for (const { pattern, replacement } of SENSITIVE_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  if (result.length > MAX_STRING_VALUE_LENGTH) {
    return result.slice(0, MAX_STRING_VALUE_LENGTH) + '...[truncated]';
  }
  return result;
}

function redactValue(value: unknown, key?: string): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    if (key) {
      const lowerKey = key.toLowerCase();
      if (SENSITIVE_FIELD_NAMES.has(lowerKey)) {
        return '[redacted]';
      }
      if (CONTENT_FIELD_NAMES.has(lowerKey)) {
        return '[content-redacted]';
      }
    }
    return redactString(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Error) {
    return redactString(value.message);
  }
  if (Array.isArray(value)) {
    return value.length > 50 ? `[array:${value.length} items]` : value.map((v) => redactValue(v, key));
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const redacted: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      redacted[k] = redactValue(v, k);
    }
    return redacted;
  }
  return value;
}

/** 日志输出目标接口，便于测试注入 */
export interface LogSink {
  write(entry: LogEntry): void;
}

/** 默认控制台 sink */
const consoleSink: LogSink = {
  write(entry: LogEntry) {
    const line = formatEntry(entry);
    switch (entry.level) {
      case 'error':
        console.error(line);
        break;
      case 'warn':
        console.warn(line);
        break;
      case 'info':
        console.info(line);
        break;
      default:
        console.log(line);
    }
  }
};

function formatEntry(entry: LogEntry): string {
  const parts = [
    entry.timestamp,
    entry.level.toUpperCase(),
    `[${entry.module}]`,
    entry.message
  ];
  if (entry.traceId) parts.push(`trace=${entry.traceId}`);
  if (entry.correlationId) parts.push(`corr=${entry.correlationId}`);
  if (entry.node) parts.push(`node=${entry.node}`);
  if (entry.code) parts.push(`code=${entry.code}`);
  let line = parts.join(' ');
  if (entry.fields && Object.keys(entry.fields).length > 0) {
    line += ' ' + JSON.stringify(entry.fields);
  }
  return line;
}

/** 全局 sink，可替换为文件 sink 等 */
let activeSink: LogSink = consoleSink;

export function setLogSink(sink: LogSink): void {
  activeSink = sink;
}

/** 创建模块级 logger */
export function createLogger(module: string) {
  function log(level: LogLevel, message: string, context?: {
    traceId?: string;
    correlationId?: string;
    node?: string;
    code?: ErrorCode;
    fields?: Record<string, unknown>;
  }) {
    // 在创建 LogEntry 前就脱敏，确保任何 sink 都不会接触到原始密钥
    const safeMessage = redactString(message);
    const safeFields = context?.fields
      ? (redactValue(context.fields) as Record<string, unknown>)
      : undefined;
    const entry: LogEntry = {
      level,
      timestamp: new Date().toISOString(),
      module,
      message: safeMessage,
      ...context,
      fields: safeFields
    };
    activeSink.write(entry);
  }

  return {
    debug: (msg: string, ctx?: Parameters<typeof log>[2]) => log('debug', msg, ctx),
    info: (msg: string, ctx?: Parameters<typeof log>[2]) => log('info', msg, ctx),
    warn: (msg: string, ctx?: Parameters<typeof log>[2]) => log('warn', msg, ctx),
    error: (msg: string, ctx?: Parameters<typeof log>[2]) => log('error', msg, ctx)
  };
}

export type Logger = ReturnType<typeof createLogger>;
