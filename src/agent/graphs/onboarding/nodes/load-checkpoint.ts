/**
 * 节点：load_checkpoint
 * 从 graph_checkpoints 表按 scope_key 恢复 V8 character-onboarding 草稿与上次状态。
 *
 * 权威来源：SQLite checkpoint。内存中的 state 仅作为短期缓存。
 *
 * scope_key 格式：`${userId || 'anonymous'}:${characterId || baseManifest.id}:${onboardingThreadId}`
 *
 * 若无 checkpoint：
 * - 创建初始草稿
 * - 阶段设为 'basic'
 * - phase 设为 'collecting'
 *
 * 若有 checkpoint：
 * - 反序列化 state_json
 * - 恢复 draft / currentStage / previousQuestions / summary / phase
 * - 不恢复 isLocked / onboardingCompleted（这两个只能由 persist_and_lock 设置）
 */
import type { OnboardingStateType, OnboardingStateUpdate } from '../state';
import { checkpointRepository } from '../../../../infrastructure/database/repositories/checkpoint-repository';
import { createInitialDraft, characterRequirementDraftSchema, characterRequirementSummarySchema, onboardingQuestionSchema, pendingAnswersDataSchema, type CharacterRequirementDraft, type PendingAnswersData, type PendingAnswerEntry } from '../../../../services/character-onboarding/schemas';
import type { OnboardingQuestion } from '../../../../services/character-onboarding/schemas';
import { z } from 'zod';
import { createLogger } from '../../../../infrastructure/logging/logger';

const log = createLogger('OnboardingGraph:load_checkpoint');

/** 构造 scope_key */
export function buildScopeKey(state: OnboardingStateType): string {
  const userId = state.userId || 'anonymous';
  const characterId = state.characterId || state.baseManifest?.id || 'default';
  const threadId = state.onboardingThreadId || 'default-onboarding';
  return `${userId}:${characterId}:${threadId}`;
}

/**
 * W9: PersistedOnboardingState 严格 Zod Schema。
 * V9：currentQuestions 使用 onboardingQuestionSchema（结构化卡片）。
 * 解析失败时保留损坏记录用于审计，并安全创建新 checkpoint。
 */
const persistedOnboardingStateSchema = z.object({
  draft: characterRequirementDraftSchema.nullable().optional(),
  currentStage: z.string().optional(),
  previousQuestions: z.array(z.string()).optional(),
  summary: characterRequirementSummarySchema.nullable().optional(),
  phase: z.string().optional(),
  currentQuestions: z.array(onboardingQuestionSchema).optional(),
  completionProgress: z.number().optional(),
  pendingAnswers: pendingAnswersDataSchema.nullable().optional()
}).strict();

type PersistedOnboardingState = z.infer<typeof persistedOnboardingStateSchema>;

