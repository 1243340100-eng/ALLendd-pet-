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
import type { PlanningStateType, PlanningResponseDTO, PlanningTrace } from './state';
import { createLoadPlanningContextNode } from './nodes/load-planning-context';
import { createAgentDecideNode } from './nodes/agent-decide';
import { createExecuteToolNode } from './nodes/execute-tool';
import { createBuildResponseNode } from './nodes/build-response';
import { createPersistCheckpointNode } from './nodes/persist-checkpoint';
import { sanitizePlanningTraceText } from './sanitize';
import { checkpointRepository } from '../../../infrastructure/database/repositories/checkpoint-repository';
import { planRepository } from '../../../infrastructure/database/repositories/plan-repository';
import type { ModelGateway } from '../../../services/ModelGateway';
import type { TimeService } from '../../../services/TimeService';
import type { UserContextService } from '../../../services/UserContextService';
import { createLogger } from '../../../infrastructure/logging/logger';

const log = createLogger('PlanningGraph');

/** 修复 5：构建 scope_key，按 userId + characterId 隔离 checkpoint */
function buildScopeKey(userId: string, characterId: string): string {
  return `${userId}:${characterId}`;
}

/** PlanningGraph 依赖 */
export interface PlanningGraphDeps {
  modelGateway: ModelGateway;
  timeService: TimeService;
  userContextService: UserContextService;
}

/** 最大模型调用次数（受限工具循环） */
const MAX_MODEL_CALLS_FOR_PLANNING = 3;
/** 最大 Graph 迭代次数（独立于 modelCallCount，所有路径的通用循环上限） */
const MAX_GRAPH_ITERATIONS = 6;

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
    // 修复 4：手动编辑走 load_context → execute_tool → build_response → persist_checkpoint
    // 不调用模型，但使用 TimeService 和正式 Tool 节点
    .addConditionalEdges('load_planning_context', (state: PlanningStateType) => {
      if (state.isManualEdit) {
        return 'execute_tool';
      }
      return 'agent_decide';
    })
    .addEdge('agent_decide', 'execute_tool')
    // 阻断 1：受限工具循环 - 使用 graphIterationCount 作为通用循环上限
    // 确认发布失败不调用模型，modelCallCount 一直为 0，不能作为唯一循环限制
    .addConditionalEdges('execute_tool', (state: PlanningStateType) => {
      // 手动编辑不走回环（无论成功失败都直接 build_response）
      if (state.isManualEdit) {
        return 'build_response';
      }
      // 确认发布失败：直接进入 build_response，不重试同一个确认动作
      // isConfirmation=true 时 publish_plan 失败（如任务变成过去时间），不调用模型所以 modelCallCount=0
      if (state.isConfirmation && state.toolExecutionStatus === 'failed') {
        return 'build_response';
      }
      // 普通模型工具调用失败：在 modelCallCount 和 graphIterationCount 双重限制内允许自动修正
      if (state.toolExecutionStatus === 'failed'
        && state.modelCallCount < MAX_MODEL_CALLS_FOR_PLANNING
        && state.graphIterationCount < MAX_GRAPH_ITERATIONS) {
        return 'agent_decide';
      }
      // succeeded、idle 或超过上限：直接 build_response
      return 'build_response';
    })
    .addEdge('build_response', 'persist_checkpoint')
    .addEdge('persist_checkpoint', END);

  return graph.compile();
}

/** PlanningGraph 运行器 */
export class PlanningGraphRunner {
  private compiledGraph: ReturnType<typeof createPlanningGraph>;
  private modelGateway: ModelGateway;
  /** 最近一轮 Planning Trace（供 IPC 查询） */
  private lastTrace: PlanningTrace | null = null;

  constructor(deps: PlanningGraphDeps) {
    this.modelGateway = deps.modelGateway;
    this.compiledGraph = createPlanningGraph(deps);
  }

  /** 获取最近一轮 Planning Trace */
  getLastTrace(): PlanningTrace | null {
    return this.lastTrace;
  }

