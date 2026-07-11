/**
 * 节点：load_proactive_policy
 * 从数据库加载用户的主动策略。
 * 不存在时使用默认策略。
 */
import type { ProactiveStateType, ProactiveStateUpdate } from '../state';
import { proactivePolicyRepository, DEFAULT_PROACTIVE_POLICY } from '../../../../infrastructure/database/repositories/proactive-policy-repository';
import { createLogger } from '../../../../infrastructure/logging/logger';

const log = createLogger('ProactiveGraph:load_proactive_policy');

export async function loadProactivePolicy(
  state: ProactiveStateType
): Promise<ProactiveStateUpdate> {
  log.info('loading proactive policy', {
    traceId: state.traceId,
    fields: { userId: state.userId, characterId: state.characterId }
  });

  let policy;
  try {
    policy = proactivePolicyRepository.get(state.userId, state.characterId);
  } catch (error) {
    log.warn('failed to load proactive policy, using default', {
      fields: { error: (error as Error)?.message }
    });
    policy = { ...DEFAULT_PROACTIVE_POLICY };
  }

  log.info('proactive policy loaded', {
    fields: {
      dndEnabled: policy.dndEnabled,
      dndWindow: `${policy.dndStart}-${policy.dndEnd}`,
      maxDaily: policy.maxDailyProactive,
      ignoreThreshold: policy.ignoreThreshold
    }
  });

  return { policy };
}
