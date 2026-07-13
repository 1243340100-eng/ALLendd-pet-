/**
 * OnboardingGraph 定义（V8 重构版）。
 *
 * 流程：
 * load_installation_state
 * → validate_character_pack
 * → load_checkpoint
 * → [userAction=answer] extract_answer → merge_draft → validate_coverage
 * → [userAction=start/feedback/confirm] determine_stage
 * → generate_questions (END, awaiting user input)
 *   或 build_summary → review (END, awaiting user confirmation)
 *   或 compile_profile → configure_proactive_policy
 *     → configure_model_mode → persist_and_lock → activate_character → finish
 *
 * 每次 IPC 只执行一轮 Graph，不在内存中长期等待用户输入。
 * SQLite checkpoint 是权威来源。
 */
import { StateGraph, START, END } from '@langchain/langgraph';
import { OnboardingState } from './state';
import type { OnboardingStateType, OnboardingStateUpdate } from './state';
import type { CharacterPackManager } from '../../../services/CharacterPackManager';
import type { ModelGateway } from '../../../services/ModelGateway';
import { loadInstallationState } from './nodes/load-installation-state';
import { createValidateCharacterPackNode } from './nodes/validate-character-pack';
import { loadCheckpoint } from './nodes/load-checkpoint';
import { determineStage } from './nodes/determine-stage';
import { createGenerateQuestionsNode } from './nodes/generate-questions';
import { createExtractAnswerNode } from './nodes/extract-answer';
import { mergeDraft } from './nodes/merge-draft';
import { validateCoverageNode } from './nodes/validate-coverage';
import { buildSummaryNode } from './nodes/build-summary';
import { review } from './nodes/review';
import { compileProfileNode } from './nodes/compile-profile';
import { persistAndLock } from './nodes/persist-and-lock';
import { configureProactivePolicy } from './nodes/configure-proactive-policy';
import { configureModelMode } from './nodes/configure-model-mode';
import { activateCharacter } from './nodes/activate-character';
import { finish } from './nodes/finish';
import { createLogger } from '../../../infrastructure/logging/logger';

const log = createLogger('OnboardingGraph');

