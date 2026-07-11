/**
 * ReflectionGraph 定义。
 * 对应架构计划第 5.4 节。
 *
 * 流程：
 * load_completed_turn → extract_memory_candidates → classify_memory_scope
 * → validate_candidates → deduplicate_memories → upsert_memory
 * → update_user_profile_candidates → record_result → END
 *
 * 线性流程，无条件边。
 * Reflection 失败不影响聊天：所有异常被捕获，返回安全后备。
 * 最多 1 次模型调用（extract_memory_candidates）。
 */
import { StateGraph, START, END } from '@langchain/langgraph';
import { ReflectionState } from './state';
import type { ReflectionStateType } from './state';
import type { ModelGateway } from '../../../services/ModelGateway';
import { loadCompletedTurn } from './nodes/load-completed-turn';
import { createExtractMemoryCandidatesNode } from './nodes/extract-memory-candidates';
import { classifyMemoryScope } from './nodes/classify-memory-scope';
import { validateCandidates } from './nodes/validate-candidates';
import { deduplicateMemories } from './nodes/deduplicate-memories';
import { upsertMemory } from './nodes/upsert-memory';
import { updateUserProfileCandidates } from './nodes/update-user-profile-candidates';
import { recordResult } from './nodes/record-result';
import { createLogger } from '../../../infrastructure/logging/logger';

const log = createLogger('ReflectionGraph');

/** ReflectionGraph 依赖 */
export interface ReflectionGraphDeps {
  modelGateway: ModelGateway;
}

/** 创建 ReflectionGraph */
export function createReflectionGraph(deps: ReflectionGraphDeps) {
  const extractMemoryCandidates = createExtractMemoryCandidatesNode(deps.modelGateway);

  const graph = new StateGraph(ReflectionState)
    .addNode('load_completed_turn', loadCompletedTurn)
    .addNode('extract_memory_candidates', extractMemoryCandidates)
    .addNode('classify_memory_scope', classifyMemoryScope)
    .addNode('validate_candidates', validateCandidates)
    .addNode('deduplicate_memories', deduplicateMemories)
    .addNode('upsert_memory', upsertMemory)
    .addNode('update_user_profile_candidates', updateUserProfileCandidates)
    .addNode('record_result', recordResult)
    // 线性流程
    .addEdge(START, 'load_completed_turn')
    .addEdge('load_completed_turn', 'extract_memory_candidates')
    .addEdge('extract_memory_candidates', 'classify_memory_scope')
    .addEdge('classify_memory_scope', 'validate_candidates')
    .addEdge('validate_candidates', 'deduplicate_memories')
    .addEdge('deduplicate_memories', 'upsert_memory')
    .addEdge('upsert_memory', 'update_user_profile_candidates')
    .addEdge('update_user_profile_candidates', 'record_result')
    .addEdge('record_result', END);

  return graph.compile();
}

/** ReflectionGraph 运行器 */
export class ReflectionGraphRunner {
  private compiledGraph: ReturnType<typeof createReflectionGraph>;
  private modelGateway: ModelGateway;

  constructor(deps: ReflectionGraphDeps) {
    this.modelGateway = deps.modelGateway;
    this.compiledGraph = createReflectionGraph(deps);
  }

  /** 运行反思 */
  async run(initialState: ReflectionStateType): Promise<ReflectionStateType> {
    log.info('running reflection graph', {
      traceId: initialState.traceId,
      fields: { turnId: initialState.reflectionPayload.turnId }
    });

    // Reflection 使用自己的模型调用轮次
    this.modelGateway.beginTurn(initialState.traceId);

    try {
      const result = await this.compiledGraph.invoke(initialState);
      log.info('reflection graph completed', {
        traceId: initialState.traceId,
        fields: {
          extracted: (result as ReflectionStateType).candidates.length,
          saved: (result as ReflectionStateType).savedCandidates.length,
          success: (result as ReflectionStateType).reflectionResult?.success ?? false
        }
      });
      return result as ReflectionStateType;
    } catch (error) {
      log.error('reflection graph failed', {
        traceId: initialState.traceId,
        fields: { error: (error as Error)?.message }
      });
      // Reflection 失败不影响聊天：返回安全后备
      return {
        ...initialState,
        reflectionResult: {
          extractedCount: 0,
          validCount: 0,
          insertedCount: 0,
          updatedCount: 0,
          duplicateCount: 0,
          filteredCount: 0,
          success: false,
          errorMessage: (error as Error)?.message ?? 'Reflection failed'
        },
        errors: [...initialState.errors, {
          code: 'unknown' as const,
          message: (error as Error)?.message ?? 'Unknown error',
          node: 'reflection_graph',
          recovered: true,
          occurredAt: new Date().toISOString()
        }]
      };
    } finally {
      this.modelGateway.endTurn();
    }
  }
}
