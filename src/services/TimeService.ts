/**
 * TimeService：时间处理服务。
 * 对应架构计划第 2.1 节。
 *
 * 职责：
 * - 获取当前时间和用户时区
 * - 内部时间统一转换为 UTC
 * - 显示时间转换为本地时区
 * - 校验自然语言解析产生的时间
 * - 检测过去时间、无效时间和歧义时间
 *
 * 原则：数据库一律保存 UTC，同时保存创建时使用的时区。
 */
import { createLogger } from '../infrastructure/logging/logger';
import { TimeInvalidError } from '../shared/contracts/errors';

const log = createLogger('TimeService');

export interface ParsedTimeCandidate {
  /** ISO 字符串或可解析的时间表达式 */
  raw: string;
  /** 候选时间（UTC ISO），由模型或自然语言解析器填充 */
  candidateUtc?: string;
  timezone?: string;
}

export interface ResolvedTime {
  utc: string;
  timezone: string;
  /** 是否为过去时间 */
  isPast: boolean;
  /** 本地显示时间 */
  localDisplay: string;
}

/** 统一可信时间上下文，供模型和解析器使用 */
export interface TimeContext {
  /** UTC ISO 时间，精确到秒 */
  utcIso: string;
  /** 本地 ISO 时间，精确到秒 */
  localIso: string;
  /** 本地显示时间（如 2026-07-11 16:09:03） */
  localDisplay: string;
  /** 时区（如 Asia/Shanghai） */
  timezone: string;
  /** UTC 偏移（如 +08:00） */
  utcOffset: string;
  /** 毫秒时间戳 */
  epochMs: number;
  /** 星期几（中文，如 星期五） */
  weekday: string;
}

export class TimeService {
  private timezone: string;

  constructor(timezone?: string) {
    this.timezone = timezone ?? this.detectTimezone();
  }

  /** 设置用户时区 */
  setTimezone(tz: string): void {
    this.timezone = tz;
  }

  /** 获取当前 UTC 时间 ISO */
  nowUtc(): string {
    return new Date().toISOString();
  }

