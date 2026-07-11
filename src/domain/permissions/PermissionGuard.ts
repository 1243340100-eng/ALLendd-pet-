/**
 * PermissionGuard：权限守卫。
 * 对应架构计划第 10 节权限矩阵。
 *
 * 必须位于 Graph 与技能 handler 之间，不能只依赖 Prompt。
 */
import type { PermissionLevel } from '../../shared/constants';
import { createLogger } from '../../infrastructure/logging/logger';

const log = createLogger('PermissionGuard');

export interface PermissionCheckResult {
  granted: boolean;
  reason?: string;
  /** 需要用户确认时携带的请求 ID */
  requestId?: string;
}

export interface PermissionContext {
  userId: string;
  characterId: string;
  sessionId?: string;
  traceId: string;
}

export interface PermissionGuard {
  check(
    operation: string,
    requiredLevel: PermissionLevel,
    context: PermissionContext
  ): Promise<PermissionCheckResult>;
}

/**
 * 基于权限矩阵的默认实现。
 * auto_allow 直接通过；deny 直接拒绝；
 * explicit_confirm / double_confirm 需要异步等待用户确认。
 */
export class DefaultPermissionGuard implements PermissionGuard {
  private pendingRequests = new Map<string, (granted: boolean) => void>();

  async check(
    operation: string,
    requiredLevel: PermissionLevel,
    context: PermissionContext
  ): Promise<PermissionCheckResult> {
    switch (requiredLevel) {
      case 'auto_allow':
        return { granted: true };

      case 'deny':
        log.warn('permission denied', {
          traceId: context.traceId,
          fields: { operation }
        });
        return { granted: false, reason: 'Operation is not allowed' };

      case 'explicit_confirm':
      case 'double_confirm': {
        // 实际实现需要通过 IPC 请求用户确认
        // V1 骨架：返回需要确认
        const requestId = `perm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        log.info('permission requires confirmation', {
          traceId: context.traceId,
          fields: { operation, requiredLevel, requestId }
        });
        return {
          granted: false,
          reason: `Requires ${requiredLevel}`,
          requestId
        };
      }

      default:
        return { granted: false, reason: 'Unknown permission level' };
    }
  }

  /** 用户确认后调用，解析挂起的请求 */
  resolve(requestId: string, granted: boolean): void {
    const resolver = this.pendingRequests.get(requestId);
    if (resolver) {
      resolver(granted);
      this.pendingRequests.delete(requestId);
    }
  }
}
