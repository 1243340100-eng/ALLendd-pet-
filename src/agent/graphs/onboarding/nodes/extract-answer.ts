/**
 * 节点：extract_answer
 * 从用户回答中提取结构化更新。
 *
 * V9 双路径：
 * 1. 结构化卡片回答（state.questionAnswers 非空）：
 *    - 纯选项 → AnswerProcessor 直接构造 extraction（不调用模型）
 *    - 含自由文本 → AnswerProcessor 拆分，自由文本交给 AnswerExtractor
 * 2. 兼容旧文本路径（state.questionAnswers 为空且 lastUserInput 非空）：
 *    - 整段文本交给 AnswerExtractor
 *
 * 输入（从 state 读取）：
 * - draft：当前草稿
 * - currentStage：当前阶段
 * - currentQuestions：当前轮问题卡片
 * - questionAnswers：V9 结构化回答
 * - lastUserInput：兼容旧文本
 *
 * 输出（写入 state）：
 * - extractionResult：提取结果（updates / explicitCorrections / ambiguities）
 *
 * 模型失败时：
 * - 不修改草稿
 * - 设置 phase='error' 和 errorReason
 * - 允许调用方重试
 */
import type { OnboardingStateType, OnboardingStateUpdate } from '../state';
import { extractAnswer } from '../../../../services/character-onboarding/AnswerExtractor';
import { processAnswers, mergeDirectAndModelExtraction } from '../../../../services/character-onboarding/AnswerProcessor';
import type { ModelGateway } from '../../../../services/ModelGateway';
import { createLogger } from '../../../../infrastructure/logging/logger';

const log = createLogger('OnboardingGraph:extract_answer');

