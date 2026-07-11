/**
 * 节点：classify_memory_scope
 * 对记忆候选进行作用域分类。
 * 规则驱动，不消耗模型调用。
 *
 * global: 用户档案级信息（姓名、生日、职业、全局偏好）
 * character: 与当前角色相关的关系、事件、角色专属偏好
 */
import type { ReflectionStateType, ReflectionStateUpdate, MemoryCandidate } from '../state';
import { createLogger } from '../../../../infrastructure/logging/logger';

const log = createLogger('ReflectionGraph:classify_memory_scope');

/** 作用域分类规则 */
function classifyScope(candidate: MemoryCandidate): MemoryScope {
  const content = candidate.content;
  const type = candidate.type;

  // profile 类型：涉及用户身份信息的为全局
  if (type === 'profile') {
    // 角色专属称呼和关系信息 → character
    if (content.includes('称呼') || content.includes('叫法')) {
      return 'character';
    }
    return 'global';
  }

  // preference 类型：通用偏好 → global，角色专属偏好 → character
  if (type === 'preference') {
    // 涉及与角色互动方式的偏好 → character
    if (content.includes('回复') || content.includes('语气') ||
        content.includes('称呼') || content.includes('互动') ||
        content.includes('回答') || content.includes('简短') ||
        content.includes('详细')) {
      return 'character';
    }
    return 'global';
  }

  // relationship 类型：始终为角色级
  if (type === 'relationship') {
    return 'character';
  }

  // event 类型：涉及特定角色的事件 → character，其他 → global
  if (type === 'event') {
    // 默认为角色级（用户与角色的共同经历）
    return 'character';
  }

  // project 类型：长期项目，通常为全局
  if (type === 'project') {
    return 'global';
  }

  return candidate.scope;
}

type MemoryScope = 'global' | 'character';

export async function classifyMemoryScope(
  state: ReflectionStateType
): Promise<ReflectionStateUpdate> {
  log.info('classifying memory scope', {
    traceId: state.traceId,
    fields: { candidateCount: state.candidates.length }
  });

  // 如果已经结束，跳过
  if (state.reflectionResult) {
    return {};
  }

  const classified = state.candidates.map(c => ({
    ...c,
    scope: classifyScope(c)
  }));

  log.info('scope classification complete', {
    traceId: state.traceId,
    fields: {
      global: classified.filter(c => c.scope === 'global').length,
      character: classified.filter(c => c.scope === 'character').length
    }
  });

  return { candidates: classified };
}