  /** 检测系统时区 */
  private detectTimezone(): string {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
      return 'UTC';
    }
  }

  /** 获取当天开始时间（UTC） */
  getDayStartUtc(date?: Date): string {
    const d = date ?? new Date();
    const start = new Date(d);
    start.setHours(0, 0, 0, 0);
    return start.toISOString();
  }

  /** 获取当天结束时间（UTC） */
  getDayEndUtc(date?: Date): string {
    const d = date ?? new Date();
    const end = new Date(d);
    end.setHours(23, 59, 59, 999);
    return end.toISOString();
  }

  /**
   * 校验时间候选，返回安全的 ResolvedTime。
   * 过去时间视为无效（除非 allowPast=true）。
   */
  resolve(candidate: ParsedTimeCandidate, options?: { allowPast?: boolean }): ResolvedTime {
    const tz = candidate.timezone ?? this.timezone;
    if (!candidate.candidateUtc) {
      throw new TimeInvalidError(candidate.raw, 'No candidate time provided');
    }

    const date = new Date(candidate.candidateUtc);
    if (isNaN(date.getTime())) {
      throw new TimeInvalidError(candidate.raw, 'Invalid date format');
    }

    const utc = date.toISOString();
    const now = new Date();
    const isPast = date.getTime() < now.getTime();

    if (isPast && !options?.allowPast) {
      throw new TimeInvalidError(candidate.raw, 'Time is in the past');
    }

    const localDisplay = this.toLocalDisplay(utc, tz);

    log.debug('time resolved', {
      fields: { raw: candidate.raw, utc, tz, isPast }
    });

    return { utc, timezone: tz, isPast, localDisplay };
  }

  /** 将 UTC ISO 转为本地显示字符串（分钟级） */
  toLocalDisplay(utcIso: string, timezone?: string): string {
    try {
      return new Intl.DateTimeFormat('zh-CN', {
        timeZone: timezone ?? this.timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      }).format(new Date(utcIso));
    } catch {
      return utcIso;
    }
  }

  /** 将 UTC ISO 转为本地显示字符串（秒级） */
  toLocalDisplaySeconds(utcIso: string, timezone?: string): string {
    try {
      return new Intl.DateTimeFormat('zh-CN', {
        timeZone: timezone ?? this.timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      }).format(new Date(utcIso));
    } catch {
      return utcIso;
    }
  }

  /** 将 UTC ISO 转为本地秒级显示，格式 YYYY-MM-DD HH:mm:ss */
  formatToLocalSeconds(utcIso: string): string {
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: this.timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      }).formatToParts(new Date(utcIso));
      const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
      const hour = get('hour') === '24' ? '00' : get('hour');
      return `${get('year')}-${get('month')}-${get('day')} ${hour}:${get('minute')}:${get('second')}`;
    } catch {
      return utcIso;
    }
  }

  /**
   * 获取当前统一可信时间上下文。
   * 供模型和提醒解析器使用，确保时间基准一致。
   */
  getCurrentTimeContext(): TimeContext {
    const date = new Date();
    const tz = this.timezone;
    const epochMs = date.getTime();
    const utcIso = date.toISOString();

    // 使用 Intl 获取目标时区下的本地时间各部分
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).formatToParts(date);

    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
    const year = get('year');
    const month = get('month');
    const day = get('day');
    const rawHour = get('hour');
    const hour = rawHour === '24' ? '00' : rawHour;
    const minute = get('minute');
    const second = get('second');

    const localDisplay = `${year}-${month}-${day} ${hour}:${minute}:${second}`;
    const localIso = `${year}-${month}-${day}T${hour}:${minute}:${second}`;

    // 计算 UTC 偏移：将本地时间视为 UTC 构造时间戳，与原始 epochMs 的差即为偏移
    const localAsUtcMs = Date.UTC(
      parseInt(year, 10),
      parseInt(month, 10) - 1,
      parseInt(day, 10),
      parseInt(hour, 10),
      parseInt(minute, 10),
      parseInt(second, 10)
    );
    const offsetMs = localAsUtcMs - epochMs;
    const offsetMin = Math.round(offsetMs / 60000);
    const sign = offsetMin >= 0 ? '+' : '-';
    const absMin = Math.abs(offsetMin);
    const offsetHours = Math.floor(absMin / 60);
    const offsetMins = absMin % 60;
    const utcOffset = `${sign}${String(offsetHours).padStart(2, '0')}:${String(offsetMins).padStart(2, '0')}`;

    // 星期几（中文）
    let weekday: string;
    try {
      weekday = new Intl.DateTimeFormat('zh-CN', {
        timeZone: tz,
        weekday: 'long'
      }).format(date);
    } catch {
      weekday = '';
    }

    return {
      utcIso,
      localIso,
      localDisplay,
      timezone: tz,
      utcOffset,
      epochMs,
      weekday
    };
  }

  /** 判断是否处于勿扰时间 */
  isInDnd(now: Date, dndStart: string, dndEnd: string): boolean {
    const hours = now.getHours();
    const start = parseInt(dndStart.split(':')[0], 10);
    const end = parseInt(dndEnd.split(':')[0], 10);
    if (start <= end) {
      return hours >= start && hours < end;
    }
    // 跨午夜：如 22:00-08:00
    return hours >= start || hours < end;
  }

  /** 判断两个日期是否同一天 */
  isSameDay(a: Date, b: Date): boolean {
    return a.getFullYear() === b.getFullYear()
      && a.getMonth() === b.getMonth()
      && a.getDate() === b.getDate();
  }

  /** 获取今日日期字符串 YYYY-MM-DD（按本地时区计算，避免 UTC 偏移导致日期错误） */
  getTodayDateString(): string {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: this.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(new Date()).replace(/\//g, '-');
  }
}
