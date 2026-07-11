/**
 * 模型用量 repository。
 * 对应架构计划第 2 节 ModelGateway"统计调用次数、Token、耗时"。
 */
import { getDatabase } from '../connection';
import type { ModelUsageRecord } from '../../secrets/secret-store';

export interface ModelUsageSummary {
  totalCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  failedCalls: number;
}

function rowToRecord(row: any): ModelUsageRecord {
  return {
    calledAt: row.called_at,
    model: row.model,
    mode: row.mode,
    alias: row.alias,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    durationMs: row.duration_ms,
    success: row.success === 1,
    errorCode: row.error_code ?? undefined,
    traceId: row.trace_id ?? undefined
  };
}

export const modelUsageRepository = {
  insert(record: ModelUsageRecord): void {
    getDatabase().prepare(`
      INSERT INTO model_usage (called_at, model, mode, alias, input_tokens, output_tokens, duration_ms, success, error_code, trace_id)
      VALUES (@calledAt, @model, @mode, @alias, @inputTokens, @outputTokens, @durationMs, @success, @errorCode, @traceId)
    `).run({
      calledAt: record.calledAt,
      model: record.model,
      mode: record.mode,
      alias: record.alias,
      inputTokens: record.inputTokens,
      outputTokens: record.outputTokens,
      durationMs: record.durationMs,
      success: record.success ? 1 : 0,
      errorCode: record.errorCode ?? null,
      traceId: record.traceId ?? null
    });
  },

  getTodaySummary(): ModelUsageSummary {
    const today = new Date().toISOString().slice(0, 10);
    const row = getDatabase().prepare(`
      SELECT
        COUNT(*) as totalCalls,
        COALESCE(SUM(input_tokens), 0) as totalInputTokens,
        COALESCE(SUM(output_tokens), 0) as totalOutputTokens,
        SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failedCalls
      FROM model_usage
      WHERE date(called_at) = date(?)
    `).get(today) as any;
    return {
      totalCalls: row?.totalCalls ?? 0,
      totalInputTokens: row?.totalInputTokens ?? 0,
      totalOutputTokens: row?.totalOutputTokens ?? 0,
      failedCalls: row?.failedCalls ?? 0
    };
  },

  getRange(from: string, to: string): ModelUsageRecord[] {
    return (getDatabase().prepare(`
      SELECT * FROM model_usage WHERE called_at >= ? AND called_at <= ? ORDER BY called_at
    `).all(from, to) as any[]).map(rowToRecord);
  },

  isDailyLimitReached(limit: number): boolean {
    return this.getTodaySummary().totalCalls >= limit;
  }
};
