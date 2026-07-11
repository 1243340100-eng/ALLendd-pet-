/**
 * 统一错误类型。对应架构计划第 11 节失败与降级矩阵。
 */
import type { ErrorCode } from '../constants';

/** Graph 内部可恢复错误，收集到 state.errors */
export class GraphError extends Error {
  public readonly code: ErrorCode;
  public readonly node?: string;
  public readonly recovered: boolean;
  public readonly occurredAt: string;
  public readonly cause?: unknown;

  constructor(params: {
    code: ErrorCode;
    message: string;
    node?: string;
    recovered?: boolean;
    cause?: unknown;
  }) {
    super(params.message);
    this.name = 'GraphError';
    this.code = params.code;
    this.node = params.node;
    this.recovered = params.recovered ?? false;
    this.occurredAt = new Date().toISOString();
    this.cause = params.cause;
  }

  /** 转为 state.errors 中的结构化条目 */
  toStateEntry() {
    return {
      code: this.code,
      message: this.message,
      node: this.node,
      recovered: this.recovered,
      occurredAt: this.occurredAt
    };
  }
}

/** IPC 输入校验失败 */
export class IpcValidationError extends Error {
  public readonly channel: string;
  public readonly issues: ReadonlyArray<{ path: string; message: string }>;

  constructor(channel: string, issues: Array<{ path: string; message: string }>) {
    super(`IPC validation failed for channel "${channel}"`);
    this.name = 'IpcValidationError';
    this.channel = channel;
    this.issues = issues;
  }
}

/** 权限被拒绝，不可绕过 */
export class PermissionDeniedError extends Error {
  public readonly operation: string;
  public readonly requiredLevel: string;

  constructor(operation: string, requiredLevel: string, message?: string) {
    super(message || `Permission denied for operation: ${operation}`);
    this.name = 'PermissionDeniedError';
    this.operation = operation;
    this.requiredLevel = requiredLevel;
  }
}

/** 模型调用超出单轮上限 */
export class ModelCallLimitExceededError extends Error {
  public readonly limit: number;

  constructor(limit: number) {
    super(`Model call limit exceeded: ${limit} calls per turn`);
    this.name = 'ModelCallLimitExceededError';
    this.limit = limit;
  }
}

/** 角色包校验失败 */
export class CharacterPackInvalidError extends Error {
  public readonly packId: string;
  public readonly reasons: string[];

  constructor(packId: string, reasons: string[]) {
    super(`Character pack "${packId}" is invalid: ${reasons.join('; ')}`);
    this.name = 'CharacterPackInvalidError';
    this.packId = packId;
    this.reasons = reasons;
  }
}

/** 提醒时间不合法 */
export class TimeInvalidError extends Error {
  public readonly candidate: string;
  public readonly reason: string;

  constructor(candidate: string, reason: string) {
    super(`Invalid time "${candidate}": ${reason}`);
    this.name = 'TimeInvalidError';
    this.candidate = candidate;
    this.reason = reason;
  }
}

/** 技能未注册 */
export class SkillNotRegisteredError extends Error {
  public readonly skillId: string;

  constructor(skillId: string) {
    super(`Skill not registered: ${skillId}`);
    this.name = 'SkillNotRegisteredError';
    this.skillId = skillId;
  }
}

/** 判断错误是否可重试 */
export function isRetryable(error: unknown): boolean {
  if (error instanceof GraphError) {
    return (
      error.code === 'network_timeout' ||
      error.code === 'network_failure' ||
      error.code === 'model_unavailable'
    );
  }
  return false;
}

/** 将任意错误归一化为 GraphError */
export function toGraphError(error: unknown, node?: string): GraphError {
  if (error instanceof GraphError) return error;
  const message = error instanceof Error ? error.message : String(error);
  const code = inferErrorCode(error);
  return new GraphError({ code, message, node, recovered: false, cause: error });
}

function inferErrorCode(error: unknown): ErrorCode {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (message.includes('timeout') || message.includes('aborted')) return 'network_timeout';
  if (message.includes('network') || message.includes('fetch') || message.includes('econnrefused')) {
    return 'network_failure';
  }
  if (message.includes('permission')) return 'permission_denied';
  if (message.includes('not registered') || message.includes('skill')) return 'skill_not_registered';
  if (message.includes('database') || message.includes('sqlite')) return 'database_error';
  if (message.includes('checkpoint')) return 'checkpoint_corrupted';
  if (message.includes('character') || message.includes('pack')) return 'character_pack_invalid';
  if (message.includes('time') || message.includes('date')) return 'time_invalid';
  return 'unknown';
}
