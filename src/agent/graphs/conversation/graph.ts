/**
 * ConversationGraph 定义。
 * 对应架构计划第 5.2 节。
 *
 * 流程：
 * receive_chat → load_context → deterministic_intent_check → route_or_extract
 * → permission_check
 * → (conditional) {chat | create_reminder | list_today_schedule | expression_request}
 * → build_response → persist_messages → emit_response → enqueue_reflection → END
 *
 * 普通消息总模型调用不超过 3 次（1 路由 + 1 主回复 + 1 异步反思）。
 * 表情、动作不得额外消耗模型调用。
 */
import { StateGraph, START, END } from '@langchain/langgraph';
import { ConversationState } from './state';
import type { ConversationStateType } from './state';
import type { SkillRegistry } from '../../../services/SkillRegistry';
import type { ModelGateway } from '../../../services/ModelGateway';
import type { MemoryStore } from '../../../services/MemoryStore';
import type { ReminderParserService } from '../../../services/ReminderParserService';
import { receiveChat } from './nodes/receive-chat';
import { loadContext } from './nodes/load-context';
import { deterministicIntentCheck } from './nodes/deterministic-intent-check';
import { createRouteOrExtractNode } from './nodes/route-or-extract';
import { createPermissionCheckNode } from './nodes/permission-check';
import { createChatBranchNode } from './nodes/chat-branch';
import { createCreateReminderBranchNode } from './nodes/create-reminder-branch';
import { createListScheduleBranchNode } from './nodes/list-schedule-branch';
import { createExpressionBranchNode } from './nodes/expression-branch';
import { buildResponse } from './nodes/build-response';
import { persistMessages } from './nodes/persist-messages';
import { emitResponse } from './nodes/emit-response';
import { enqueueReflection } from './nodes/enqueue-reflection';
import { checkpointRepository } from '../../../infrastructure/database/repositories/checkpoint-repository';
import { createLogger } from '../../../infrastructure/logging/logger';

const log = createLogger('ConversationGraph');

/** ConversationGraph 依赖 */
export interface ConversationGraphDeps {
  skillRegistry: SkillRegistry;
  modelGateway: ModelGateway;
  memoryStore: MemoryStore;
  reminderParserService: ReminderParserService;
}

/** 条件路由：根据 intent 选择分支 */
function routeByIntent(state: ConversationStateType): string {
  const intent = state.intent;
  switch (intent) {
    case 'create_reminder':
      return 'create_reminder';
    case 'list_schedule':
      return 'list_today_schedule';
    case 'expression':
      return 'expression_request';
    case 'chat':
    default:
      return 'chat';
  }
}

/** 创建 ConversationGraph */
export function createConversationGraph(deps: ConversationGraphDeps) {
  // 创建依赖节点
  const routeOrExtract = createRouteOrExtractNode(deps.modelGateway);
  const permissionCheck = createPermissionCheckNode(deps.skillRegistry);
  const chatBranch = createChatBranchNode(deps.modelGateway, deps.memoryStore);
  const createReminderBranch = createCreateReminderBranchNode(deps.skillRegistry, deps.reminderParserService);
  const listScheduleBranch = createListScheduleBranchNode(deps.skillRegistry);
  const expressionBranch = createExpressionBranchNode(deps.skillRegistry);

  const graph = new StateGraph(ConversationState)
    .addNode('receive_chat', receiveChat)
    .addNode('load_context', loadContext)
    .addNode('deterministic_intent_check', deterministicIntentCheck)
    .addNode('route_or_extract', routeOrExtract)
    .addNode('permission_check', permissionCheck)
    .addNode('chat', chatBranch)
    .addNode('create_reminder', createReminderBranch)
    .addNode('list_today_schedule', listScheduleBranch)
    .addNode('expression_request', expressionBranch)
    .addNode('build_response', buildResponse)
    .addNode('persist_messages', persistMessages)
    .addNode('emit_response', emitResponse)
    .addNode('enqueue_reflection', enqueueReflection)
    // 主流程边
    .addEdge(START, 'receive_chat')
    .addEdge('receive_chat', 'load_context')
    .addEdge('load_context', 'deterministic_intent_check')
    .addEdge('deterministic_intent_check', 'route_or_extract')
    .addEdge('route_or_extract', 'permission_check')
    // 条件路由：根据意图选择分支
    .addConditionalEdges('permission_check', routeByIntent, {
      chat: 'chat',
      create_reminder: 'create_reminder',
      list_today_schedule: 'list_today_schedule',
      expression_request: 'expression_request'
    })
    // 所有分支汇合到 build_response
    .addEdge('chat', 'build_response')
    .addEdge('create_reminder', 'build_response')
    .addEdge('list_today_schedule', 'build_response')
    .addEdge('expression_request', 'build_response')
    // 后处理
    .addEdge('build_response', 'persist_messages')
    .addEdge('persist_messages', 'emit_response')
    .addEdge('emit_response', 'enqueue_reflection')
    .addEdge('enqueue_reflection', END);

  return graph.compile();
}

