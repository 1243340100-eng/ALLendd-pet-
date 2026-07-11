/**
 * ReminderParserService：提醒解析服务。
 *
 * 职责：
 * - 检测用户输入是否包含提醒候选（高召回）
 * - 本地正则解析相对时间（N分钟后、半小时后、N小时后等）和绝对时间
 * - 当本地解析不完整时，调用模型进行结构化提取
 * - 合并 checkpoint 恢复时的已有草稿
 * - 返回置信度、缺失字段和解析假设
 *
 * 原则：
 * - 相对时间基于 TimeService 提供的可信时间上下文计算
 * - 模型提取时必须传入精确的当前时间，避免模型猜测
 * - 本地解析优先，模型作为补充
 */
import type { TimeService, TimeContext } from './TimeService';
import type { ReminderDraft } from '../shared/contracts/graph-state';
import type { ModelGateway } from './ModelGateway';
import { createLogger } from '../infrastructure/logging/logger';

const log = createLogger('ReminderParserService');

export interface ReminderParseResult {
  draft: ReminderDraft;
  /** 解析置信度 0-1 */
  confidence: number;
  /** 解析来源 */
  source: 'local_regex' | 'model' | 'offline_fallback';
  /** 需要追问的缺失字段 */
  missingFields: string[];
  /** 解析假设（供追问参考） */
  assumptions: string[];
}

/** 中文数字映射，用于相对时间解析 */
const CHINESE_NUM_MAP: Record<string, number> = {
  '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5,
  '六': 6, '七': 7, '八': 8, '九': 9, '十': 10
};

/** 将中文数字或阿拉伯数字字符串转为数字 */
function parseCnNumber(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  // 纯阿拉伯数字
  const arabicMatch = trimmed.match(/^(\d+)$/);
  if (arabicMatch) return parseInt(arabicMatch[1], 10);
  // 单个中文数字
  if (CHINESE_NUM_MAP[trimmed] !== undefined) return CHINESE_NUM_MAP[trimmed];
  // "十X" → 10+X, "X十" → X*10, "X十Y" → X*10+Y
  const tenMatch = trimmed.match(/^十(.+)?$/);
  if (tenMatch) {
    const rest = tenMatch[1];
    return rest ? (CHINESE_NUM_MAP[rest] ?? 0) + 10 : 10;
  }
  const tenMidMatch = trimmed.match(/^(.+)十(.+)?$/);
  if (tenMidMatch) {
    const tens = CHINESE_NUM_MAP[tenMidMatch[1]] ?? 0;
    const ones = tenMidMatch[2] ? (CHINESE_NUM_MAP[tenMidMatch[2]] ?? 0) : 0;
    return tens * 10 + ones;
  }
  return null;
}

export class ReminderParserService {
  constructor(
    private timeService: TimeService,
    private modelGateway: ModelGateway | null
  ) {}

  /** 检测是否包含提醒候选（高召回） */
  detectCandidate(text: string): boolean {
    return /提醒|提醒我|帮我.*提醒|设.*提醒|定.*提醒/.test(text);
  }

  /** 主解析入口 */
  async parse(text: string, existingDraft?: ReminderDraft): Promise<ReminderParseResult> {
    const timeContext = this.timeService.getCurrentTimeContext();

    // 先尝试本地正则解析
    const localResult = this.parseLocal(text, timeContext);

    // 如果有 existingDraft（checkpoint 恢复），合并字段
    if (existingDraft) {
      localResult.draft = this.mergeDraft(existingDraft, localResult.draft);
      localResult.missingFields = this.checkMissingFields(localResult.draft);
    }

    // 如果本地解析已完整（有 content 和 triggerAt），直接返回
    if (localResult.draft.content && localResult.draft.triggerAt && localResult.confidence >= 0.8) {
      return localResult;
    }

    // 本地解析不完整，尝试模型提取
    if (this.modelGateway) {
      try {
        const modelResult = await this.parseWithModel(text, timeContext, localResult.draft);
        if (modelResult.confidence > localResult.confidence) {
          // 合并 existingDraft（如果有的话）
          if (existingDraft) {
            modelResult.draft = this.mergeDraft(existingDraft, modelResult.draft);
            modelResult.missingFields = this.checkMissingFields(modelResult.draft);
          }
          return modelResult;
        }
      } catch (error) {
        log.warn('model parsing failed, using local result', {
          fields: { error: (error as Error)?.message }
        });
      }
    }

    return localResult;
  }

