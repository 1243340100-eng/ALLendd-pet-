/**
 * 配置加载接口。
 * 对应架构计划第 1 节"建立配置加载及密钥存储接口"。
 *
 * 设计：
 * - 配置文件位于 userData，JSON 格式
 * - 模型别名映射在此，不在代码中硬编码模型名
 * - 写入使用原子写（复用 pet-data-store 的模式）
 */
import type { ModelAlias, ModelMode } from '../../shared/constants';

/** 模型别名 → 实际模型名映射 */
export interface ModelAliasMap {
  fastModel: string;
  balancedModel: string;
  reasoningModel: string;
}

/** 各模式的最大 token 配额 */
export interface ModelTokenLimits {
  lowCost: { inputMaxTokens: number; outputMaxTokens: number };
  balanced: { inputMaxTokens: number; outputMaxTokens: number };
  highQuality: { inputMaxTokens: number; outputMaxTokens: number };
}

/** 成本预算配置 */
export interface CostBudgetConfig {
  maxModelCallsPerTurn: number;
  maxDailyModelCalls: number;
  /** 可选：每日 token 预算 */
  dailyTokenBudget?: number;
  /** 达到预算后降级到的模式 */
  degradedMode: ModelMode;
}

/** 重试配置 */
export interface RetryConfig {
  /** 最大重试次数（不含首次调用，默认 2） */
  maxRetries: number;
  /** 基础退避毫秒（默认 500，指数退避 base * 2^attempt） */
  baseDelayMs: number;
}

/** 应用配置（不含密钥） */
export interface AppConfig {
  /** 默认模型质量模式 */
  defaultModelMode: ModelMode;
  /** 模型别名映射 */
  modelAliases: ModelAliasMap;
  /** token 限制 */
  tokenLimits: ModelTokenLimits;
  /** 成本预算 */
  costBudget: CostBudgetConfig;
  /** 重试配置 */
  retry: RetryConfig;
  /** DeepSeek endpoint */
  deepseekEndpoint: string;
  /** 网络超时毫秒 */
  networkTimeoutMs: number;
}

/** 默认配置 */
export function getDefaultAppConfig(): AppConfig {
  return {
    defaultModelMode: 'balanced',
    modelAliases: {
      fastModel: 'deepseek-chat',
      balancedModel: 'deepseek-chat',
      reasoningModel: 'deepseek-reasoner'
    },
    tokenLimits: {
      lowCost: { inputMaxTokens: 8000, outputMaxTokens: 1024 },
      balanced: { inputMaxTokens: 16000, outputMaxTokens: 2048 },
      highQuality: { inputMaxTokens: 32000, outputMaxTokens: 4096 }
    },
    costBudget: {
      maxModelCallsPerTurn: 3,
      maxDailyModelCalls: 500,
      degradedMode: 'low_cost'
    },
    retry: {
      maxRetries: 2,
      baseDelayMs: 500
    },
    deepseekEndpoint: 'https://api.deepseek.com/v1/chat/completions',
    networkTimeoutMs: 30000
  };
}

/**
 * 配置加载接口。具体实现可以是文件、内存（测试）。
 * 实现类负责原子写入和 schema 校验。
 */
export interface ConfigLoader {
  load(): AppConfig;
  save(config: Partial<AppConfig>): AppConfig;
  /** 重置为默认 */
  reset(): AppConfig;
}

/** 将模型别名解析为实际模型名 */
export function resolveModelName(
  aliases: ModelAliasMap,
  alias: ModelAlias
): string {
  return aliases[alias];
}

/** 根据模式选择模型别名 */
export function pickModelAlias(
  mode: ModelMode,
  complexity: 'simple' | 'complex'
): ModelAlias {
  switch (mode) {
    case 'low_cost':
      return 'fastModel';
    case 'balanced':
      return complexity === 'complex' ? 'reasoningModel' : 'balancedModel';
    case 'high_quality':
      return complexity === 'complex' ? 'reasoningModel' : 'fastModel';
    case 'auto':
      return complexity === 'complex' ? 'reasoningModel' : 'balancedModel';
    default:
      return 'balancedModel';
  }
}

/**
 * 将用户自定义模型别名应用到配置。
 * 从 app_settings 读取用户配置的模型别名（如 fastModel/balancedModel/reasoningModel），
 * 覆盖默认配置中的硬编码值。空值或未设置时保持默认。
 */
export function applyUserModelAliases(
  config: AppConfig,
  userAliases: Partial<ModelAliasMap>
): AppConfig {
  if (!userAliases || Object.keys(userAliases).length === 0) {
    return config;
  }
  return {
    ...config,
    modelAliases: {
      fastModel: userAliases.fastModel || config.modelAliases.fastModel,
      balancedModel: userAliases.balancedModel || config.modelAliases.balancedModel,
      reasoningModel: userAliases.reasoningModel || config.modelAliases.reasoningModel
    }
  };
}
