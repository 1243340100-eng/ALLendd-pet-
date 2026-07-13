/**
 * 节点：chat 分支
 * 包含 memory_gate → retrieve_memory → generate_structured_response → validate_response
 *
 * 一次模型调用同时输出文本、表情和动作。
 * 如果结构化输出无效，由规则映射为 neutral/idle。
 *
 * 模型调用次数：1（主回复）
 */
import type { ConversationStateType, ConversationStateUpdate } from '../state';
import { DEFAULT_EXPRESSION, DEFAULT_MOTION } from '../state';
import type { ModelGateway } from '../../../../services/ModelGateway';
import type { MemoryStore } from '../../../../services/MemoryStore';
import { shouldRetrieveMemory } from './route-or-extract';
import { generateHarnessPolicy, getDefaultHarnessPolicy } from '../../../../services/ConversationHarnessAdapter';
import { createLogger } from '../../../../infrastructure/logging/logger';
import { z } from 'zod';

const log = createLogger('ConversationGraph:chat_branch');

/** 结构化回复输出 schema */
const structuredResponseSchema = z.object({
  text: z.string().min(1),
  expression: z.string().default('idle'),
  motion: z.string().default('idle')
});

/** 构建系统提示词 */
function buildSystemPrompt(persona: ConversationStateType['persona']): string {
  if (!persona) {
    return '你是一个桌宠助手。请以友好的语气回答用户的问题。';
  }

  const parts: string[] = [];
  parts.push(persona.corePrompt);

  if (persona.speakingStyle?.length) {
    parts.push(`说话风格：\n${persona.speakingStyle.map((s) => `- ${s}`).join('\n')}`);
  }
  if (persona.commonTone?.length) {
    parts.push(`常见语气：\n${persona.commonTone.map((s) => `- ${s}`).join('\n')}`);
  }
  if (persona.relationshipBoundary?.length) {
    parts.push(`关系边界（不可逾越）：\n${persona.relationshipBoundary.map((s) => `- ${s}`).join('\n')}`);
  }
  if (persona.forbiddenDrift?.length) {
    parts.push(`禁止偏移：\n${persona.forbiddenDrift.map((s) => `- ${s}`).join('\n')}`);
  }

  parts.push(
    '请以 JSON 格式回复，包含以下字段：',
    '- text: 回复内容',
    '- expression: 表情（idle/waving/waiting/jumping/running/failed/review 之一）',
    '- motion: 动作（idle/waving/waiting/jumping/running/failed/review 之一）'
  );

  if (persona.userPetName) {
    parts.push(`称呼用户为"${persona.userPetName}"。`);
  }

  return parts.join('\n\n');
}

/** 构建 harness 策略提示词片段（V8 新增） */
function buildHarnessHints(state: ConversationStateType): string {
  // V8：如果 personalityProfile 存在，生成 harness 策略
  if (!state.personalityProfile) {
    return '';
  }

  const policy = generateHarnessPolicy(state.personalityProfile, state.userInput);

  const hints: string[] = [];
  hints.push(`[本轮策略] 回复深度：${policy.responseDepth}，最大要点数：${policy.maxMainPoints}`);

  if (policy.boundaryAction !== 'comply') {
    hints.push(`边界动作：${policy.boundaryAction}（检测到敏感内容，按角色禁区处理）`);
  }

  if (policy.playfulness !== 'none') {
    hints.push(`互动风格：${policy.playfulness}`);
  }

  if (policy.askQuestion) {
    hints.push('可以适度主动追问用户的状态或需求。');
  }

  if (policy.toneHints.length > 0) {
    hints.push(`语气提示：${policy.toneHints.join('、')}`);
  }

  if (policy.mustAvoid.length > 0) {
    hints.push(`必须避免：${policy.mustAvoid.join('、')}`);
  }

  // harness 策略不能覆盖 corePrompt、关系边界和禁区
  hints.push('注意：以上策略为辅助提示，不得覆盖角色核心设定、关系边界和禁区。');

  return hints.length > 1 ? hints.join('\n') : '';
}

/** 构建消息列表 */
function buildMessages(state: ConversationStateType): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  const systemPrompt = buildSystemPrompt(state.persona);

  // V8：注入 harness 策略（如果有 personalityProfile）
  const harnessHints = buildHarnessHints(state);
  const finalSystemPrompt = harnessHints ? `${systemPrompt}\n\n${harnessHints}` : systemPrompt;

  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: finalSystemPrompt }
  ];

  // 添加历史消息（最多 6 条）
  const recentMessages = state.messages.slice(-6);
  for (const msg of recentMessages) {
    messages.push({
      role: msg.role,
      content: msg.content
    });
  }

  // 添加检索到的记忆（如果有）
  if (state.retrievedMemories.length > 0) {
    const memoryText = state.retrievedMemories
      .map((m) => `- [${m.type}] ${m.content}`)
      .join('\n');
    messages.push({
      role: 'system',
      content: `相关记忆：\n${memoryText}`
    });
  }

  // 添加用户输入
  messages.push({ role: 'user', content: state.userInput });

  return messages;
}

