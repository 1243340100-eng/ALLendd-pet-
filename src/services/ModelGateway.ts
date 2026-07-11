/**
 * ModelGateway：统一封装 DeepSeek API。
 * 对应架构计划第 2 节和第 3 节。
 *
 * 职责：
 * - 统一封装 DeepSeek API
 * - 管理 API Key（通过 SecretStore）
 * - 支持模型别名和质量模式
 * - 处理超时、重试、限流、Token 统计和错误归一化
 * - 强制单轮调用次数上限（maxModelCallsPerTurn = 3）
 * - 执行自动模型路由
 * - 提供结构化输出校验
 * - 实现同一 Provider 内的降级
 *
 * 禁止：Graph 节点不得直接实例化 DeepSeek 客户端。
 */
import type { Database as DatabaseType } from 'better-sqlite3';
import {
  MAX_MODEL_CALLS_PER_TURN,
  MODEL_ALIAS
} from '../shared/constants';
import type { ModelAlias, ModelMode, ErrorCode } from '../shared/constants';
import type { AppConfig } from '../infrastructure/config/config-loader';
import { pickModelAlias, resolveModelName } from '../infrastructure/config/config-loader';
import type { SecretStore, ModelUsageRecord } from '../infrastructure/secrets/secret-store';
import { modelUsageRepository } from '../infrastructure/database/repositories/model-usage-repository';
import { ModelCallLimitExceededError, GraphError } from '../shared/contracts/errors';
import { createLogger } from '../infrastructure/logging/logger';
import { z } from 'zod';

const log = createLogger('ModelGateway');

/** 模型调用请求 */
export interface ModelRequest {
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  /** 质量模式 */
  mode: ModelMode;
  /** 任务复杂度，用于自动路由 */
  complexity?: 'simple' | 'complex';
  /** 期望的输出格式 */
  responseFormat?: 'text' | 'json';
  /** 温度，覆盖默认值 */
  temperature?: number;
  /** 最大输出 token，覆盖模式默认值 */
  maxOutputTokens?: number;
  /** 追踪 ID */
  traceId?: string;
  /** 关联 ID */
  correlationId?: string;
}

/** 模型调用结果 */
export interface ModelResult {
  content: string;
  model: string;
  alias: ModelAlias;
  mode: ModelMode;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  /** 是否成功 */
  success: boolean;
  /** 结构化输出（当 responseFormat=json 时解析） */
  parsed?: unknown;
  /** 错误码 */
  errorCode?: ErrorCode;
}

/** 可注入的 fetch 函数（用于测试 mock） */
export type FetchFn = (url: string, options?: RequestInit) => Promise<Response>;

/** DeepSeek / OpenAI 兼容的 chat completions 响应结构 */
interface ChatCompletionResponse {
  id?: string;
  model?: string;
  choices?: Array<{
    message?: { role?: string; content?: string };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

export interface ModelGatewayOptions {
  config: AppConfig;
  secretStore: SecretStore;
  /** 注入的 fetch，默认全局 fetch */
  fetchFn?: FetchFn;
  /** 数据库连接（用于用量统计；测试可传 null 用内存存储） */
  db?: DatabaseType | null;
}

/**
 * ModelGateway 实现。
 * 每轮对话创建一个 gateway 实例，跟踪 modelCallCount。
 * 或者用 beginTurn() / endTurn() 管理轮次。
 */
export class ModelGateway {
  private config: AppConfig;
  private secretStore: SecretStore;
  private fetchFn: FetchFn;
  private db: DatabaseType | null;
  private turnCallCount = 0;
  private currentTurnId: string | null = null;

  constructor(options: ModelGatewayOptions) {
    this.config = options.config;
    this.secretStore = options.secretStore;
    this.fetchFn = options.fetchFn ?? ((url, opts) => fetch(url, opts));
    this.db = options.db ?? null;
  }

  /** 开始一轮对话，重置调用计数 */
  beginTurn(turnId: string): void {
    this.turnCallCount = 0;
    this.currentTurnId = turnId;
    log.debug('turn started', { traceId: turnId });
  }

  /** 结束轮次 */
  endTurn(): void {
    log.debug('turn ended', {
      traceId: this.currentTurnId ?? undefined,
      fields: { callCount: this.turnCallCount }
    });
    this.currentTurnId = null;
  }

  /** 获取本轮已调用次数 */
  getTurnCallCount(): number {
    return this.turnCallCount;
  }

  /**
   * 调用模型。
   * 对瞬时故障自动重试（指数退避），每次 HTTP 调用（含重试）计入单轮调用配额。
   * @throws ModelCallLimitExceededError 当超过单轮上限
   */
  async invoke(request: ModelRequest): Promise<ModelResult> {
    // 强制单轮调用上限
    if (this.turnCallCount >= this.config.costBudget.maxModelCallsPerTurn) {
      throw new ModelCallLimitExceededError(this.config.costBudget.maxModelCallsPerTurn);
    }

    const apiConfig = this.secretStore.read();
    if (!apiConfig || !apiConfig.apiKey) {
      return this.failResult(request, 'model_unavailable', 'API key not configured');
    }

    // 自动路由选择模型别名
    const alias = pickModelAlias(request.mode, request.complexity ?? 'simple');
    const modelName = resolveModelName(this.config.modelAliases, alias);
    const tokenLimit = this.getTokenLimit(request.mode);

    const maxRetries = this.config.retry.maxRetries;
    const baseDelay = this.config.retry.baseDelayMs;
    const limit = this.config.costBudget.maxModelCallsPerTurn;

    let lastResult: ModelResult;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      // 每次 HTTP 调用前检查配额（重试也计入 HTTP 次数）
      if (this.turnCallCount >= limit) {
        log.warn('model call limit reached during retries, stopping', {
          traceId: request.traceId,
          fields: { callCount: this.turnCallCount, limit }
        });
        break;
      }

      const startedAt = Date.now();
      lastResult = await this.invokeOnce(request, apiConfig, alias, modelName, tokenLimit, startedAt);

      // 成功或不可重试的错误直接返回
      if (lastResult.success || !this.isRetryable(lastResult.errorCode)) {
        return lastResult;
      }

      // 最后一次尝试不再等待
      if (attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt);
        log.warn('model invoke failed, retrying', {
          traceId: request.traceId,
          fields: {
            attempt: attempt + 1,
            maxRetries: maxRetries + 1,
            errorCode: lastResult.errorCode,
            delayMs: delay,
            callCount: this.turnCallCount
          }
        });
        await this.sleep(delay);
      }
    }

    return lastResult!;
  }