  /** 本地正则解析（含相对时间和绝对时间） */
  private parseLocal(text: string, timeContext: TimeContext): ReminderParseResult {
    const draft: ReminderDraft = {};
    const assumptions: string[] = [];
    let triggerAt: string | undefined;

    // 1. 相对时间解析
    triggerAt = this.parseRelativeTime(text, timeContext);

    // 2. 如果相对时间未匹配，尝试绝对时间解析
    if (!triggerAt) {
      triggerAt = this.parseAbsoluteTime(text, timeContext);
    }

    draft.triggerAt = triggerAt;

    // 3. 提取内容：去掉时间相关文本后的剩余内容
    const content = this.extractContent(text);
    draft.content = content || undefined;

    // 4. 提取重复规则
    const repeat = this.parseRecurrence(text);
    if (repeat) {
      draft.isRepeating = true;
      draft.recurrenceRule = repeat;
    }

    // 5. 提取优先级
    draft.priority = this.parsePriority(text);

    // 计算置信度
    let confidence: number;
    if (draft.content && draft.triggerAt) {
      confidence = 0.85;
    } else if (draft.content || draft.triggerAt) {
      confidence = 0.5;
    } else {
      confidence = 0.2;
    }

    const missingFields = this.checkMissingFields(draft);

    return {
      draft,
      confidence,
      source: 'local_regex',
      missingFields,
      assumptions
    };
  }

  /** 解析相对时间表达式 */
  private parseRelativeTime(text: string, timeContext: TimeContext): string | undefined {
    const baseMs = timeContext.epochMs;

    // "半小时后" → 30 分钟
    const halfHourMatch = text.match(/半(?:个)?小时(?:后|之后)?/);
    if (halfHourMatch) {
      return new Date(baseMs + 30 * 60 * 1000).toISOString();
    }

    // "N分钟后" / "N分钟之后"
    const minuteMatch = text.match(/(\d+|[一二两三四五六七八九十]+)分钟(?:后|之后)?/);
    if (minuteMatch) {
      const n = parseCnNumber(minuteMatch[1]);
      if (n !== null && n > 0) {
        return new Date(baseMs + n * 60 * 1000).toISOString();
      }
    }

    // "N小时后" / "N小时之后" / "一小时后"
    const hourMatch = text.match(/(\d+|[一二两三四五六七八九十]+)小时(?:后|之后)?/);
    if (hourMatch) {
      const n = parseCnNumber(hourMatch[1]);
      if (n !== null && n > 0) {
        return new Date(baseMs + n * 60 * 60 * 1000).toISOString();
      }
    }

    // "N秒后" / "N秒之后"
    const secondMatch = text.match(/(\d+|[一二两三四五六七八九十]+)秒(?:后|之后)?/);
    if (secondMatch) {
      const n = parseCnNumber(secondMatch[1]);
      if (n !== null && n > 0) {
        return new Date(baseMs + n * 1000).toISOString();
      }
    }

    return undefined;
  }