export function createExtractAnswerNode(gateway: ModelGateway) {
  return async function extractAnswerNode(
    state: OnboardingStateType
  ): Promise<OnboardingStateUpdate> {
    log.info('extracting answer', {
      fields: {
        stage: state.currentStage,
        userAction: state.userAction,
        userInputLength: state.lastUserInput.length,
        structuredAnswers: state.questionAnswers.length,
        traceId: state.traceId
      }
    });

    if (!state.draft) {
      log.error('no draft present', { fields: { traceId: state.traceId } });
      return {
        currentStep: 'finish',
        phase: 'error',
        errorReason: 'no-draft',
        errors: [...state.errors, 'No draft present in extract_answer']
      };
    }

    const isFeedback = state.userAction === 'feedback';
    const hasStructuredAnswers = state.questionAnswers.length > 0;

    // ===== V9 路径 1：结构化卡片回答 =====
    if (hasStructuredAnswers) {
      const processed = processAnswers({
        currentQuestions: state.currentQuestions,
        answers: state.questionAnswers,
        currentDraft: state.draft,
        currentStage: state.currentStage,
        crossStage: isFeedback,
        traceId: state.traceId
      });

      // 校验失败 → 整批拒绝，不推进 revision
      if (processed.errors.length > 0) {
        log.warn('structured answers rejected', {
          fields: { errors: processed.errors, traceId: state.traceId }
        });
        return {
          currentStep: 'finish',
          phase: 'error',
          errorReason: 'invalid-structured-answers',
          errors: [...state.errors, ...processed.errors],
          lastUserInput: state.lastUserInput,
          pendingQuestion: state.pendingQuestion,
          awaitingUserInput: true
        };
      }

      // 无自由文本 → 直接使用选项结果，不调用模型
      if (!processed.freeText) {
        if (processed.directExtraction.updates.length === 0 &&
            processed.directExtraction.explicitCorrections.length === 0 &&
            processed.directExtraction.ambiguities.length === 0) {
          log.warn('structured answers produced no extraction', {
            fields: { traceId: state.traceId }
          });
          return {
            currentStep: 'finish',
            phase: 'error',
            errorReason: 'empty-structured-answers',
            errors: [...state.errors, 'Structured answers produced no extraction'],
            awaitingUserInput: true
          };
        }

        log.info('structured answers processed (no model call)', {
          fields: {
            updates: processed.directExtraction.updates.length,
            corrections: processed.directExtraction.explicitCorrections.length,
            traceId: state.traceId
          }
        });

        return {
          currentStep: 'merge_draft',
          extractionResult: processed.directExtraction,
          phase: isFeedback ? 'collecting' : 'busy',
          ...(isFeedback ? { summary: null } : {})
        };
      }

      // 含自由文本 → 调用 AnswerExtractor 处理自由文本，再与直接结果合并
      log.info('structured answers with free text, calling AnswerExtractor', {
        fields: {
          freeTextLength: processed.freeText.length,
          freeTextFields: processed.freeTextFields,
          traceId: state.traceId
        }
      });

      const modelResult = await extractAnswer(gateway, {
        currentStage: state.currentStage,
        currentDraft: state.draft,
        previousQuestions: state.previousQuestions,
        userAnswer: processed.freeText,
        traceId: state.traceId,
        crossStage: isFeedback
      });

      if (!modelResult.ok || !modelResult.extraction) {
        log.warn('answer extraction failed for free text', {
          fields: { reason: modelResult.reason, traceId: state.traceId }
        });
        return {
          currentStep: 'finish',
          phase: 'error',
          errorReason: modelResult.reason ?? 'extraction-failed',
          errors: [...state.errors, `Answer extraction failed: ${modelResult.reason ?? 'unknown'}`],
          lastUserInput: state.lastUserInput,
          pendingQuestion: state.pendingQuestion,
          awaitingUserInput: true
        };
      }

      const merged = mergeDirectAndModelExtraction(
        processed.directExtraction,
        modelResult.extraction
      );

      log.info('merged direct + model extraction', {
        fields: {
          updates: merged.updates.length,
          corrections: merged.explicitCorrections.length,
          ambiguities: merged.ambiguities.length,
          traceId: state.traceId
        }
      });

      return {
        currentStep: 'merge_draft',
        extractionResult: merged,
        phase: isFeedback ? 'collecting' : 'busy',
        ...(isFeedback ? { summary: null } : {})
      };
    }

    // ===== 兼容旧文本路径 2：lastUserInput 整段文本 =====
    const trimmedInput = state.lastUserInput.trim();
    if (!trimmedInput) {
      log.warn('empty user input, cannot extract', { fields: { traceId: state.traceId } });
      return {
        currentStep: 'generate_questions',
        phase: 'error',
        errorReason: 'empty-user-input',
        errors: [...state.errors, 'User input is empty']
      };
    }

    const result = await extractAnswer(gateway, {
      currentStage: state.currentStage,
      currentDraft: state.draft,
      previousQuestions: state.previousQuestions,
      userAnswer: trimmedInput,
      traceId: state.traceId,
      crossStage: isFeedback
    });

    if (!result.ok || !result.extraction) {
      log.warn('answer extraction failed', {
        fields: { reason: result.reason, traceId: state.traceId }
      });
      return {
        currentStep: 'finish',
        phase: 'error',
        errorReason: result.reason ?? 'extraction-failed',
        errors: [...state.errors, `Answer extraction failed: ${result.reason ?? 'unknown'}`],
        lastUserInput: state.lastUserInput,
        pendingQuestion: state.pendingQuestion,
        awaitingUserInput: true
      };
    }

    log.info('answer extracted (legacy text path)', {
      fields: {
        updates: result.extraction.updates.length,
        corrections: result.extraction.explicitCorrections.length,
        ambiguities: result.extraction.ambiguities.length,
        traceId: state.traceId
      }
    });

    return {
      currentStep: 'merge_draft',
      extractionResult: result.extraction,
      phase: isFeedback ? 'collecting' : 'busy',
      ...(isFeedback ? { summary: null } : {})
    };
  };
}
