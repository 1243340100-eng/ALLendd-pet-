/**
 * SkillRegistry：技能注册与管理。
 * 对应架构计划第 2.4 节。
 *
 * 职责：
 * - 注册内置技能
 * - 根据技能 ID 获取元数据和 handler
 * - 校验输入 Schema
 * - 声明权限等级
 * - 调用 PermissionGuard
 * - 记录技能执行结果
 * - 拒绝未注册技能
 *
 * V1 只能加载编译进应用的技能，不扫描用户目录。
 */
import { z } from 'zod';
import { createLogger } from '../infrastructure/logging/logger';
import { SkillNotRegisteredError, IpcValidationError } from '../shared/contracts/errors';
import type { PermissionLevel, SkillId } from '../shared/constants';
import type { PermissionGuard } from '../domain/permissions/PermissionGuard';

const log = createLogger('SkillRegistry');

export interface SkillDefinition<TInput = unknown, TOutput = unknown> {
  id: string;
  name: string;
  description: string;
  /** 权限等级 */
  permissionLevel: PermissionLevel;
  /** 输入 schema */
  inputSchema: z.ZodType<TInput>;
  /** 执行 handler */
  handler: (input: TInput, context: SkillContext) => Promise<TOutput>;
}

export interface SkillContext {
  userId: string;
  characterId: string;
  sessionId?: string;
  traceId: string;
}

export interface SkillExecutionResult<T = unknown> {
  success: boolean;
  output?: T;
  error?: string;
  durationMs: number;
}

export class SkillRegistry {
  private skills = new Map<string, SkillDefinition>();
  private permissionGuard: PermissionGuard;

  constructor(permissionGuard: PermissionGuard) {
    this.permissionGuard = permissionGuard;
  }

  /** 注册技能 */
  register<TInput, TOutput>(skill: SkillDefinition<TInput, TOutput>): void {
    if (this.skills.has(skill.id)) {
      throw new Error(`Skill already registered: ${skill.id}`);
    }
    // 内部以 SkillDefinition<unknown, unknown> 形式存储；
    // 执行时 inputSchema.safeParse 会把 unknown 收敛为具体 TInput，
    // 因此 handler 调用是类型安全的。
    this.skills.set(skill.id, skill as unknown as SkillDefinition);
    log.info('skill registered', {
      fields: { id: skill.id, permissionLevel: skill.permissionLevel }
    });
  }

  /** 获取技能元数据 */
  getMetadata(id: string): { id: string; name: string; description: string; permissionLevel: PermissionLevel } | null {
    const skill = this.skills.get(id);
    if (!skill) return null;
    return {
      id: skill.id,
      name: skill.name,
      description: skill.description,
      permissionLevel: skill.permissionLevel
    };
  }

  /** 列出所有已注册技能 */
  list(): Array<{ id: string; name: string; description: string; permissionLevel: PermissionLevel }> {
    return Array.from(this.skills.values()).map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      permissionLevel: s.permissionLevel
    }));
  }

  /**
   * 执行技能。
   * 校验输入 → 检查权限 → 调用 handler → 记录结果。
   */
  async execute(id: string, input: unknown, context: SkillContext): Promise<SkillExecutionResult> {
    const skill = this.skills.get(id);
    if (!skill) {
      throw new SkillNotRegisteredError(id);
    }

    // 校验输入
    const parseResult = skill.inputSchema.safeParse(input);
    if (!parseResult.success) {
      const issues = parseResult.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message
      }));
      log.warn('skill input invalid', {
        fields: { id, issues: issues.length }
      });
      return {
        success: false,
        error: new IpcValidationError(`skill:${id}`, issues).message,
        durationMs: 0
      };
    }

    // 检查权限
    const permitted = await this.permissionGuard.check(skill.id, skill.permissionLevel, context);
    if (!permitted.granted) {
      log.warn('skill permission denied', {
        fields: { id, reason: permitted.reason }
      });
      return {
        success: false,
        error: permitted.reason ?? 'Permission denied',
        durationMs: 0
      };
    }

    // 执行
    const startedAt = Date.now();
    try {
      const output = await skill.handler(parseResult.data, context);
      const durationMs = Date.now() - startedAt;
      log.info('skill executed', {
        traceId: context.traceId,
        fields: { id, durationMs }
      });
      return { success: true, output, durationMs };
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      const message = (error as Error)?.message ?? String(error);
      log.error('skill execution failed', {
        traceId: context.traceId,
        fields: { id, error: message }
      });
      return { success: false, error: message, durationMs };
    }
  }

  /** 判断技能是否已注册 */
  isRegistered(id: string): boolean {
    return this.skills.has(id);
  }
}
