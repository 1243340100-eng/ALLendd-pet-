/**
 * ConversationGraph 状态定义。
 * 对应架构计划第 5.2 节和第 6 节。
 *
 * 使用 LangGraph.js Annotation 定义状态。
 * 状态在节点间传递，支持 checkpoint 中断恢复。
 */
import { Annotation } from '@langchain/langgraph';
import type {
  PersonaConfig,
  ChatMessage,
  MemoryRecord,
  ReminderDraft,
  ReflectionPayload
} from '../../../shared/contracts/graph-state';
import type { AppEvent } from '../../../shared/contracts/app-event';
import type { ModelMode, ErrorCode } from '../../../shared/constants';
import type { PersonalityProfile } from '../../../services/character-onboarding/schemas';

/** 意图类型 */
export type Intent = 'chat' | 'create_reminder' | 'list_schedule' | 'expression';

/** Graph 状态错误条目 */
export interface ConversationGraphError {
  code: ErrorCode;
  message: string;
  node?: string;
  recovered: boolean;
  occurredAt: string;
}

/** 最终响应 DTO */
export interface ResponseDTO {
  text: string;
  expression: string;
  motion: string;
  /** 关联的记忆 ID */
  memoryIds?: string[];
  /** 技能执行结果 */
  skillExecuted?: string;
  /** 是否需要追问用户 */
  shouldAskUser?: boolean;
  /** checkpoint ID（追问时） */
  checkpointId?: string;
  /** 主动事件投递 ID（用于 renderer ACK 确认） */
  reminderOccurrenceId?: string;
}

/** ConversationGraph 状态 */
export const ConversationState = Annotation.Root({
  /** 原始事件 */
  event: Annotation<AppEvent>,
  /** 用户 ID */
  userId: Annotation<string>,
  /** 角色 ID */
  characterId: Annotation<string>,
  /** 会话 ID */
  sessionId: Annotation<string>,
  /** Persona 配置 */
  persona: Annotation<PersonaConfig | null>,
  /** V8 新增：personality profile（来自已锁定 CompiledCharacterProfile） */
  personalityProfile: Annotation<PersonalityProfile | null>,
  /** 模型模式 */
  modelMode: Annotation<ModelMode>,
  /** 追踪 ID */
  traceId: Annotation<string>,
  /** Graph 开始时间 ISO */
  startedAt: Annotation<string>,
  /** 收集的错误 */
  errors: Annotation<ConversationGraphError[]>,
  /** 本轮已发生的模型调用次数 */
  modelCallCount: Annotation<number>,

  /** 用户输入文本 */
  userInput: Annotation<string>,
  /** 历史消息（有限，不保存完整历史） */
  messages: Annotation<ChatMessage[]>,
  /** 识别到的意图 */
  intent: Annotation<Intent | null>,
  /** 检索到的记忆 */
  retrievedMemories: Annotation<MemoryRecord[]>,

  /** 提醒草稿 */
  reminderDraft: Annotation<ReminderDraft | null>,
  /** 缺失字段 */
  missingFields: Annotation<string[]>,

  /** 选中的技能 ID */
  selectedSkillId: Annotation<string | null>,
  /** 技能执行结果 */
  skillResult: Annotation<unknown>,

  /** 模型回复文本 */
  responseText: Annotation<string>,
  /** 表情 */
  expression: Annotation<string>,
  /** 动作 */
  motion: Annotation<string>,

  /** 反思负载 */
  reflectionPayload: Annotation<ReflectionPayload | null>,

  /** 最终响应 DTO */
  responseDTO: Annotation<ResponseDTO | null>,

  /** checkpoint 原因（中断时保存） */
  checkpointReason: Annotation<string>,
  /** 是否需要追问用户 */
  shouldAskUser: Annotation<boolean>,
  /** 追问消息 */
  askUserMessage: Annotation<string>,
  /** checkpoint ID */
  checkpointId: Annotation<string>
});

export type ConversationStateType = typeof ConversationState.State;
export type ConversationStateUpdate = Partial<ConversationStateType>;

/** 默认表情 */
export const DEFAULT_EXPRESSION = 'idle';
/** 默认动作 */
export const DEFAULT_MOTION = 'idle';

/** 创建初始 ConversationGraph 状态 */
export function createInitialConversationState(params: {
  event: AppEvent;
  userId: string;
  characterId: string;
  sessionId: string;
  persona: PersonaConfig | null;
  /** V8 新增：personality profile（可选，来自已锁定 CompiledCharacterProfile） */
  personalityProfile?: PersonalityProfile | null;
  modelMode: ModelMode;
  userInput: string;
  messages?: ChatMessage[];
}): ConversationStateType {
  return {
    event: params.event,
    userId: params.userId,
    characterId: params.characterId,
    sessionId: params.sessionId,
    persona: params.persona,
    personalityProfile: params.personalityProfile ?? null,
    modelMode: params.modelMode,
    traceId: params.event.correlationId || `conv-${Date.now()}`,
    startedAt: new Date().toISOString(),
    errors: [],
    modelCallCount: 0,
    userInput: params.userInput,
    messages: params.messages ?? [],
    intent: null,
    retrievedMemories: [],
    reminderDraft: null,
    missingFields: [],
    selectedSkillId: null,
    skillResult: null,
    responseText: '',
    expression: DEFAULT_EXPRESSION,
    motion: DEFAULT_MOTION,
    reflectionPayload: null,
    responseDTO: null,
    checkpointReason: '',
    shouldAskUser: false,
    askUserMessage: '',
    checkpointId: ''
  };
}