  /** 解析绝对时间表达式 */
  private parseAbsoluteTime(text: string, timeContext: TimeContext): string | undefined {
    // 提取小时和分钟
    const timeResult = this.extractTime(text);
    const now = new Date(timeContext.epochMs);

    // "明天"
    if (/明天/.test(text)) {
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      if (timeResult) {
        tomorrow.setHours(timeResult.hour, timeResult.minute, 0, 0);
        return tomorrow.toISOString();
      }
      return undefined;
    }

    // "后天"
    if (/后天/.test(text)) {
      const dayAfter = new Date(now);
      dayAfter.setDate(dayAfter.getDate() + 2);
      if (timeResult) {
        dayAfter.setHours(timeResult.hour, timeResult.minute, 0, 0);
        return dayAfter.toISOString();
      }
      return undefined;
    }

    // "大后天"
    if (/大后天/.test(text)) {
      const dayAfter = new Date(now);
      dayAfter.setDate(dayAfter.getDate() + 3);
      if (timeResult) {
        dayAfter.setHours(timeResult.hour, timeResult.minute, 0, 0);
        return dayAfter.toISOString();
      }
      return undefined;
    }

    // "下周一"
    if (/下周一/.test(text)) {
      const nextMonday = new Date(now);
      const day = nextMonday.getDay();
      const diff = day === 0 ? 1 : 8 - day;
      nextMonday.setDate(nextMonday.getDate() + diff);
      if (timeResult) {
        nextMonday.setHours(timeResult.hour, timeResult.minute, 0, 0);
        return nextMonday.toISOString();
      }
      return undefined;
    }

    // "今天" + 时间
    if (/今天/.test(text) && timeResult) {
      const date = new Date(now);
      date.setHours(timeResult.hour, timeResult.minute, 0, 0);
      // 如果已过去，推到明天
      if (date.getTime() < now.getTime()) {
        date.setDate(date.getDate() + 1);
      }
      return date.toISOString();
    }

    // 只有时间，没有日期 → 默认今天（已过则明天）
    if (timeResult) {
      const date = new Date(now);
      date.setHours(timeResult.hour, timeResult.minute, 0, 0);
      if (date.getTime() < now.getTime()) {
        date.setDate(date.getDate() + 1);
      }
      return date.toISOString();
    }

    // 时间段默认（无具体 HH:mm）
    // "明早" → 明天 9:00
    if (/明早|明天早上/.test(text)) {
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(9, 0, 0, 0);
      return tomorrow.toISOString();
    }

    return undefined;
  }

  /** 从文本中提取小时和分钟，处理下午/晚上加 12 小时 */
  private extractTime(text: string): { hour: number; minute: number } | null {
    const timeMatch = text.match(/(\d{1,2})[点时:：](\d{0,2})/);
    if (!timeMatch) return null;

    let hour = parseInt(timeMatch[1], 10);
    const minute = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;

    // 统一处理下午/晚上：hour < 12 时加 12
    if (/下午|晚上|傍晚|夜间/.test(text) && hour < 12) {
      hour += 12;
    }

    // 处理"上午""早上"等：hour === 12 时不加（中午12点）
    if (/中午/.test(text) && hour < 12) {
      hour += 12;
    }

    return { hour, minute };
  }

  /** 提取提醒内容：去掉时间相关文本后的剩余内容 */
  private extractContent(text: string): string {
    // 去掉"提醒我"等前缀
    const prefixMatch = text.match(/(?:提醒我|帮我.*?(?:提醒|提醒我)|设.*?提醒|定.*?提醒)\s*(.+)/);
    let remainingText = text.trim();
    if (prefixMatch) {
      remainingText = prefixMatch[1].trim();
    }

    // 从剩余文本中移除时间相关部分
    let content = remainingText
      .replace(/(大后天|后天|明天|后天|下周一|今天|明早|明天早上)/g, '')
      .replace(/(上午|下午|晚上|傍晚|夜间|中午|早上)/g, '')
      .replace(/(\d+|[一二两三四五六七八九十]+)分钟(?:后|之后)?/g, '')
      .replace(/半(?:个)?小时(?:后|之后)?/g, '')
      .replace(/(\d+|[一二两三四五六七八九十]+)小时(?:后|之后)?/g, '')
      .replace(/(\d+|[一二两三四五六七八九十]+)秒(?:后|之后)?/g, '')
      .replace(/(\d{1,2})[点时:：](\d{0,2})/g, '')
      .replace(/(每天|每日|每周|每周一)/g, '')
      .replace(/(重复|紧急|重要|不急|低优先级)/g, '')
      .replace(/^[的\s]+/, '')
      .trim();

    return content;
  }

  /** 解析重复规则 */
  private parseRecurrence(text: string): string | undefined {
    if (/每天|每日|每天重复|重复/.test(text)) {
      return JSON.stringify({ frequency: 'daily' });
    }
    if (/每周|每周一/.test(text)) {
      return JSON.stringify({ frequency: 'weekly' });
    }
    return undefined;
  }

  /** 解析优先级 */
  private parsePriority(text: string): 'low' | 'normal' | 'high' {
    if (/紧急|重要/.test(text)) return 'high';
    if (/低优先级|不急/.test(text)) return 'low';
    return 'normal';
  }

