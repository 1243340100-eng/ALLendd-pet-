/**
 * 密钥存储接口。
 * 对应架构计划第 1 节"建立配置加载及密钥存储接口"。
 *
 * 安全要求：
 * - API Key 不以明文存储（使用 Electron safeStorage 或等价加密）
 * - 不回退到 Base64
 * - 不可用时返回空字符串而非明文
 * - 日志中不可出现密钥
 */
import type { ModelAliasMap } from '../config/config-loader';
import type { ModelMode, ModelAlias } from '../../shared/constants';

/** API 配置（含密钥，仅主进程内部使用，不传给 Renderer） */
export interface ApiSecretConfig {
  provider: string;
  endpoint: string;
  model: string;
  apiKey: string;
}

/** 密钥存储接口 */
export interface SecretStore {
  /** 读取 API 配置（含解密后的密钥） */
  read(): ApiSecretConfig | null;
  /** 保存 API 配置（加密密钥） */
  write(config: ApiSecretConfig): void;
  /** 清除密钥 */
  clear(): void;
  /** 当前是否可用加密（safeStorage.isEncryptionAvailable） */
  isEncrypted(): boolean;
}

/**
 * 模型用量记录接口。ModelGateway 调用后写入。
 * 对应架构计划第 2 节"统计调用次数、Token、耗时"。
 */
export interface ModelUsageRecord {
  /** 调用时间 ISO */
  calledAt: string;
  /** 模型名 */
  model: string;
  /** 模式 */
  mode: ModelMode;
  /** 别名 */
  alias: ModelAlias;
  /** 输入 token */
  inputTokens: number;
  /** 输出 token */
  outputTokens: number;
  /** 耗时毫秒 */
  durationMs: number;
  /** 是否成功 */
  success: boolean;
  /** 错误码 */
  errorCode?: string;
  /** 关联的 traceId */
  traceId?: string;
}

/** 模型用量存储接口 */
export interface ModelUsageStore {
  /** 记录一次调用 */
  record(record: ModelUsageRecord): void;
  /** 查询今日用量统计 */
  getTodaySummary(): {
    totalCalls: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    failedCalls: number;
  };
  /** 查询指定时间范围用量 */
  getRange(from: string, to: string): ModelUsageRecord[];
  /** 检查是否超过每日上限 */
  isDailyLimitReached(): boolean;
}

/** 简单的内存用量存储实现，用于测试和过渡 */
export class InMemoryModelUsageStore implements ModelUsageStore {
  private records: ModelUsageRecord[] = [];
  private dailyLimit = 500;

  constructor(dailyLimit?: number) {
    if (dailyLimit !== undefined) this.dailyLimit = dailyLimit;
  }

  record(record: ModelUsageRecord): void {
    this.records.push(record);
  }

  getTodaySummary() {
    const today = new Date().toISOString().slice(0, 10);
    const todayRecords = this.records.filter((r) => r.calledAt.startsWith(today));
    return {
      totalCalls: todayRecords.length,
      totalInputTokens: todayRecords.reduce((sum, r) => sum + r.inputTokens, 0),
      totalOutputTokens: todayRecords.reduce((sum, r) => sum + r.outputTokens, 0),
      failedCalls: todayRecords.filter((r) => !r.success).length
    };
  }

  getRange(from: string, to: string): ModelUsageRecord[] {
    return this.records.filter((r) => r.calledAt >= from && r.calledAt <= to);
  }

  isDailyLimitReached(): boolean {
    return this.getTodaySummary().totalCalls >= this.dailyLimit;
  }
}