/** 创建 OnboardingGraph */
export function createOnboardingGraph(
  packManager: CharacterPackManager,
  gateway: ModelGateway
) {
  const validateCharacterPack = createValidateCharacterPackNode(packManager);
  const extractAnswerNode = createExtractAnswerNode(gateway);
  const generateQuestionsNode = createGenerateQuestionsNode(gateway);

  const graph = new StateGraph(OnboardingState)
    .addNode('load_installation_state', loadInstallationState)
    .addNode('validate_character_pack', validateCharacterPack)
    .addNode('load_checkpoint', loadCheckpoint)
    .addNode('determine_stage', determineStage)
    .addNode('generate_questions', generateQuestionsNode)
    .addNode('extract_answer', extractAnswerNode)
    .addNode('merge_draft', mergeDraft)
    .addNode('validate_coverage', validateCoverageNode)
    .addNode('build_summary', buildSummaryNode)
    .addNode('review', review)
    .addNode('compile_profile', compileProfileNode)
    .addNode('persist_and_lock', persistAndLock)
    .addNode('configure_proactive_policy', configureProactivePolicy)
    .addNode('configure_model_mode', configureModelMode)
    .addNode('activate_character', activateCharacter)
    .addNode('finish', finish)

    // START → load_installation_state
    .addEdge(START, 'load_installation_state')

    // load_installation_state → finish (已完成) | validate_character_pack
    .addConditionalEdges('load_installation_state', (state) => {
      if (state.currentStep === 'finish') return 'finish';
      return 'validate_character_pack';
    }, {
      finish: 'finish',
      validate_character_pack: 'validate_character_pack'
    })

    // validate_character_pack → END (失败) | load_checkpoint
    .addConditionalEdges('validate_character_pack', (state) => {
      if (state.errors.length > 0 || !state.characterId) return 'fail';
      return 'continue';
    }, {
      fail: END,
      continue: 'load_checkpoint'
    })

    // load_checkpoint → finish (error/stale-revision) | extract_answer (answer/feedback) | determine_stage
    // B1: stale revision 或其他错误状态必须直接结束，不进入 extract_answer/determine_stage
    // P1: feedback + targetStage → determine_stage（确定性地路由到 generate_questions，不调用模型）
    .addConditionalEdges('load_checkpoint', (state) => {
      if (state.currentStep === 'finish' || state.phase === 'error') {
        return 'finish';
      }
      if (state.userAction === 'answer' && state.draft !== null) {
        return 'extract_answer';
      }
      if (state.userAction === 'feedback' && state.draft !== null) {
        // targetStage 存在时走确定性路径（determine_stage → generate_questions）
        // targetStage 不存在时走模型提取路径（extract_answer → merge_draft → validate_coverage）
        if (state.targetStage !== null) {
          return 'determine_stage';
        }
        return 'extract_answer';
      }
      return 'determine_stage';
    }, {
      finish: 'finish',
      extract_answer: 'extract_answer',
      determine_stage: 'determine_stage'
    })

    // determine_stage → compile_profile | build_summary | generate_questions | finish
    .addConditionalEdges('determine_stage', (state) => {
      switch (state.currentStep) {
        case 'compile_profile': return 'compile_profile';
        case 'build_summary': return 'build_summary';
        case 'generate_questions': return 'generate_questions';
        case 'finish': return 'finish';
        default: return 'finish';
      }
    }, {
      compile_profile: 'compile_profile',
      build_summary: 'build_summary',
      generate_questions: 'generate_questions',
      finish: 'finish'
    })

    // extract_answer → merge_draft (成功) | generate_questions (失败) | END
    .addConditionalEdges('extract_answer', (state) => {
      if (state.currentStep === 'merge_draft') return 'merge_draft';
      if (state.currentStep === 'generate_questions') return 'generate_questions';
      if (state.currentStep === 'finish') return 'finish';
      return 'finish';
    }, {
      merge_draft: 'merge_draft',
      generate_questions: 'generate_questions',
      finish: 'finish'
    })

    // merge_draft → validate_coverage
    .addEdge('merge_draft', 'validate_coverage')

    // validate_coverage → build_summary | generate_questions | finish
    .addConditionalEdges('validate_coverage', (state) => {
      switch (state.currentStep) {
        case 'build_summary': return 'build_summary';
        case 'generate_questions': return 'generate_questions';
        case 'finish': return 'finish';
        default: return 'finish';
      }
    }, {
      build_summary: 'build_summary',
      generate_questions: 'generate_questions',
      finish: 'finish'
    })

    // generate_questions → END (awaiting user input)
    .addConditionalEdges('generate_questions', (state) => {
      if (state.awaitingUserInput) return 'await_input';
      // 错误情况
      return 'finish';
    }, {
      await_input: END,
      finish: 'finish'
    })

    // build_summary → review
    .addEdge('build_summary', 'review')

    // review → END (awaiting user confirmation)
    .addConditionalEdges('review', (state) => {
      if (state.awaitingUserInput) return 'await_input';
      return 'finish';
    }, {
      await_input: END,
      finish: 'finish'
    })

    // compile_profile → configure_proactive_policy (W3: 调整流程，让 persist_and_lock 能在单一事务中写入所有数据)
    .addConditionalEdges('compile_profile', (state) => {
      if (state.currentStep === 'configure_proactive_policy') return 'configure_proactive_policy';
      if (state.currentStep === 'review') return 'review';
      return 'finish';
    }, {
      configure_proactive_policy: 'configure_proactive_policy',
      review: 'review',
      finish: 'finish'
    })

    // configure_proactive_policy → configure_model_mode
    .addEdge('configure_proactive_policy', 'configure_model_mode')
    // configure_model_mode → persist_and_lock (W3: 现在持久化节点接收完整的 policy/mode 数据)
    .addEdge('configure_model_mode', 'persist_and_lock')

    // persist_and_lock → activate_character (成功) | review (失败)
    .addConditionalEdges('persist_and_lock', (state) => {
      if (state.currentStep === 'activate_character') return 'activate_character';
      if (state.currentStep === 'review') return 'review';
      return 'finish';
    }, {
      activate_character: 'activate_character',
      review: 'review',
      finish: 'finish'
    })

    // activate_character → finish
    .addEdge('activate_character', 'finish')
    // finish → END
    .addEdge('finish', END);

  return graph.compile();
}

