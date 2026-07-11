/**
 * 节点：permission_check
 * 检查选中技能的权限。
 *
 * 对于 auto_allow 级别的技能（三个内置技能都是），直接通过。
 * 对于 explicit_confirm / double_confirm 级别的技能，需要用户确认。
 *
 * V1 所有内置技能均为 auto_allow，所以此节点主要是验证流程。
 */
import type { ConversationStateType, ConversationStateUpdate } from '../state';
import type { SkillRegistry } from '../../../../services/SkillRegistry';
import { createLogger } from '../../../../infrastructure/logging/logger';

const log = createLogger('ConversationGraph:permission_check');

export function createPermissionCheckNode(skillRegistry: SkillRegistry) {
  return async function permissionCheck(
    state: ConversationStateType
  ): Promise<ConversationStateUpdate> {
    log.info('checking permission', {
      traceId: state.traceId,
      fields: { skillId: state.selectedSkillId, intent: state.intent }
    });

    // chat 意图不需要权限检查
    if (state.intent === 'chat' || !state.selectedSkillId) {
      return {};
    }

    // 检查技能是否已注册
    const skillId = state.selectedSkillId;
    if (!skillRegistry.isRegistered(skillId)) {
      log.warn('skill not registered', {
        fields: { skillId }
      });
      // 未注册技能无法调用
      return {
        selectedSkillId: null,
        intent: 'chat', // 降级为聊天
        errors: [...state.errors, {
          code: 'skill_not_registered' as const,
          message: `Skill not registered: ${skillId}`,
          node: 'permission_check',
          recovered: true,
          occurredAt: new Date().toISOString()
        }]
      };
    }

    const metadata = skillRegistry.getMetadata(skillId);
    if (!metadata) {
      log.warn('skill metadata not found', { fields: { skillId } });
      return {
        selectedSkillId: null,
        intent: 'chat',
        errors: [...state.errors, {
          code: 'skill_not_registered' as const,
          message: `Skill metadata not found: ${skillId}`,
          node: 'permission_check',
          recovered: true,
          occurredAt: new Date().toISOString()
        }]
      };
    }

    // V1 所有内置技能都是 auto_allow
    log.info('permission granted', {
      fields: { skillId, level: metadata.permissionLevel }
    });

    return {};
  };
}