export async function loadCheckpoint(
  state: OnboardingStateType
): Promise<OnboardingStateUpdate> {
  const scopeKey = buildScopeKey(state);
  log.info('loading onboarding checkpoint', { fields: { scopeKey, traceId: state.traceId } });

  const checkpoint = checkpointRepository.getActiveByScope('onboarding', scopeKey);

  // 无 checkpoint：初始化新草稿
  if (!checkpoint) {
    log.info('no checkpoint found, starting fresh onboarding', { fields: { scopeKey } });
    const draft = createInitialDraft();
    return {
      currentStep: 'determine_stage',
      draft,
      currentStage: draft.stage,
      phase: 'collecting',
      previousQuestions: [],
      currentQuestions: [],
      summary: null,
      completionProgress: 0,
      checkpointReason: ''
    };
  }

  // W9: 严格 Zod Schema 校验 checkpoint state_json
  let parsed: PersistedOnboardingState;
  try {
    const rawJson: unknown = JSON.parse(checkpoint.state_json);
    const validated = persistedOnboardingStateSchema.safeParse(rawJson);
    if (!validated.success) {
      log.warn('checkpoint state_json schema validation failed, starting fresh', {
        fields: {
          scopeKey,
          issues: validated.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).slice(0, 5),
          traceId: state.traceId
        }
      });
      // 保留损坏 checkpoint 记录用于审计（不消费），安全创建新 checkpoint
      const draft = createInitialDraft();
      return {
        currentStep: 'determine_stage',
        draft,
        currentStage: draft.stage,
        phase: 'collecting',
        previousQuestions: [],
        currentQuestions: [],
        summary: null,
        completionProgress: 0,
        checkpointReason: ''
      };
    }
    parsed = validated.data;
  } catch (e) {
    log.warn('checkpoint state_json invalid JSON, starting fresh', {
      fields: { scopeKey, error: (e as Error)?.message, traceId: state.traceId }
    });
    const draft = createInitialDraft();
    return {
      currentStep: 'determine_stage',
      draft,
      currentStage: draft.stage,
      phase: 'collecting',
      previousQuestions: [],
      currentQuestions: [],
      summary: null,
      completionProgress: 0,
      checkpointReason: ''
    };
  }

  // 恢复字段（防御性：每个字段都校验）
  const draft = parsed.draft ?? createInitialDraft();
  const currentStage = (parsed.currentStage as CharacterRequirementDraft['stage']) ?? draft.stage;
  const previousQuestions = Array.isArray(parsed.previousQuestions)
    ? parsed.previousQuestions.filter((q) => typeof q === 'string').slice(-50)
    : [];
  const summary = parsed.summary ?? null;
  const phase = (parsed.phase as 'collecting' | 'review' | 'busy' | 'locked' | 'error') ?? 'collecting';
  const currentQuestions = Array.isArray(parsed.currentQuestions) ? parsed.currentQuestions : [];
  const completionProgress = typeof parsed.completionProgress === 'number' ? parsed.completionProgress : 0;

  // W2: 乐观锁校验
  // 客户端传入的 expectedRevision 必须与 checkpoint 中的 draft.revision 一致
  // expectedRevision=-1 表示不校验（如 getOnboardingState 只读查询）
  // start 操作的 revision=0 校验已在 graph-dispatcher 中完成
  if (state.expectedRevision >= 0 && state.userAction !== 'start') {
    const actualRevision = draft.revision;
    if (actualRevision !== state.expectedRevision) {
      log.warn('stale revision detected, rejecting request', {
        fields: {
          scopeKey,
          expected: state.expectedRevision,
          actual: actualRevision,
          userAction: state.userAction,
          traceId: state.traceId
        }
      });
      return {
        currentStep: 'finish',
        phase: 'error',
        errorReason: 'stale-revision',
        errors: [...state.errors, `Stale revision: expected ${state.expectedRevision}, actual ${actualRevision}`],
        draft,
        currentStage,
        previousQuestions,
        currentQuestions,
        summary,
        completionProgress,
        checkpointReason: ''
      };
    }
  }

  log.info('checkpoint restored', {
    fields: {
      scopeKey,
      stage: currentStage,
      phase,
      draftRevision: draft.revision,
      fieldCount: Object.values(draft.fields).filter((v) => v !== null).length
    }
  });

  return {
    currentStep: 'determine_stage',
    draft,
    currentStage,
    phase,
    previousQuestions,
    currentQuestions,
    summary,
    completionProgress,
    checkpointReason: ''
  };
}

/**
 * I7: 只读读取 checkpoint，不运行 Graph，不修改任何状态。
 * 用于 getOnboardingState IPC：单纯刷新 UI 不应触发模型调用或保存新 checkpoint。
 *
 * 返回值：
 * - null：无 checkpoint 或 checkpoint 损坏（调用方应返回初始 collecting 状态）
 * - 非 null：从 checkpoint 恢复的只读状态片段
 */