/**
 * OnboardingGraph 运行器。
 * 每次 IPC 调用通过 run() 执行一轮 Graph。
 * Graph 在 generate_questions 或 review 节点暂停，等待下一次 IPC 调用。
 */
export class OnboardingGraphRunner {
  private compiledGraph: ReturnType<typeof createOnboardingGraph>;
  private packManager: CharacterPackManager;
  private gateway: ModelGateway;

  constructor(packManager: CharacterPackManager, gateway: ModelGateway) {
    this.packManager = packManager;
    this.gateway = gateway;
    this.compiledGraph = createOnboardingGraph(packManager, gateway);
  }

  /**
   * 运行一轮 Onboarding Graph。
   *
   * 调用方需要根据 state.userAction 准备初始状态：
   * - 'start'：首次启动，state.draft=null
   * - 'answer'：用户提交答案，state.lastUserInput=用户输入，state.draft=null（从 checkpoint 恢复）
   * - 'feedback'：用户在 review 阶段返回修改，state.draft=null（从 checkpoint 恢复）
   * - 'confirm'：用户确认摘要，state.draft=null（从 checkpoint 恢复）
   *
   * Graph 会在以下情况暂停（返回 awaitingUserInput=true）：
   * - generate_questions：等待用户提交答案
   * - review：等待用户确认或返回修改
   */
  async run(initialState: OnboardingStateType): Promise<OnboardingStateType> {
    log.info('running onboarding graph', {
      fields: {
        userAction: initialState.userAction,
        phase: initialState.phase,
        traceId: initialState.traceId
      }
    });

    // 每次 IPC 调用作为独立 turn，重置模型调用计数
    // 防止跨轮累积触发 maxModelCallsPerTurn 上限（onboarding 至少需要 4 次模型调用）
    this.gateway.beginTurn(initialState.traceId);
    let result: unknown;
    try {
      result = await this.compiledGraph.invoke(initialState);
    } finally {
      this.gateway.endTurn();
    }
    const finalState = result as OnboardingStateType;

    if (finalState.awaitingUserInput) {
      log.info('onboarding paused, awaiting user input', {
        fields: {
          currentStep: finalState.currentStep,
          phase: finalState.phase,
          pendingQuestionLength: finalState.pendingQuestion.length,
          traceId: initialState.traceId
        }
      });
    } else if (finalState.isCompleted) {
      log.info('onboarding completed', {
        fields: {
          userId: finalState.userId,
          characterId: finalState.characterId,
          traceId: initialState.traceId
        }
      });
    } else if (finalState.phase === 'error') {
      log.warn('onboarding ended in error state', {
        fields: {
          errorReason: finalState.errorReason,
          errors: finalState.errors,
          traceId: initialState.traceId
        }
      });
    }

    return finalState;
  }

  /** 获取 packManager（供调用方使用） */
  getPackManager(): CharacterPackManager {
    return this.packManager;
  }

  /** 获取 gateway（供调用方使用） */
  getGateway(): ModelGateway {
    return this.gateway;
  }
}

// 重新导出旧接口的兼容函数（供现有测试使用）
export { mergePersonaWithUserCustomizations, detectLockedFieldOverride } from './nodes/build-persona-config';