/** ConversationGraph 运行器 */
export class ConversationGraphRunner {
  private compiledGraph: ReturnType<typeof createConversationGraph>;
  private modelGateway: ModelGateway;

  constructor(deps: ConversationGraphDeps) {
    this.modelGateway = deps.modelGateway;
    this.compiledGraph = createConversationGraph(deps);
  }

  /** 运行对话 */
  async run(initialState: ConversationStateType): Promise<ConversationStateType> {
    log.info('running conversation graph', {
      traceId: initialState.traceId
    });

    // checkpoint 恢复：检查是否有未消费的 checkpoint
    const activeCheckpoint = checkpointRepository.getActive('conversation');
    let state = initialState;
    if (activeCheckpoint) {
      try {
        const saved = JSON.parse(activeCheckpoint.state_json) as Partial<ConversationStateType>;
        // 合并：保留已有草稿，用新用户输入继续
        state = {
          ...initialState,
          reminderDraft: saved.reminderDraft ?? initialState.reminderDraft,
          missingFields: saved.missingFields ?? initialState.missingFields,
          errors: [...(saved.errors ?? []), ...initialState.errors]
        };
        checkpointRepository.consume(activeCheckpoint.id);
        log.info('checkpoint resumed', {
          traceId: initialState.traceId,
          fields: { checkpointId: activeCheckpoint.id, reason: activeCheckpoint.reason }
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
      const finalState = result as ConversationStateType;

      log.info('conversation graph completed', {
        traceId: state.traceId,
        fields: {
          modelCallCount: finalState.modelCallCount,
          intent: finalState.intent
        }
      });

      // checkpoint 保存：如果需要追问用户，保存当前状态
      if (finalState.shouldAskUser && finalState.checkpointId) {
        try {
          checkpointRepository.save({
            id: finalState.checkpointId,
            graph_type: 'conversation',
            state_json: JSON.stringify({
              reminderDraft: finalState.reminderDraft,
              missingFields: finalState.missingFields,
              errors: finalState.errors
            }),
            reason: finalState.checkpointReason || 'ask_user'
          });
          log.info('checkpoint saved', {
            traceId: state.traceId,
            fields: { checkpointId: finalState.checkpointId }
          });
        } catch (error) {
          log.warn('checkpoint save failed, user will need to rephrase', {
            fields: { error: (error as Error)?.message }
          });
        }
      }

      return finalState;
    } catch (error) {
      log.error('conversation graph failed', {
        traceId: state.traceId,
        fields: { error: (error as Error)?.message }
      });
      // Graph 失败不会导致聊天窗口卡死：返回安全后备
      return {
        ...state,
        responseDTO: {
          text: '抱歉，我遇到了一些问题，请稍后再试。',
          expression: 'failed',
          motion: 'failed'
        },
        errors: [...state.errors, {
          code: 'unknown' as const,
          message: (error as Error)?.message ?? 'Unknown error',
          node: 'conversation_graph',
          recovered: false,
          occurredAt: new Date().toISOString()
        }]
      };
    } finally {
      this.modelGateway.endTurn();
    }
  }
}
