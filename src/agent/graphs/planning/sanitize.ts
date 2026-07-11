/**
 * Planning Trace 脱敏工具。
 *
 * 禁止直接将原始 userInput 写入 Trace，必须经过 sanitizePlanningTraceText 处理。
 * 处理项：
 * - API Key（sk-...、Bearer Token、Authorization 头）
 * - 邮箱
 * - Windows 和 Unix 本地绝对路径
 * - credential/password/token/key 等敏感键值
 * - 过长数字和可能的电话号码
 */

/** 匹配 API Key 格式：sk-开头或长度 >= 20 的字母数字混合串 */
const API_KEY_PATTERN = /\bsk-[A-Za-z0-9]{16,}\b/gi;

/** 匹配 Bearer Token */
const BEARER_PATTERN = /Bearer\s+[A-Za-z0-9_\-.~+/=]{16,}/gi;

/** 匹配 Authorization 头 */
const AUTH_HEADER_PATTERN = /Authorization\s*[:=]\s*["']?[A-Za-z0-9_\-.~+/=]{10,}["']?/gi;

/** 匹配邮箱 */
const EMAIL_PATTERN = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

/** 匹配 Windows 绝对路径：C:\Users\... 或 D:\Documents\... */
const WINDOWS_PATH_PATTERN = /[A-Za-z]:[\\/](?:[^\s\\/:"*?<>|]+[\\/])+[^\s\\/:"*?<>|]*/g;

/** 匹配 Unix 绝对路径：/home/user/... 或 /var/log/... */
const UNIX_PATH_PATTERN = /\/(?:home|var|usr|tmp|opt|etc|root|Users|Documents|tmp)[\/][^\s"'<>|{}]{3,}/g;

/** 匹配 credential/password/token/key 等敏感键值对 */
const SENSITIVE_KV_PATTERN = /(?:"?(?:password|passwd|secret|credential|api[_\-]?key|access[_\-]?token|refresh[_\-]?token|private[_\-]?key)"?\s*[:=]\s*["']?)[^"'\s,;}]{4,}/gi;

/** 匹配电话号码：11 位数字或带分隔符的电话格式 */
const PHONE_PATTERN = /\b1[3-9]\d{9}\b/g;

/** 匹配超长数字串（>= 16 位连续数字，可能是卡号或密钥） */
const LONG_NUMBER_PATTERN = /\b\d{16,}\b/g;

/**
 * 对 Planning Trace 中的文本进行脱敏处理。
 * 将敏感信息替换为 [REDACTED] 标记，保留非敏感内容供诊断使用。
 *
 * @param text 原始文本（如 userInput）
 * @param maxLength 最大保留长度（截断前先脱敏）
 * @returns 脱敏后的文本
 */
export function sanitizePlanningTraceText(text: string, maxLength: number = 80): string {
  if (!text || typeof text !== 'string') return '';

  let result = text;

  // 按优先级顺序替换敏感信息
  result = result.replace(API_KEY_PATTERN, '[REDACTED_KEY]');
  result = result.replace(BEARER_PATTERN, '[REDACTED_TOKEN]');
  result = result.replace(AUTH_HEADER_PATTERN, '[REDACTED_AUTH]');
  result = result.replace(SENSITIVE_KV_PATTERN, (match) => {
    // 保留键名，替换值
    const eqIdx = Math.max(match.indexOf(':'), match.indexOf('='));
    if (eqIdx > 0) {
      return match.slice(0, eqIdx + 1) + ' [REDACTED]';
    }
    return '[REDACTED]';
  });
  result = result.replace(EMAIL_PATTERN, '[REDACTED_EMAIL]');
  result = result.replace(WINDOWS_PATH_PATTERN, '[REDACTED_PATH]');
  result = result.replace(UNIX_PATH_PATTERN, '[REDACTED_PATH]');
  result = result.replace(PHONE_PATTERN, '[REDACTED_PHONE]');
  result = result.replace(LONG_NUMBER_PATTERN, '[REDACTED_NUM]');

  // 截断到最大长度
  if (result.length > maxLength) {
    result = result.slice(0, maxLength);
  }

  return result;
}