  /** 运行规划 */
  async run(initialState: PlanningStateType): Promise<PlanningStateType> {
    log.info('running planning graph', {
      traceId: initialState.traceId,
      fields: {
        userInput: sanitizePlanningTraceText(initialState.userInput, 100),
        isConfirmation: initialState.isConfirmation,
        hasDraft: !!initialState.currentDraft
      }
    });

    // 修复 5：checkpoint 按 userId + characterId 隔离
    const scopeKey = buildScopeKey(initialState.userId, initialState.characterId);
    const activeCheckpoint = checkpointRepository.getActiveByScope('planning', scopeKey);
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
          awaitingConfirmation: saved.awaitingConfirmation ?? false,
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

      // 保存最近一轮 trace
      this.lastTrace = finalState.planningTrace ?? null;

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

  /**
   * 手动编辑草案（不调用模型）。
   * 修复 4：通过正式 LangGraph 执行，走 load_context → execute_tool → build_response → persist_checkpoint。
   * 不调用模型，但使用 TimeService 和正式 Tool 节点。
   */
  async submitManualEdit(params: {
    userId: string;
    characterId: string;
    planId: string;
    agentAction: import('./state').AgentAction;
  }): Promise<PlanningResponseDTO> {
    const initialState = createInitialPlanningState({
      userId: params.userId,
      characterId: params.characterId,
      userInput: '',
      isManualEdit: true
    });
    // 直接设置 agentAction，跳过模型调用
    initialState.agentAction = params.agentAction;

    log.info('running planning graph (manual edit, no model call)', {
      traceId: initialState.traceId,
      fields: {
        actionType: params.agentAction.type,
        planId: params.planId
      }
    });

    // 修复 5：checkpoint 按 userId + characterId 隔离
    const scopeKey = buildScopeKey(params.userId, params.characterId);
    const activeCheckpoint = checkpointRepository.getActiveByScope('planning', scopeKey);
    let state = initialState;
    if (activeCheckpoint) {
      try {
        const saved = JSON.parse(activeCheckpoint.state_json) as Partial<PlanningStateType>;
        state = {
          ...initialState,
          messages: saved.messages && saved.messages.length > 0
            ? [...saved.messages]
            : initialState.messages,
          currentDraft: saved.currentDraft ?? null,
          draftVersion: saved.draftVersion ?? initialState.draftVersion,
          awaitingConfirmation: saved.awaitingConfirmation ?? false,
          checkpointId: activeCheckpoint.id
        };
      } catch {
        checkpointRepository.consume(activeCheckpoint.id);
      }
    }

    // 如果 checkpoint 中没有 currentDraft，尝试从数据库加载
    if (!state.currentDraft) {
      try {
        const { toPlanDraft } = require('./tools');
        const draftPlan = planRepository.getDraftPlan();
        if (draftPlan && draftPlan.id === params.planId) {
          state.currentDraft = toPlanDraft(
            { id: draftPlan.id, date: draftPlan.date, tasks: draftPlan.tasks },
            draftPlan.draft_version ?? 1
          );
          state.draftVersion = draftPlan.draft_version ?? 1;
        }
      } catch (error) {
        log.warn('failed to load draft from DB for manual edit', {
          fields: { error: (error as Error)?.message, planId: params.planId }
        });
      }
    }

    // 手动编辑不调用模型，不需要 beginTurn/endTurn
    try {
      const result = await this.compiledGraph.invoke(state);
      const finalState = result as PlanningStateType;
      // 保存最近一轮 trace（手动编辑也生成 trace，modelCallCount=0）
      this.lastTrace = finalState.planningTrace ?? null;
      return finalState.responseDTO ?? { ok: false, reason: 'No response from manual edit' };
    } catch (error) {
      log.error('manual edit failed', {
        traceId: state.traceId,
        fields: { error: (error as Error)?.message }
      });
      return {
        ok: false,
        reason: (error as Error)?.message ?? 'Manual edit failed',
        message: '手动修改失败，请重试。'
      };
    }
  }

  /**
   * 获取当前规划状态（供 planning:start 恢复用）。
   * 返回持久化的 messages、phase、awaitingConfirmation。
   * 修复 5：按 userId + characterId 隔离。
   */
  getPlanningState(userId?: string, characterId?: string): {
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
    phase: 'idle' | 'asking' | 'drafting' | 'awaiting_confirmation' | 'published';
    awaitingConfirmation: boolean;
    currentDraft: import('./state').PlanDraft | null;
  } {
    // 修复 5：按 userId + characterId 隔离
    const scopeKey = userId && characterId ? buildScopeKey(userId, characterId) : '';
    const activeCheckpoint = scopeKey
      ? checkpointRepository.getActiveByScope('planning', scopeKey)
      : checkpointRepository.getActive('planning');
    if (!activeCheckpoint) {
      // 没有 checkpoint，检查是否有 draft 计划
      const draft = planRepository.getDraftPlan();
      if (draft) {
        return {
          messages: [],
          phase: 'drafting',
          awaitingConfirmation: false,
          currentDraft: null
        };
      }
      return {
        messages: [],
        phase: 'idle',
        awaitingConfirmation: false,
        currentDraft: null
      };
    }

    try {
      const saved = JSON.parse(activeCheckpoint.state_json) as Partial<PlanningStateType>;
      const messages = saved.messages ?? [];
      const awaitingConfirmation = activeCheckpoint.reason === 'awaiting_confirmation';
      const phase: 'idle' | 'asking' | 'drafting' | 'awaiting_confirmation' | 'published' =
        activeCheckpoint.reason === 'ask_clarification' ? 'asking' :
        activeCheckpoint.reason === 'awaiting_confirmation' ? 'awaiting_confirmation' :
        activeCheckpoint.reason === 'draft_pending' ? 'drafting' :
        'idle';

      let currentDraft: import('./state').PlanDraft | null = null;
      if (saved.currentDraft) {
        currentDraft = saved.currentDraft;
      } else {
        const draft = planRepository.getDraftPlan();
        if (draft) {
          const { toPlanDraft } = require('./tools');
          currentDraft = toPlanDraft(
            { id: draft.id, date: draft.date, tasks: draft.tasks },
            draft.draft_version ?? 1
          );
        }
      }

      return {
        messages,
        phase,
        awaitingConfirmation,
        currentDraft
      };
    } catch {
      return {
        messages: [],
        phase: 'idle',
        awaitingConfirmation: false,
        currentDraft: null
      };
    }
  }
}
