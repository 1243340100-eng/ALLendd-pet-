/**
 * 节点：list_today_schedule 分支
 * 查询今日计划。纯数据库读取，不需要模型调用。
 *
 * 聚合：今日提醒、今日任务、已过期但未完成任务。
 * 角色化表达可使用本地模板。
 */
import type { ConversationStateType, ConversationStateUpdate } from '../state';
import type { SkillRegistry } from '../../../../services/SkillRegistry';
import { createLogger } from '../../../../infrastructure/logging/logger';

const log = createLogger('ConversationGraph:list_schedule_branch');

export function createListScheduleBranchNode(skillRegistry: SkillRegistry) {
  return async function listScheduleBranch(
    state: ConversationStateType
  ): Promise<ConversationStateUpdate> {
    log.info('list_today_schedule branch start', {
      traceId: state.traceId
    });

    try {
      const result = await skillRegistry.execute(
        'list_today_schedule',
        { timezone: 'Asia/Shanghai' },
        {
          userId: state.userId,
          characterId: state.characterId,
          sessionId: state.sessionId,
          traceId: state.traceId
        }
      );

      if (result.success && result.output) {
        const output = result.output as { message: string; totalCount: number; overdueCount: number };
        log.info('schedule listed', {
          fields: { totalCount: output.totalCount, overdueCount: output.overdueCount }
        });

        // 使用本地模板包装角色化表达
        const persona = state.persona;
        const userPetName = persona?.userPetName ?? '';
        const greeting = userPetName ? `${userPetName}，` : '';

        const responseText = `${greeting}${output.message}`;

        return {
          skillResult: result.output,
          responseText,
          expression: output.overdueCount > 0 ? 'review' : 'idle',
          motion: 'idle'
        };
      } else {
        log.warn('list_today_schedule failed', {
          fields: { error: result.error }
        });
        return {
          responseText: `查询今日计划时遇到了问题：${result.error ?? '未知错误'}`,
          expression: 'failed',
          motion: 'failed'
        };
      }
    } catch (error) {
      log.error('list_schedule branch exception', {
        traceId: state.traceId,
        fields: { error: (error as Error)?.message }
      });
      return {
        responseText: '查询今日计划时遇到了一些问题，请稍后再试。',
        expression: 'failed',
        motion: 'failed'
      };
    }
  };
}
