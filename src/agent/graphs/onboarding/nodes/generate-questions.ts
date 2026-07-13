/**
 * 节点：generate_questions
 * 调用 QuestionGenerator 将 nextQuestionGroup 转成自然问题。
 *
 * 流程：
 * 1. 使用 CoverageValidator 计算 nextQuestionGroup
 *    （P1: targetStage 存在时，为该阶段所有字段生成卡片，不依赖 CoverageValidator）
 * 2. 调用 QuestionGenerator 生成问题文本（W7：优先使用模型，失败回退固定模板）
 * 3. 保存 checkpoint（reason='awaiting_user_answer'）
 * 4. 设置 awaitingUserInput=true，让 Graph 在此结束（等待 IPC 触发下一轮）
 *
 * W7：通过 ModelGateway 调用 balancedModel 生成自然问题，模型失败时回退固定模板。
 * 模型只能为给定字段生成问题文本，不能增加字段或宣布完成。
 */
import type { OnboardingStateType, OnboardingStateUpdate } from '../state';
import { validateCoverage, type CoverageValidationResult } from '../../../../services/character-onboarding/CoverageValidator';
import {
  generateQuestionsWithModel,
  formatQuestionsAsText
} from '../../../../services/character-onboarding/QuestionGenerator';
import {
  ONBOARDING_STAGE,
  getFieldsForStage
} from '../../../../services/character-onboarding/schemas';
import type { ModelGateway } from '../../../../services/ModelGateway';
import { saveCheckpoint } from './load-checkpoint';
import { createLogger } from '../../../../infrastructure/logging/logger';

const log = createLogger('OnboardingGraph:generate_questions');

export function createGenerateQuestionsNode(gateway: ModelGateway) {
  return async function generateQuestionsNode(
    state: OnboardingStateType
  ): Promise<OnboardingStateUpdate> {
    log.info('generating questions', {
      fields: {
        stage: state.currentStage,
        targetStage: state.targetStage,
        traceId: state.traceId
      }
    });

    if (!state.draft) {
      log.error('no draft present', { fields: { traceId: state.traceId } });
      return {
        currentStep: 'finish',
        phase: 'error',
        errorReason: 'no-draft',
        errors: [...state.errors, 'No draft present in generate_questions']
      };
    }

    // P1: targetStage 存在时，为该阶段所有字段生成卡片（局部修改）
    // 不依赖 CoverageValidator 的 nextQuestionGroup，而是用 getFieldsForStage 获取全部字段
    // 这样用户可以重新回答该阶段的任何字段，不清空其他阶段的数据
    if (state.targetStage !== null && state.targetStage !== ONBOARDING_STAGE.REVIEW) {
      const targetFields = getFieldsForStage(state.targetStage);
      if (targetFields.length === 0) {
        log.warn('targetStage has no fields, redirecting to build_summary', {
          fields: { targetStage: state.targetStage, traceId: state.traceId }
        });
        return {
          currentStep: 'build_summary',
          currentStage: ONBOARDING_STAGE.REVIEW,
          targetStage: null
        };
      }

      // 构造一个 CoverageValidationResult，让 QuestionGenerator 为该阶段全部字段生成卡片
      const targetCoverage: CoverageValidationResult = {
        currentStage: state.targetStage,
        missingFields: targetFields,
        ambiguousFields: [],
        completionProgress: state.completionProgress,
        nextQuestionGroup: targetFields
      };

      // targetStage 局部修改路径：为该阶段全部字段生成卡片，不受 MAX_QUESTIONS_PER_BATCH=4 上限约束
      const result = await generateQuestionsWithModel(
        targetCoverage, gateway, state.traceId,
        { maxQuestions: targetFields.length }
      );
      if (!result.ok || result.questions.length === 0) {
        log.warn('targetStage question generation failed', {
          fields: { reason: result.reason, traceId: state.traceId }
        });
        return {
          currentStep: 'finish',
          phase: 'error',
          errorReason: result.reason ?? 'question-generation-failed',
          errors: [...state.errors, `Question generation failed: ${result.reason ?? 'unknown'}`]
        };
      }

      const questionText = formatQuestionsAsText(result.questions);
      log.info('targetStage questions generated', {
        fields: {
          count: result.questions.length,
          targetStage: state.targetStage,
          usedModel: result.usedModel,
          traceId: state.traceId
        }
      });

      // 更新草稿阶段（不清空其他阶段数据）
      const updatedDraft = {
        ...state.draft,
        stage: result.stage,
        updatedAt: new Date().toISOString()
      };

      // 保存 checkpoint（等待用户输入）
      const stateForCheckpoint: OnboardingStateType = {
        ...state,
        draft: updatedDraft,
        currentStage: result.stage,
        currentQuestions: result.questions,
        previousQuestions: [...state.previousQuestions, questionText],
        targetStage: null // 消费后清除
      };
      saveCheckpoint(stateForCheckpoint, 'awaiting_user_answer');

      return {
        currentStep: 'generate_questions',
        currentStage: result.stage,
        draft: updatedDraft,
        currentQuestions: result.questions,
        previousQuestions: [...state.previousQuestions, questionText],
        awaitingUserInput: true,
        pendingQuestion: questionText,
        phase: 'collecting',
        completionProgress: state.completionProgress,
        checkpointReason: 'awaiting_user_answer',
        targetStage: null // 消费后清除
      };
    }

    // 计算下一组问题
    const coverage = validateCoverage(state.draft);

    // 已完成所有阶段 → 不应该到这个节点（determine_stage 应该路由到 build_summary）
    if (coverage.currentStage === ONBOARDING_STAGE.REVIEW) {
      log.warn('reached generate_questions in review stage, redirecting to build_summary', {
        fields: { traceId: state.traceId }
      });
      return {
        currentStep: 'build_summary',
        currentStage: ONBOARDING_STAGE.REVIEW,
        completionProgress: coverage.completionProgress,
        targetStage: null // 防御性清除
      };
    }

    // W7：使用模型生成自然问题，失败时回退固定模板
    const result = await generateQuestionsWithModel(coverage, gateway, state.traceId);
    if (!result.ok || result.questions.length === 0) {
      log.warn('question generation failed, using empty questions', {
        fields: { reason: result.reason, traceId: state.traceId }
      });
      return {
        currentStep: 'finish',
        phase: 'error',
        errorReason: result.reason ?? 'question-generation-failed',
        errors: [...state.errors, `Question generation failed: ${result.reason ?? 'unknown'}`]
      };
    }

    const questionText = formatQuestionsAsText(result.questions);
    log.info('questions generated', {
      fields: {
        count: result.questions.length,
        stage: result.stage,
        usedModel: result.usedModel,
        traceId: state.traceId
      }
    });

    // 更新草稿阶段
    const updatedDraft = {
      ...state.draft,
      stage: result.stage,
      updatedAt: new Date().toISOString()
    };

    // 保存 checkpoint（等待用户输入）
    const stateForCheckpoint: OnboardingStateType = {
      ...state,
      draft: updatedDraft,
      currentStage: result.stage,
      currentQuestions: result.questions,
      previousQuestions: [...state.previousQuestions, questionText]
    };
    saveCheckpoint(stateForCheckpoint, 'awaiting_user_answer');

    return {
      currentStep: 'generate_questions',
      currentStage: result.stage,
      draft: updatedDraft,
      currentQuestions: result.questions,
      previousQuestions: [...state.previousQuestions, questionText],
      awaitingUserInput: true,
      pendingQuestion: questionText,
      phase: 'collecting',
      completionProgress: coverage.completionProgress,
      checkpointReason: 'awaiting_user_answer'
    };
  };
}