/** 规则映射：当结构化输出无效时的后备 */
function fallbackResponse(state: ConversationStateType): { text: string; expression: string; motion: string } {
  const persona = state.persona;
  const userPetName = persona?.userPetName ?? '';
  const greeting = userPetName ? `${userPetName}，` : '';

  return {
    text: `${greeting}我听到了你说的话，不过我现在有点反应不过来。能再说一次吗？`,
    expression: 'waiting',
    motion: 'idle'
  };
}

export function createChatBranchNode(modelGateway: ModelGateway, memoryStore: MemoryStore) {
  return async function chatBranch(
    state: ConversationStateType
  ): Promise<ConversationStateUpdate> {
    log.info('chat branch start', {
      traceId: state.traceId,
      fields: { modelCallCount: state.modelCallCount }
    });

    // memory_gate: 判断是否需要检索记忆
    const needMemory = shouldRetrieveMemory(state.userInput, state.messages);
    let retrievedMemories = state.retrievedMemories;

    // retrieve_memory: 检索记忆
    if (needMemory && memoryStore) {
      try {
        const memories = memoryStore.retrieve(state.userId, state.characterId, {
          keyword: extractKeyword(state.userInput),
          limit: 5
        });
        retrievedMemories = memories.map((m) => ({
          id: m.id,
          scope: m.scope as 'global' | 'character',
          type: m.type as 'profile' | 'preference' | 'event' | 'relationship' | 'project',
          content: m.content,
          confidence: m.confidence,
          sourceMessageId: m.source_message_id ?? undefined,
          createdAt: m.created_at,
          updatedAt: m.updated_at
        }));
        log.info('memories retrieved', {
          fields: { count: retrievedMemories.length }
        });
      } catch (error) {
        log.warn('memory retrieval failed', {
          fields: { error: (error as Error)?.message }
        });
      }
    }

    // generate_structured_response: 调用模型
    let responseText = '';
    let expression = DEFAULT_EXPRESSION;
    let motion = DEFAULT_MOTION;

    const modelRequest = {
      messages: buildMessages({ ...state, retrievedMemories }),
      mode: state.modelMode,
      responseFormat: 'json' as const,
      traceId: state.traceId
    };

    try {
      const result = await modelGateway.invokeWithFallback(modelRequest);

      if (result.success && result.parsed) {
        // validate_response: 校验结构化输出
        const parsed = structuredResponseSchema.safeParse(result.parsed);
        if (parsed.success) {
          responseText = parsed.data.text;
          expression = parsed.data.expression || DEFAULT_EXPRESSION;
          motion = parsed.data.motion || DEFAULT_MOTION;
        } else {
          log.warn('structured output invalid, using fallback', {
            fields: { error: parsed.error.issues[0]?.message }
          });
          // 结构化输出无效，使用纯文本内容
          responseText = result.content;
        }
      } else if (result.success) {
        // JSON 解析失败，使用纯文本
        responseText = result.content;
      } else {
        // 模型调用失败，使用后备回复
        log.warn('model call failed, using fallback', {
          fields: { errorCode: result.errorCode }
        });
        const fb = fallbackResponse(state);
        responseText = fb.text;
        expression = fb.expression;
        motion = fb.motion;
      }
    } catch (error) {
      log.error('chat branch failed', {
        traceId: state.traceId,
        fields: { error: (error as Error)?.message }
      });
      const fb = fallbackResponse(state);
      responseText = fb.text;
      expression = fb.expression;
      motion = fb.motion;
    }

    log.info('chat branch complete', {
      traceId: state.traceId,
      fields: { responseLength: responseText.length, expression, motion }
    });

    return {
      retrievedMemories,
      responseText,
      expression,
      motion,
      modelCallCount: modelGateway.getTurnCallCount()
    };
  };
}

/** 从用户输入中提取关键词用于记忆检索 */
function extractKeyword(text: string): string {
  const trimmed = text.trim();

  // 查找常见实体关键词
  const entityPatterns = [
    /生日/, /名字/, /电话/, /地址/, /偏好/, /项目/,
    /工作/, /学校/, /公司/, /家庭/, /爱好/
  ];
  for (const pattern of entityPatterns) {
    const match = trimmed.match(pattern);
    if (match) {
      return match[0];
    }
  }

  // 移除常见停用词后取前几个有意义的字符
  const cleaned = trimmed
    .replace(/[？?！!。.，,吗呢吧啊呀]/g, '')
    .replace(/^(你|我|他|她|它|这|那|还|也|都|就|是|有|在|的|了|吗|呢)/g, '');

  // 取前 10 个字符作为关键词
  return cleaned.slice(0, 10) || trimmed.slice(0, 10);
}