  /** 判断错误码是否可重试（仅瞬时故障） */
  private isRetryable(code?: ErrorCode): boolean {
    return code === 'network_timeout' || code === 'network_failure' || code === 'model_unavailable';
  }

  /** 延迟工具 */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** 单次 HTTP 调用（不含重试）。每次调用计入 turnCallCount。 */
  private async invokeOnce(
    request: ModelRequest,
    apiConfig: { endpoint: string; apiKey: string },
    alias: ModelAlias,
    modelName: string,
    tokenLimit: { outputMaxTokens: number },
    startedAt: number
  ): Promise<ModelResult> {
    // 每次 HTTP 调用（含重试）计入单轮调用配额
    this.turnCallCount++;
    try {
      const body = {
        model: modelName,
        messages: request.messages,
        temperature: request.temperature ?? 0.8,
        max_tokens: request.maxOutputTokens ?? tokenLimit.outputMaxTokens,
        stream: false,
        ...(request.responseFormat === 'json' ? { response_format: { type: 'json_object' } } : {})
      };

      log.info('model invoke', {
        traceId: request.traceId,
        correlationId: request.correlationId,
        fields: {
          model: modelName,
          alias,
          mode: request.mode,
          callCount: this.turnCallCount
        }
      });

      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(),
        this.config.networkTimeoutMs
      );

      let response: Response;
      try {
        response = await this.fetchFn(apiConfig.endpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiConfig.apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(body),
          signal: controller.signal
        });
      } finally {
        clearTimeout(timer);
      }

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        return this.failResult(
          request,
          response.status >= 500 ? 'model_unavailable' : 'model_invalid_output',
          `API ${response.status}: ${detail.slice(0, 200)}`,
          alias, modelName, startedAt
        );
      }

      const data = (await response.json()) as ChatCompletionResponse;
      const content = data?.choices?.[0]?.message?.content;
      if (!content) {
        return this.failResult(
          request, 'model_invalid_output', 'No content in response',
          alias, modelName, startedAt
        );
      }

      const inputTokens = data?.usage?.prompt_tokens ?? 0;
      const outputTokens = data?.usage?.completion_tokens ?? 0;
      const durationMs = Date.now() - startedAt;

      // 解析结构化输出
      let parsed: unknown;
      if (request.responseFormat === 'json') {
        try {
          parsed = JSON.parse(content);
        } catch {
          parsed = undefined;
        }
      }

      const result: ModelResult = {
        content: String(content),
        model: data?.model || modelName,
        alias,
        mode: request.mode,
        inputTokens,
        outputTokens,
        durationMs,
        success: true,
        parsed
      };

      this.recordUsage(result, request.traceId);
      return result;
    } catch (error) {
      const code: ErrorCode = (error as any)?.name === 'AbortError'
        ? 'network_timeout'
        : 'network_failure';
      return this.failResult(
        request, code, (error as Error)?.message ?? String(error),
        alias, modelName, startedAt
      );
    }
  }

  /**
   * 带降级的调用：失败后降级到更低成本的模型别名重试一次。
   * 对应计划第 11 节降级矩阵。
   * 当单轮调用配额已耗尽时，不再降级，直接返回失败结果。
   */
  async invokeWithFallback(request: ModelRequest): Promise<ModelResult> {
    const result = await this.invoke(request);
    if (result.success) return result;

    // 降级到更低成本模型
    const downgradedAlias = this.downgradeAlias(result.alias);
    if (downgradedAlias === result.alias) {
      return result; // 已经是最低，无法再降级
    }

    // 配额已耗尽，不再降级
    if (this.turnCallCount >= this.config.costBudget.maxModelCallsPerTurn) {
      log.warn('model call limit reached, skipping fallback', {
        traceId: request.traceId,
        fields: { callCount: this.turnCallCount, limit: this.config.costBudget.maxModelCallsPerTurn }
      });
      return result;
    }

    log.info('downgrading model', {
      traceId: request.traceId,
      fields: { from: result.alias, to: downgradedAlias, errorCode: result.errorCode }
    });

    const retryRequest: ModelRequest = {
      ...request,
      mode: 'low_cost'
    };

    try {
      const retryResult = await this.invoke(retryRequest);
      if (!retryResult.success) return retryResult;

      return {
        ...retryResult,
        content: retryResult.content
      };
    } catch (error) {
      if (error instanceof ModelCallLimitExceededError) {
        log.warn('fallback skipped due to call limit', {
          traceId: request.traceId,
          fields: { callCount: this.turnCallCount }
        });
        return result;
      }
      throw error;
    }
  }

  /** 降级到更低成本模型别名 */
  private downgradeAlias(alias: ModelAlias): ModelAlias {
    switch (alias) {
      case MODEL_ALIAS.REASONING:
        return MODEL_ALIAS.BALANCED;
      case MODEL_ALIAS.BALANCED:
        return MODEL_ALIAS.FAST;
      default:
        return MODEL_ALIAS.FAST;
    }
  }

  private getTokenLimit(mode: ModelMode) {
    switch (mode) {
      case 'low_cost':
        return this.config.tokenLimits.lowCost;
      case 'high_quality':
        return this.config.tokenLimits.highQuality;
      default:
        return this.config.tokenLimits.balanced;
    }
  }

  private failResult(
    request: ModelRequest,
    code: ErrorCode,
    message: string,
    alias: ModelAlias = MODEL_ALIAS.BALANCED,
    modelName: string = '',
    startedAt: number = Date.now()
  ): ModelResult {
    const durationMs = Date.now() - startedAt;
    const result: ModelResult = {
      content: '',
      model: modelName,
      alias,
      mode: request.mode,
      inputTokens: 0,
      outputTokens: 0,
      durationMs,
      success: false,
      errorCode: code
    };
    log.error('model invoke failed', {
      traceId: request.traceId,
      code,
      fields: { message, alias, durationMs }
    });
    this.recordUsage(result, request.traceId);
    return result;
  }

  private recordUsage(result: ModelResult, traceId?: string): void {
    const record: ModelUsageRecord = {
      calledAt: new Date().toISOString(),
      model: result.model,
      mode: result.mode,
      alias: result.alias,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      durationMs: result.durationMs,
      success: result.success,
      errorCode: result.errorCode,
      traceId
    };
    try {
      if (this.db) {
        modelUsageRepository.insert(record);
      }
    } catch (error) {
      log.warn('failed to record model usage', {
        fields: { error: (error as Error)?.message }
      });
    }
  }

  /** 检查每日预算是否已用尽 */
  isDailyBudgetReached(): boolean {
    if (this.db) {
      return modelUsageRepository.isDailyLimitReached(
        this.config.costBudget.maxDailyModelCalls
      );
    }
    return false;
  }
}

/** 结构化输出校验：用 Zod schema 校验模型返回的 JSON */
export function validateStructuredOutput<T>(
  result: ModelResult,
  schema: z.ZodType<T>
): { valid: boolean; data?: T; error?: string } {
  if (!result.parsed || typeof result.parsed !== 'object') {
    return { valid: false, error: 'Response is not a JSON object' };
  }
  const parseResult = schema.safeParse(result.parsed);
  if (parseResult.success) {
    return { valid: true, data: parseResult.data };
  }
  return {
    valid: false,
    error: parseResult.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
  };
}
