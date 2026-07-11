/**
 * OnboardingGraph 定义。
 * 对应架构计划第 5.1 节。
 *
 * 流程：
 * load_installation_state
 * → validate_character_pack
 * → collect_user_preferences
 * → build_persona_config
 * → configure_proactive_policy
 * → configure_model_mode
 * → save_onboarding_result
 * → activate_character
 * → finish
 */
import { StateGraph, START, END } from '@langchain/langgraph';
import { OnboardingState } from './state';
import type { OnboardingStateType, OnboardingStateUpdate, UserPreferences } from './state';
import { CharacterPackManager } from '../../../services/CharacterPackManager';
import { loadInstallationState } from './nodes/load-installation-state';
import { createValidateCharacterPackNode } from './nodes/validate-character-pack';
import { collectUserPreferences, applyUserPreferences } from './nodes/collect-user-preferences';
import { buildPersonaConfig } from './nodes/build-persona-config';
import { configureProactivePolicy } from './nodes/configure-proactive-policy';
import { configureModelMode } from './nodes/configure-model-mode';
import { saveOnboardingResult } from './nodes/save-onboarding-result';
import { activateCharacter } from './nodes/activate-character';
import { finish } from './nodes/finish';
import { createLogger } from '../../../infrastructure/logging/logger';

const log = createLogger('OnboardingGraph');

/** 创建 OnboardingGraph */
export function createOnboardingGraph(packManager: CharacterPackManager) {
  const validateCharacterPack = createValidateCharacterPackNode(packManager);

  const graph = new StateGraph(OnboardingState)
    .addNode('load_installation_state', loadInstallationState)
    .addNode('validate_character_pack', validateCharacterPack)
    .addNode('collect_user_preferences', collectUserPreferences)
    .addNode('build_persona_config', buildPersonaConfig)
    .addNode('configure_proactive_policy', configureProactivePolicy)
    .addNode('configure_model_mode', configureModelMode)
    .addNode('save_onboarding_result', saveOnboardingResult)
    .addNode('activate_character', activateCharacter)
    .addNode('finish', finish)
    .addEdge(START, 'load_installation_state')
    .addEdge('load_installation_state', 'validate_character_pack')
    // 条件边：validate_character_pack 失败（errors 或 characterId 为空）时直接结束
    .addConditionalEdges('validate_character_pack', (state) => {
      if (state.errors.length > 0 || !state.characterId) {
        return 'fail';
      }
      return 'continue';
    }, {
      fail: END,
      continue: 'collect_user_preferences'
    })
    // 条件边：collect_user_preferences 之后，如果 awaitingUserInput=true 则结束（等待用户输入），
    // 否则继续 build_persona_config
    .addConditionalEdges('collect_user_preferences', (state) => {
      if (state.awaitingUserInput) {
        return 'await_input';
      }
      return 'continue';
    }, {
      await_input: END,
      continue: 'build_persona_config'
    })
    // 条件边：build_persona_config 失败（persona 为空）时直接结束
    .addConditionalEdges('build_persona_config', (state) => {
      if (!state.persona) {
        return 'fail';
      }
      return 'continue';
    }, {
      fail: END,
      continue: 'configure_proactive_policy'
    })
    .addEdge('configure_proactive_policy', 'configure_model_mode')
    .addEdge('configure_model_mode', 'save_onboarding_result')
    .addEdge('save_onboarding_result', 'activate_character')
    .addEdge('activate_character', 'finish')
    .addEdge('finish', END);

  return graph.compile();
}

/** OnboardingGraph 运行器 */
export class OnboardingGraphRunner {
  private compiledGraph: ReturnType<typeof createOnboardingGraph>;
  private packManager: CharacterPackManager;

  constructor(packManager: CharacterPackManager) {
    this.packManager = packManager;
    this.compiledGraph = createOnboardingGraph(packManager);
  }

  /**
   * 运行 Onboarding。
   * 若 collect_user_preferences 设置了 awaitingUserInput，图会在条件边处停止（END），
   * 调用方应检查返回的 state.awaitingUserInput；为 true 时等待用户输入，
   * 之后调用 resumeWithPreferences 继续。
   */
  async run(initialState: OnboardingStateType): Promise<OnboardingStateType> {
    log.info('running onboarding graph');
    const result = await this.compiledGraph.invoke(initialState);
    const finalState = result as OnboardingStateType;

    if (finalState.awaitingUserInput) {
      log.info('onboarding paused, awaiting user input', {
        fields: { pendingQuestion: finalState.pendingQuestion }
      });
    }
    return finalState;
  }

  /**
   * 在中断后恢复并应用用户偏好，然后继续运行剩余节点。
   * 流程：applyUserPreferences → 重新运行 graph（此时 awaitingUserInput=false 会直接继续）。
   */
  async resumeWithPreferences(
    state: OnboardingStateType,
    preferences: Partial<UserPreferences>
  ): Promise<OnboardingStateType> {
    log.info('resuming onboarding with user preferences');

    // 应用用户偏好：清除 awaitingUserInput，设置 preferences
    const update = applyUserPreferences(state, preferences);
    const resumedState: OnboardingStateType = { ...state, ...update };

    // 重新运行：此时 collect_user_preferences 节点检测到 preferences 已存在，
    // 会直接返回 currentStep='build_persona_config'，条件边走 'continue' 分支继续后续流程。
    const result = await this.compiledGraph.invoke(resumedState);
    return result as OnboardingStateType;
  }

  /**
   * 仅应用用户偏好（不重新运行 graph）。
   * 供需要分步控制的调用方使用。
   */
  applyPreferencesAndResume(
    state: OnboardingStateType,
    preferences: Partial<UserPreferences>
  ): OnboardingStateUpdate {
    return applyUserPreferences(state, preferences);
  }
}
