/**
 * 节点：build_summary
 * 调用 SummaryGenerator 构建结构化摘要。
 *
 * 输入：
 * - state.draft：草稿（必须已达到 review 阶段）
 * - state.baseManifest：基础角色包 manifest
 *
 * 输出：
 * - state.summary：结构化摘要
 * - phase='review'
 *
 * 不调用模型（确定性映射）。
 */
import type { OnboardingStateType, OnboardingStateUpdate } from '../state';
import { buildSummary } from '../../../../services/character-onboarding/SummaryGenerator';
import { saveCheckpoint } from './load-checkpoint';
import { createLogger } from '../../../../infrastructure/logging/logger';

const log = createLogger('OnboardingGraph:build_summary');

export async function buildSummaryNode(
  state: OnboardingStateType
): Promise<OnboardingStateUpdate> {
  log.info('building summary', { fields: { traceId: state.traceId } });

  if (!state.draft) {
    log.error('no draft present', { fields: { traceId: state.traceId } });
    return {
      currentStep: 'finish',
      phase: 'error',
      errorReason: 'no-draft',
      errors: [...state.errors, 'No draft present in build_summary']
    };
  }

  if (!state.baseManifest) {
    log.error('no baseManifest present', { fields: { traceId: state.traceId } });
    return {
      currentStep: 'finish',
      phase: 'error',
      errorReason: 'no-base-manifest',
      errors: [...state.errors, 'No baseManifest present in build_summary']
    };
  }

  const result = buildSummary({
    draft: state.draft,
    baseCharacterId: state.baseManifest.id
  });

  if (!result.ok || !result.summary) {
    log.warn('summary build failed', {
      fields: { reason: result.reason, traceId: state.traceId }
    });
    return {
      currentStep: 'generate_questions',
      phase: 'error',
      errorReason: result.reason ?? 'summary-build-failed',
      errors: [...state.errors, `Summary build failed: ${result.reason ?? 'unknown'}`]
    };
  }

  log.info('summary built', {
    fields: {
      displayTextLength: result.summary.displayText.length,
      sourceRevision: result.summary.sourceRevision,
      traceId: state.traceId
    }
  });

  // 保存 checkpoint，等待用户确认或返回修改
  const stateForCheckpoint: OnboardingStateType = {
    ...state,
    summary: result.summary,
    phase: 'review' as const
  };
  saveCheckpoint(stateForCheckpoint, 'awaiting_user_review');

  return {
    currentStep: 'review',
    summary: result.summary,
    phase: 'review',
    awaitingUserInput: true,
    pendingQuestion: result.summary.displayText,
    checkpointReason: 'awaiting_user_review'
  };
}
