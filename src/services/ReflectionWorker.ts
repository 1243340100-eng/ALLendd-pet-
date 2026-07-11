/**
 * ReflectionWorker：后台反思队列处理器。
 * 对应架构计划第 5.4 节"Reflection 失败不影响聊天"。
 *
 * 职责：
 * - 接收 ConversationGraph 的 enqueue_reflection 负载
 * - 在后台运行 ReflectionGraph（不阻塞聊天）
 * - 失败重试有限次后丢弃（不影响主流程）
 *
 * 设计：
 * - 持久化到 reflection_jobs 表，应用退出后任务不丢失
 * - 单 worker 串行处理，避免并发模型调用
 * - 间隔轮询 + 事件唤醒
 * - 启动时重置 processing 状态的任务为 pending
 */
import type { ReflectionPayload } from '../shared/contracts/graph-state';
import type { AppEvent } from '../shared/contracts/app-event';
import type { ModelGateway } from './ModelGateway';
import type { PersonaConfig } from '../shared/contracts/graph-state';
import { ReflectionGraphRunner } from '../agent/graphs/reflection/graph';
import { createInitialReflectionState } from '../agent/graphs/reflection/state';
import { reflectionRepository, type ReflectionJobRow } from '../infrastructure/database/repositories/reflection-repository';
import { createLogger } from '../infrastructure/logging/logger';

const log = createLogger('ReflectionWorker');

/** 持久化的任务额外数据（Persona 无法直接序列化到 DB，在内存中缓存） */
interface PersonaCache {
  [jobId: string]: PersonaConfig | null;
}

const personaCache: PersonaCache = {};

/** 推入反思任务（供 enqueue-reflection 节点调用） */
export function enqueueReflectionTask(task: {
  payload: ReflectionPayload;
  userId: string;
  characterId: string;
  sessionId: string;
  persona: PersonaConfig | null;
}): void {
  const jobId = `refl-${task.payload.turnId}-${Date.now()}`;
  const payloadJson = JSON.stringify({
    payload: task.payload,
    sessionId: task.sessionId,
    persona: task.persona
  });

  try {
    reflectionRepository.enqueue({
      id: jobId,
      turn_id: task.payload.turnId,
      user_id: task.userId,
      character_id: task.characterId,
      payload_json: payloadJson
    });
    // 缓存 persona 避免反序列化复杂对象
    personaCache[jobId] = task.persona;
    log.info('reflection task enqueued (persisted)', {
      fields: { turnId: task.payload.turnId, jobId }
    });
  } catch (error) {
    log.error('failed to enqueue reflection task', {
      fields: { error: (error as Error)?.message }
    });
  }
}

export interface ReflectionWorkerOptions {
  modelGateway: ModelGateway;
  /** 轮询间隔毫秒，默认 30000 */
  pollIntervalMs?: number;
  /** 最大重试次数，默认 1 */
  maxAttempts?: number;
}

export class ReflectionWorker {
  private runner: ReflectionGraphRunner;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private pollIntervalMs: number;
  private maxAttempts: number;
  private processing = false;

  constructor(options: ReflectionWorkerOptions) {
    this.runner = new ReflectionGraphRunner({ modelGateway: options.modelGateway });
    this.pollIntervalMs = options.pollIntervalMs ?? 30000;
    this.maxAttempts = options.maxAttempts ?? 1;
  }

  /** 启动 worker */
  start(): void {
    if (this.intervalId) return;
    // 崩溃恢复：重置所有 processing 状态的任务为 pending。
    // 如果应用在任务标记为 processing 后崩溃，重启后这些任务
    // 不会被 dequeue() 取出，导致永久卡住。
    const resetCount = reflectionRepository.resetProcessingJobs();
    if (resetCount > 0) {
      log.info('reset processing jobs after crash recovery', {
        fields: { resetCount }
      });
    }
    // 启动后立即处理一次
    this.processQueue();
    this.intervalId = setInterval(() => this.processQueue(), this.pollIntervalMs);
    log.info('reflection worker started', {
      fields: { pollIntervalMs: this.pollIntervalMs, pendingCount: reflectionRepository.getPendingCount() }
    });
  }

  /** 停止 worker */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    log.info('reflection worker stopped');
  }

  /** 处理队列 */
  private async processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    try {
      // 使用原子操作 dequeue + markProcessing，避免任务丢失
      while (true) {
        const job = reflectionRepository.dequeueAndMarkProcessing();
        if (!job) break;
        await this.processOne(job);
      }
    } finally {
      this.processing = false;
    }
  }

  private async processOne(job: ReflectionJobRow): Promise<void> {
    log.info('processing reflection', {
      fields: { jobId: job.id, turnId: job.turn_id, attempt: job.attempts + 1 }
    });

    // 任务已通过 dequeueAndMarkProcessing() 标记为 processing

    // 解析 payload
    let parsed: { payload: ReflectionPayload; sessionId: string; persona: PersonaConfig | null };
    try {
      parsed = JSON.parse(job.payload_json);
    } catch (error) {
      log.error('failed to parse reflection payload', {
        fields: { jobId: job.id, error: (error as Error)?.message }
      });
      // 标记为完成（数据损坏，无法处理）
      reflectionRepository.markCompleted(job.id);
      return;
    }

    // 优先使用缓存的 persona
    const persona = personaCache[job.id] ?? parsed.persona ?? null;

    try {
      // 构造合成 AppEvent
      const syntheticEvent: AppEvent = {
        schemaVersion: 1,
        eventId: `refl-${job.turn_id}`,
        type: 'skill_completed' as any,
        occurredAt: job.created_at,
        timezone: 'Asia/Shanghai',
        source: 'graph',
        userId: job.user_id,
        characterId: job.character_id,
        sessionId: parsed.sessionId,
        correlationId: `refl-${job.turn_id}`,
        priority: 'low',
        payload: {}
      };

      const state = createInitialReflectionState({
        event: syntheticEvent,
        userId: job.user_id,
        characterId: job.character_id,
        sessionId: parsed.sessionId,
        persona,
        modelMode: 'low_cost',
        reflectionPayload: parsed.payload
      });

      await this.runner.run(state);
      reflectionRepository.markCompleted(job.id);
      delete personaCache[job.id];
      log.info('reflection completed', {
        fields: { jobId: job.id, turnId: job.turn_id }
      });
    } catch (error) {
      log.warn('reflection failed', {
        fields: {
          jobId: job.id,
          turnId: job.turn_id,
          error: (error as Error)?.message,
          attempts: job.attempts
        }
      });

      // 重试或标记失败
      if (job.attempts < this.maxAttempts) {
        const nextRetryAt = new Date(Date.now() + 60000).toISOString(); // 1 分钟后重试
        reflectionRepository.markFailed(job.id, (error as Error)?.message ?? 'unknown', nextRetryAt);
      } else {
        // 超过最大重试次数，标记为完成避免无限重试
        reflectionRepository.markCompleted(job.id);
        delete personaCache[job.id];
        log.warn('reflection discarded after max attempts', {
          fields: { jobId: job.id, turnId: job.turn_id }
        });
      }
    }
  }
}