export function readCheckpointReadOnly(scopeKey: string): {
  draft: CharacterRequirementDraft;
  currentStage: CharacterRequirementDraft['stage'];
  previousQuestions: string[];
  summary: PersistedOnboardingState['summary'];
  phase: 'collecting' | 'review' | 'busy' | 'locked' | 'error';
  currentQuestions: OnboardingQuestion[];
  completionProgress: number;
  pendingAnswers: PendingAnswersData | null;
} | null {
  const checkpoint = checkpointRepository.getActiveByScope('onboarding', scopeKey);
  if (!checkpoint) {
    return null;
  }

  let parsed: PersistedOnboardingState;
  try {
    const rawJson: unknown = JSON.parse(checkpoint.state_json);
    const validated = persistedOnboardingStateSchema.safeParse(rawJson);
    if (!validated.success) {
      log.warn('readCheckpointReadOnly: schema validation failed', {
        fields: {
          scopeKey,
          issues: validated.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).slice(0, 5)
        }
      });
      return null;
    }
    parsed = validated.data;
  } catch (e) {
    log.warn('readCheckpointReadOnly: invalid JSON', {
      fields: { scopeKey, error: (e as Error)?.message }
    });
    return null;
  }

  const draft = parsed.draft ?? createInitialDraft();
  const currentStage = (parsed.currentStage as CharacterRequirementDraft['stage']) ?? draft.stage;
  const previousQuestions = Array.isArray(parsed.previousQuestions)
    ? parsed.previousQuestions.filter((q) => typeof q === 'string').slice(-50)
    : [];
  const summary = parsed.summary ?? null;
  const phase = (parsed.phase as 'collecting' | 'review' | 'busy' | 'locked' | 'error') ?? 'collecting';
  const currentQuestions = Array.isArray(parsed.currentQuestions) ? parsed.currentQuestions : [];
  const completionProgress = typeof parsed.completionProgress === 'number' ? parsed.completionProgress : 0;

  // P2: 验证 pendingAnswers（revision + fingerprint 必须匹配）
  let pendingAnswers: PendingAnswersData | null = null;
  if (parsed.pendingAnswers && parsed.pendingAnswers.answers.length > 0) {
    const draftRevision = draft.revision;
    const currentFingerprint = computeQuestionSetFingerprint(currentQuestions);
    if (parsed.pendingAnswers.revision === draftRevision &&
        parsed.pendingAnswers.questionSetFingerprint === currentFingerprint) {
      pendingAnswers = parsed.pendingAnswers;
    } else {
      log.warn('readCheckpointReadOnly: pendingAnswers expired (revision/fingerprint mismatch), discarding', {
        fields: {
          scopeKey,
          pendingRevision: parsed.pendingAnswers.revision,
          draftRevision,
          fingerprintMatch: parsed.pendingAnswers.questionSetFingerprint === currentFingerprint
        }
      });
    }
  }

  return {
    draft,
    currentStage,
    previousQuestions,
    summary,
    phase,
    currentQuestions,
    completionProgress,
    pendingAnswers
  };
}

/** 将当前 state 序列化为可持久化的 checkpoint state_json */
export function serializeCheckpointState(state: OnboardingStateType): string {
  const persisted: PersistedOnboardingState = {
    draft: state.draft,
    currentStage: state.currentStage,
    previousQuestions: state.previousQuestions,
    summary: state.summary,
    phase: state.phase,
    currentQuestions: state.currentQuestions,
    completionProgress: state.completionProgress
  };
  return JSON.stringify(persisted);
}

/** 保存当前 state 为 checkpoint */
export function saveCheckpoint(state: OnboardingStateType, reason: string): void {
  const scopeKey = buildScopeKey(state);
  const id = `onboarding-${scopeKey}-${Date.now()}`;
  checkpointRepository.save({
    id,
    graph_type: 'onboarding',
    state_json: serializeCheckpointState(state),
    reason,
    scope_key: scopeKey
  });
  log.info('checkpoint saved', { fields: { scopeKey, reason } });
}

/** 标记 checkpoint 已消费（确认完成后调用） */
export function consumeCheckpoint(state: OnboardingStateType): void {
  const scopeKey = buildScopeKey(state);
  const checkpoint = checkpointRepository.getActiveByScope('onboarding', scopeKey);
  if (checkpoint) {
    checkpointRepository.consume(checkpoint.id);
    log.info('checkpoint consumed', { fields: { scopeKey, id: checkpoint.id } });
  }
}

// ===== P2: pendingAnswers 临时保存/恢复 =====

/**
 * 计算问题集合指纹（questionId + optionIds 排序拼接）。
 * 用于 pendingAnswers 恢复时验证问题集未发生变化。
 */
export function computeQuestionSetFingerprint(questions: OnboardingQuestion[]): string {
  return questions.map((q) => {
    const optionIds = (q.options ?? []).map((o) => o.id).sort().join(',');
    return `${q.id}:${optionIds}`;
  }).sort().join('|');
}

/**
 * P2: 保存 pendingAnswers 到 checkpoint。
 * 读取当前 checkpoint，验证 revision，计算指纹，添加 pendingAnswers 后保存新 checkpoint。
 * checkpointRepository.save 会自动消费同 scope_key 的旧 checkpoint。
 */
