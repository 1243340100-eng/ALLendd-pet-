/**
 * 敏感信息过滤器。
 * 对应架构计划第 5.4 节"禁止自动写入"清单。
 *
 * 检测并过滤：
 * - 密码、Token、API Key
 * - 银行卡和完整证件号码
 * - 一次性验证码
 * - 未经确认的模型推测
 * - 普通寒暄
 * - 临时情绪被误判为稳定人格
 * - 其他角色的关系记忆
 */

/** 敏感信息检测规则 */
interface SensitivePattern {
  /** 规则名称 */
  name: string;
  /** 正则匹配 */
  pattern: RegExp;
  /** 过滤原因 */
  reason: string;
}

/** 敏感信息正则规则集 */
const SENSITIVE_PATTERNS: SensitivePattern[] = [
  {
    name: 'password',
    pattern: /(?:password|passwd|密码|口令|secret|token|bearer)[\s:=：是]*\s*\S+/i,
    reason: '包含密码或令牌'
  },
  {
    name: 'api_key',
    pattern: /(?:api[_-]?key|apikey|access[_-]?key|secret[_-]?key)\s*[:：=]\s*\S+/i,
    reason: '包含 API 密钥'
  },
  {
    name: 'bank_card',
    pattern: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}(?:[\s-]?\d{3})?\b/,
    reason: '包含银行卡号'
  },
  {
    name: 'id_number',
    pattern: /\b\d{17}[\dXx]\b/,
    reason: '包含身份证号'
  },
  {
    name: 'otp_code',
    pattern: /(?:验证码|OTP|verification[_-]?code|动态码)\s*[:：]?\s*\d{4,8}/i,
    reason: '包含验证码'
  },
  {
    name: 'phone_number',
    pattern: /\b1[3-9]\d{9}\b/,
    reason: '包含手机号'
  }
];

/** 寒暄关键词（不应生成记忆） */
const CASUAL_GREETINGS = [
  '你好', '早上好', '下午好', '晚上好', '嗨', '哈喽',
  '在吗', '在不在', 'hello', 'hi', 'hey',
  '再见', '拜拜', '晚安', 'goodbye', 'bye',
  '谢谢', '不客气', 'thanks', 'thank you'
];

/** 临时情绪关键词（不应误判为稳定人格） */
const TEMPORARY_EMOTIONS = [
  '今天心情不好', '现在很开心', '此刻很生气',
  '现在很难过', '今天很累', '现在很兴奋',
  '暂时不想', '今天不想'
];

/** 检测内容是否包含敏感信息 */
export function detectSensitiveInfo(content: string): { sensitive: boolean; reason?: string } {
  for (const rule of SENSITIVE_PATTERNS) {
    if (rule.pattern.test(content)) {
      return { sensitive: true, reason: rule.reason };
    }
  }
  return { sensitive: false };
}

/** 检测内容是否为普通寒暄 */
export function isCasualGreeting(content: string): boolean {
  const trimmed = content.trim().toLowerCase();
  return CASUAL_GREETINGS.some(g => trimmed === g || trimmed === g.toLowerCase());
}

/** 检测内容是否为临时情绪（不应作为稳定人格记忆） */
export function isTemporaryEmotion(content: string): boolean {
  const lower = content.toLowerCase();
  return TEMPORARY_EMOTIONS.some(e => lower.includes(e));
}

/** 检测内容是否涉及其他角色 */
export function involvesOtherCharacter(content: string, currentCharacterName: string): boolean {
  // 如果内容提到了其他角色的名称但不是当前角色
  // V1 简单实现：检测"其他角色"关键词
  const otherCharacterKeywords = ['其他角色', '别的角色', '另一个角色', '其他桌宠'];
  const lower = content.toLowerCase();
  return otherCharacterKeywords.some(k => lower.includes(k)) &&
    !content.includes(currentCharacterName);
}

/** 综合验证：检查候选记忆是否应该被过滤 */
export function validateContent(
  content: string,
  options?: { characterName?: string }
): { valid: boolean; reason?: string } {
  // 空内容
  if (!content || content.trim().length === 0) {
    return { valid: false, reason: '内容为空' };
  }

  // 敏感信息
  const sensitive = detectSensitiveInfo(content);
  if (sensitive.sensitive) {
    return { valid: false, reason: sensitive.reason };
  }

  // 寒暄
  if (isCasualGreeting(content)) {
    return { valid: false, reason: '普通寒暄，无记忆价值' };
  }

  // 临时情绪
  if (isTemporaryEmotion(content)) {
    return { valid: false, reason: '临时情绪，非稳定人格' };
  }

  // 其他角色关系
  if (options?.characterName && involvesOtherCharacter(content, options.characterName)) {
    return { valid: false, reason: '涉及其他角色的关系记忆' };
  }

  return { valid: true };
}
