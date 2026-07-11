/**
 * 节点：validate_candidates
 * 过滤敏感信息和无价值内容。
 * 使用 sensitive-info-filter 进行规则检测。
 */
import type { ReflectionStateType, ReflectionStateUpdate, MemoryCandidate } from '../state';
import { validateContent } from './sensitive-info-filter';
import { createLogger } from '../../../../infrastructure/logging/logger';

const log = createLogger('ReflectionGraph:validate_candidates');

export async function validateCandidates(
  state: ReflectionStateType
): Promise<ReflectionStateUpdate> {
  log.info('validating candidates', {
    traceId: state.traceId,
    fields: { count: state.candidates.length }
  });

  // 如果已经结束，跳过
  if (state.reflectionResult) {
    return {};
  }

  const characterName = state.persona?.characterName ?? '';
  const userMessage = state.reflectionPayload.userMessage;
  const validCandidates: MemoryCandidate[] = [];
  let filteredCount = 0;

  for (const candidate of state.candidates) {
    // 程序级证据校验：evidenceQuote 必须是 userMessage 的原文子串
    const evidenceQuote = candidate.evidenceQuote;
    if (!evidenceQuote || evidenceQuote.length === 0) {
      filteredCount++;
      log.info('candidate filtered: evidence empty', {
        traceId: state.traceId,
        fields: {
          type: candidate.type,
          reason: 'evidence_not_found_in_user_message',
          contentPreview: candidate.content.slice(0, 50)
        }
      });
      continue;
    }
    if (!userMessage.includes(evidenceQuote)) {
      filteredCount++;
      log.info('candidate filtered: evidence not in userMessage', {
        traceId: state.traceId,
        fields: {
          type: candidate.type,
          reason: 'evidence_not_found_in_user_message',
          contentPreview: candidate.content.slice(0, 50),
          evidencePreview: evidenceQuote.slice(0, 50)
        }
      });
      continue;
    }

    // 敏感信息过滤
    const result = validateContent(candidate.content, { characterName });
    if (result.valid) {
      validCandidates.push({ ...candidate, valid: true, sourceRole: 'user' });
    } else {
      filteredCount++;
      log.info('candidate filtered', {
        traceId: state.traceId,
        fields: {
          type: candidate.type,
          reason: result.reason,
          contentPreview: candidate.content.slice(0, 50)
        }
      });
    }
  }

  log.info('validation complete', {
    traceId: state.traceId,
    fields: {
      valid: validCandidates.length,
      filtered: filteredCount
    }
  });

  return { validCandidates };
}
