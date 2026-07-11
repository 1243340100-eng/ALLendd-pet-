/**
 * PlanningGraph 定义和 Runner。
 *
 * 流程：
 * START → load_planning_context → agent_decide → execute_tool → build_response → persist_checkpoint → END
 *
 * Runner 负责：
 * - checkpoint 恢复（从数据库加载未消费的 planning checkpoint）
 * - 合并状态（保留已有草稿和消息历史）
 * - 调用 modelGateway.beginTurn() / endTurn()
 * - 错误恢复（Graph 失败不卡死）
 */
import { StateGraph, START, END } from '@langchain/langgraph';
import { PlanningState, createInitialPlanningState } from './state';
import type { PlanningStateType, PlanningResponseDTO } from './state';
import { createLoadPlanningContextNode } from './nodes/load-planning-context';
import { createAgentDecideNode } from './nodes/agent-decide';
import { createExecuteToolNode } from './nodes/execute-tool';
import { createBuildResponseNode } from './nodes/build-response';
import { createPersistCheckpointNode } from './nodes/persist-checkpoint';
import { checkpointRepository } from '../../../infrastructure/database/repositories/checkpoint-repository';
import type { ModelGateway } from '../../../services/ModelGateway';
import type { TimeService } from '../../../services/TimeService';
import type { UserContextService } from '../../../services/UserContextService';
import { createLogger } from '../../../infrastructure/logging/logger';

const log = createLogger('PlanningGraph');

/** PlanningGraph 依赖 */
export interface PlanningGraphDeps {
  modelGateway: ModelGateway;
  timeService: TimeService;
  userContextService: UserContextService;
}

/** 创建 PlanningGraph */
export function createPlanningGraph(deps: PlanningGraphDeps) {
  const loadContext = createLoadPlanningContextNode({
    timeService: deps.timeService,
    userContextService: deps.userContextService
  });
  const agentDecide = createAgentDecideNode({
    modelGateway: deps.modelGateway
  });
  const executeTool = createExecuteToolNode();
  const buildResponse = createBuildResponseNode();
  const persistCheckpoint = createPersistCheckpointNode();

  const graph = new StateGraph(PlanningState)
    .addNode('load_planning_context', loadContext)
    .addNode('agent_decide', agentDecide)
    .addNode('execute_tool', executeTool)
    .addNode('build_response', buildResponse)
    .addNode('persist_checkpoint', persistCheckpoint)
    // 主流程边
    .addEdge(START, 'load_planning_context')
    .addEdge('load_planning_context', 'agent_decide')
    .addEdge('agent_decide', 'execute_tool')
    .addEdge('execute_tool', 'build_response')
    .addEdge('build_response', 'persist_checkpoint')
    .addEdge('persist_checkpoint', END);

  return graph.compile();
}

/** PlanningGraph 运行器 */
export class PlanningGraphRunner {
  private compiledGraph: ReturnType<typeof createPlanningGraph>;
  private modelGateway: ModelGateway;

  constructor(deps: PlanningGraphDeps) {
    this.modelGateway = deps.modelGateway;
    this.compiledGraph = createPlanningGraph(deps);
  }

  /** 运行规划 */
  async run(initialState: PlanningStateType): Promise<PlanningStateType> {
    log.info('running planning graph', {
      traceId: initialState.traceId,
      fields: {
        userInput: initialState.userInput.slice(0, 100),
        isConfirmation: initialState.isConfirmation,
        hasDraft: !!initialState.currentDraft
      }
    });

    // checkpoint 恢复：检查是否有未消费的 planning checkpoint
    const activeCheckpoint = checkpointRepository.getActive('planning');
    let state = initialState;
    if (activeCheckpoint) {
      try {
        const saved = JSON.parse(activeCheckpoint.state_json) as Partial<PlanningStateType>;
        // 合并：保留已有草稿、消息历史和草案版本
        state = {
          ...initialState,
          messages: saved.messages && saved.messages.length > 0
            ? [...saved.messages, ...initialState.messages]
            : initialState.messages,
          currentDraft: initialState.currentDraft ?? saved.currentDraft ?? null,
          draftVersion: saved.draftVersion ?? initialState.draftVersion,
          userConfirmed: initialState.userConfirmed || saved.userConfirmed || false,
          checkpointId: activeCheckpoint.id
        };
        // 不立即消费 checkpoint，等 persist_checkpoint 节点决定
        // 如果本轮产生新的 checkpoint，旧的会被覆盖；如果发布成功，旧的会被消费
        log.info('checkpoint resumed', {
          traceId: initialState.traceId,
          fields: {
            checkpointId: activeCheckpoint.id,
            reason: activeCheckpoint.reason,
            savedMessageCount: saved.messages?.length ?? 0,
            savedDraftVersion: saved.draftVersion
          }
        });
      } catch (error) {
        log.warn('checkpoint resume failed, starting fresh', {
          fields: { error: (error as Error)?.message }
        });
        // 恢复失败：消费旧 checkpoint，正常继续
        checkpointRepository.consume(activeCheckpoint.id);
      }
    }

    // 开始模型调用轮次
    this.modelGateway.beginTurn(state.traceId);

    try {
      const result = await this.compiledGraph.invoke(state);
      const finalState = result as PlanningStateType;

      log.info('planning graph completed', {
        traceId: state.traceId,
        fields: {
          actionType: finalState.agentAction?.type,
          published: finalState.published,
          draftVersion: finalState.draftVersion,
          modelCallCount: finalState.modelCallCount,
          errorCount: finalState.errors.length
        }
      });

      return finalState;
    } catch (error) {
      log.error('planning graph failed', {
        traceId: state.traceId,
        fields: { error: (error as Error)?.message }
      });
      // Graph 失败不会导致卡死：返回安全后备
      return {
        ...state,
        errors: [...state.errors, {
          code: 'unknown' as const,
          message: (error as Error)?.message ?? 'Unknown error',
          node: 'planning_graph',
          recovered: false,
          occurredAt: new Date().toISOString()
        }],
        responseDTO: {
          ok: false,
          reason: (error as Error)?.message ?? 'Planning graph failed',
          message: '抱歉，规划时遇到了问题，请稍后再试。'
        }
      };
    } finally {
      this.modelGateway.endTurn();
    }
  }

  /**
   * 便捷方法：提交用户消息并获取响应。
   * 供 integration.ts / main.js 调用。
   */
  async submitMessage(params: {
    userId: string;
    characterId: string;
    userInput: string;
    isConfirmation?: boolean;
    isManualEdit?: boolean;
  }): Promise<PlanningResponseDTO> {
    const initialState = createInitialPlanningState(params);
    const result = await this.run(initialState);
    return result.responseDTO ?? { ok: false, reason: 'No response from planning graph' };
  }
}
