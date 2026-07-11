/**
 * 节点：activate_character
 * 激活角色，创建默认会话。
 */
import type { OnboardingStateType, OnboardingStateUpdate } from '../state';
import { sessionRepository } from '../../../../infrastructure/database/repositories/session-repository';
import { createLogger } from '../../../../infrastructure/logging/logger';

const log = createLogger('OnboardingGraph:activate_character');

function generateId(prefix: string): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${ts}-${rand}`;
}

export async function activateCharacter(
  state: OnboardingStateType
): Promise<OnboardingStateUpdate> {
  log.info('activating character', {
    fields: { userId: state.userId, characterId: state.characterId }
  });

  // 创建默认会话
  let sessionId = '';
  try {
    // 检查是否已有活跃会话
    const existing = sessionRepository.getActiveSession(state.userId, state.characterId);
    if (existing) {
      sessionId = existing.id;
      log.info('reusing existing active session', { fields: { sessionId } });
    } else {
      sessionId = generateId('sess');
      sessionRepository.insert({
        id: sessionId,
        user_id: state.userId,
        character_id: state.characterId
      });
      log.info('created new default session', { fields: { sessionId } });
    }
  } catch (error) {
    log.warn('failed to create session', { fields: { error: (error as Error)?.message } });
  }

  return {
    currentStep: 'finish',
    sessionId,
    isCompleted: true
  };
}