export function savePendingAnswersToCheckpoint(
  scopeKey: string,
  answers: PendingAnswerEntry[],
  revision: number
): { ok: boolean; reason?: string } {
  const checkpoint = checkpointRepository.getActiveByScope('onboarding', scopeKey);
  if (!checkpoint) {
    return { ok: false, reason: 'no-checkpoint' };
  }

  let parsed: PersistedOnboardingState;
  try {
    const rawJson: unknown = JSON.parse(checkpoint.state_json);
    const validated = persistedOnboardingStateSchema.safeParse(rawJson);
    if (!validated.success) {
      log.warn('savePendingAnswers: checkpoint schema validation failed', {
        fields: { scopeKey, issues: validated.error.issues.map((i) => i.message).slice(0, 3) }
      });
      return { ok: false, reason: 'checkpoint-corrupted' };
    }
    parsed = validated.data;
  } catch {
    return { ok: false, reason: 'checkpoint-corrupted' };
  }

  // 验证 revision 与当前 draft 一致
  const draftRevision = parsed.draft?.revision ?? 0;
  if (draftRevision !== revision) {
    log.warn('savePendingAnswers: revision mismatch', {
      fields: { scopeKey, expected: draftRevision, received: revision }
    });
    return { ok: false, reason: 'revision-mismatch' };
  }

  // 从 currentQuestions 计算指纹
  const questions = parsed.currentQuestions ?? [];
  if (questions.length === 0) {
    return { ok: false, reason: 'no-current-questions' };
  }
  const fingerprint = computeQuestionSetFingerprint(questions);

  // 构造 pendingAnswers 数据包
  const pendingAnswers: PendingAnswersData = {
    revision,
    questionSetFingerprint: fingerprint,
    answers
  };

  // 保存新 checkpoint（包含原有数据 + pendingAnswers）
  const newStateJson = JSON.stringify({
    ...parsed,
    pendingAnswers
  });

  const id = `onboarding-${scopeKey}-${Date.now()}`;
  checkpointRepository.save({
    id,
    graph_type: 'onboarding',
    state_json: newStateJson,
    reason: 'save-pending-answers',
    scope_key: scopeKey
  });

  log.info('pendingAnswers saved', {
    fields: { scopeKey, answerCount: answers.length, revision }
  });
  return { ok: true };
}

/**
 * P2: 从 checkpoint 清除 pendingAnswers。
 * 提交成功、进入下一批、reset 时调用。
 */
export function clearPendingAnswersFromCheckpoint(
  scopeKey: string,
  revision: number
): { ok: boolean; reason?: string } {
  const checkpoint = checkpointRepository.getActiveByScope('onboarding', scopeKey);
  if (!checkpoint) {
    return { ok: true }; // 无 checkpoint = 无需清除
  }

  let parsed: PersistedOnboardingState;
  try {
    const rawJson: unknown = JSON.parse(checkpoint.state_json);
    const validated = persistedOnboardingStateSchema.safeParse(rawJson);
    if (!validated.success) {
      return { ok: false, reason: 'checkpoint-corrupted' };
    }
    parsed = validated.data;
  } catch {
    return { ok: false, reason: 'checkpoint-corrupted' };
  }

  // 已无 pendingAnswers，无需清除
  if (!parsed.pendingAnswers) {
    return { ok: true };
  }

  // 验证 revision（防止清除错误的 checkpoint）
  const draftRevision = parsed.draft?.revision ?? 0;
  if (draftRevision !== revision) {
    log.warn('clearPendingAnswers: revision mismatch', {
      fields: { scopeKey, expected: draftRevision, received: revision }
    });
    return { ok: false, reason: 'revision-mismatch' };
  }

  // 移除 pendingAnswers 后保存
  const { pendingAnswers: _removed, ...rest } = parsed;
  const newStateJson = JSON.stringify(rest);

  const id = `onboarding-${scopeKey}-${Date.now()}`;
  checkpointRepository.save({
    id,
    graph_type: 'onboarding',
    state_json: newStateJson,
    reason: 'clear-pending-answers',
    scope_key: scopeKey
  });

  log.info('pendingAnswers cleared', { fields: { scopeKey, revision } });
  return { ok: true };
}
