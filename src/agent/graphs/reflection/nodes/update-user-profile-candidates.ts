/**
 * 节点：update_user_profile_candidates
 * 更新全局用户档案候选。
 * 处理 scope='global' 且 type='profile' 的已保存记忆。
 *
 * V1 只做日志记录，不做额外处理。
 * 全局档案更新在 upsert_memory 阶段已完成。
 */
import type { ReflectionStateType, ReflectionStateUpdate } from '../state';
import { createLogger } from '../../../../infrastructure/logging/logger';

const log = createLogger('ReflectionGraph:update_user_profile_candidates');

export async function updateUserProfileCandidates(
  state: ReflectionStateType
): Promise<ReflectionStateUpdate> {
  log.info('updating user profile candidates', {
    traceId: state.traceId
  });

  // 如果已经结束，跳过
  if (state.reflectionResult) {
    return {};
  }

  // 统计全局档案候选
  const globalProfileCandidates = state.savedCandidates.filter(
    c => c.scope === 'global' && c.type === 'profile'
  );

  if (globalProfileCandidates.length > 0) {
    log.info('global profile candidates saved', {
      traceId: state.traceId,
      fields: { count: globalProfileCandidates.length }
    });
  }

  // V1：全局档案已在 upsert_memory 节点写入
  // 未来可以在这里做额外的档案合并、去重或更新统计

  return {};
}