  /** 合并已有草稿与新草稿（checkpoint 恢复场景） */
  private mergeDraft(existing: ReminderDraft, supplement: ReminderDraft): ReminderDraft {
    return {
      content: existing.content || supplement.content,
      triggerAt: supplement.triggerAt ?? existing.triggerAt,
      isRepeating: existing.isRepeating ?? supplement.isRepeating,
      recurrenceRule: existing.recurrenceRule ?? supplement.recurrenceRule,
      priority: existing.priority ?? supplement.priority
    };
  }

  /** 模型结构化提取 */
  private async parseWithModel(
    text: string,
    timeContext: TimeContext,
    existingDraft: ReminderDraft
  ): Promise<ReminderParseResult> {
    const systemPrompt = `你是一个提醒解析助手。根据用户输入提取提醒信息。

当前精确时间（可信基准，请基于此计算相对时间）：
- 本地显示时间：${timeContext.localDisplay}
- UTC ISO 时间：${timeContext.utcIso}
- 时区：${timeContext.timezone}（UTC${timeContext.utcOffset}）
- 星期：${timeContext.weekday}

请提取以下字段并返回严格 JSON：
{
  "content": "提醒内容（去掉时间相关文本）",
  "triggerAt": "触发时间 UTC ISO 字符串（基于当前时间计算相对时间）",
  "isRepeating": true/false,
  "recurrenceRule": "重复规则 JSON 字符串，如 {\\"frequency\\":\\"daily\\"}，无则为空字符串",
  "priority": "high/normal/low",
  "confidence": 0-1 的数字,
  "assumptions": ["解析假设说明数组"]
}

规则：
1. 相对时间（如"5分钟后""半小时后""两小时后"）必须基于当前时间计算
2. triggerAt 必须是未来时间
3. 如果无法确定某个字段，省略它或设为 null
4. 只返回 JSON，不要其他文字`;

    const result = await this.modelGateway!.invoke({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text }
      ],
      mode: 'low_cost',
      responseFormat: 'json'
    });

    if (!result.success || !result.parsed || typeof result.parsed !== 'object') {
      log.warn('model returned no valid parsed result', {
        fields: { success: result.success, errorCode: result.errorCode }
      });
      return {
        draft: existingDraft,
        confidence: 0.2,
        source: 'offline_fallback',
        missingFields: this.checkMissingFields(existingDraft),
        assumptions: []
      };
    }

    const parsed = result.parsed as Record<string, unknown>;
    const draft: ReminderDraft = { ...existingDraft };

    if (typeof parsed.content === 'string' && parsed.content) {
      draft.content = parsed.content;
    }
    if (typeof parsed.triggerAt === 'string' && parsed.triggerAt) {
      // 校验 triggerAt 是有效的未来时间
      const triggerDate = new Date(parsed.triggerAt);
      if (!isNaN(triggerDate.getTime()) && triggerDate.getTime() > timeContext.epochMs) {
        draft.triggerAt = triggerDate.toISOString();
      }
    }
    if (typeof parsed.isRepeating === 'boolean') {
      draft.isRepeating = parsed.isRepeating;
    }
    if (typeof parsed.recurrenceRule === 'string' && parsed.recurrenceRule) {
      draft.recurrenceRule = parsed.recurrenceRule;
    }
    if (typeof parsed.priority === 'string' && ['high', 'normal', 'low'].includes(parsed.priority)) {
      draft.priority = parsed.priority as 'high' | 'normal' | 'low';
    }

    const modelConfidence = typeof parsed.confidence === 'number'
      ? Math.max(0, Math.min(1, parsed.confidence))
      : 0.5;

    const assumptions = Array.isArray(parsed.assumptions)
      ? parsed.assumptions.filter((a): a is string => typeof a === 'string')
      : [];

    return {
      draft,
      confidence: modelConfidence,
      source: 'model',
      missingFields: this.checkMissingFields(draft),
      assumptions
    };
  }

  /** 检查缺失字段 */
  checkMissingFields(draft: ReminderDraft): string[] {
    const missing: string[] = [];
    if (!draft.content) missing.push('提醒内容');
    if (!draft.triggerAt) missing.push('触发时间');
    return missing;
  }
}
