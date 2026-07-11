/**
 * 节点：expression_request 分支
 * 设置角色表情/动作。不需要模型调用。
 */
import type { ConversationStateType, ConversationStateUpdate } from '../state';
import type { SkillRegistry } from '../../../../services/SkillRegistry';
import { createLogger } from '../../../../infrastructure/logging/logger';

const log = createLogger('ConversationGraph:expression_branch');

export function createExpressionBranchNode(skillRegistry: SkillRegistry) {
  return async function expressionBranch(
    state: ConversationStateType
  ): Promise<ConversationStateUpdate> {
    log.info('expression_request branch start', {
      traceId: state.traceId,
      fields: { presetExpression: state.expression }
    });

    // 使用确定性检查预设的表情
    const expression = state.expression || 'idle';

    try {
      const result = await skillRegistry.execute(
        'set_pet_expression',
        { expression: expression as 'idle' | 'waving' | 'waiting' | 'jumping' | 'running' | 'failed' | 'review' },
        {
          userId: state.userId,
          characterId: state.characterId,
          sessionId: state.sessionId,
          traceId: state.traceId
        }
      );

      if (result.success && result.output) {
        const output = result.output as { message: string };
        log.info('expression set', {
          fields: { expression }
        });

        const persona = state.persona;
        const userPetName = persona?.userPetName ?? '';
        const greeting = userPetName ? `${userPetName}，` : '';

        return {
          skillResult: result.output,
          responseText: `${greeting}${output.message}`,
          expression,
          motion: expression
        };
      } else {
        log.warn('set_expression failed', {
          fields: { error: result.error }
        });
        return {
          responseText: `设置表情时遇到了问题：${result.error ?? '未知错误'}`,
          expression: 'failed',
          motion: 'failed'
        };
      }
    } catch (error) {
      log.error('expression branch exception', {
        traceId: state.traceId,
        fields: { error: (error as Error)?.message }
      });
      return {
        responseText: '设置表情时遇到了一些问题。',
        expression: 'failed',
        motion: 'failed'
      };
    }
  };
}
