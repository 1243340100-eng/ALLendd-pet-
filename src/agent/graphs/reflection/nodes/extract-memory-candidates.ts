/**
 * 节点：extract_memory_candidates
 * 使用模型从对话中提取记忆候选。
 * 这是 ReflectionGraph 中唯一消耗模型调用的节点。
 *
 * 模型返回结构化 JSON，包含候选列表。
 * 如果模型调用失败，返回空候选列表（不影响后续流程）。
 */
import type { ReflectionStateType, ReflectionStateUpdate, MemoryCandidate } from '../state';
import type { ModelGateway } from '../../../../services/ModelGateway';
import { createLogger } from '../../../../infrastructure/logging/logger';

const log = createLogger('ReflectionGraph:extract_memory_candidates');

/** 生成唯一 ID */
function generateId(prefix: string): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${ts}-${rand}`;
}

/** 模型提取结果的结构 */
interface ExtractedCandidate {
  type?: string;
  content?: string;
  scope?: string;
  confidence?: number;
  evidenceQuote?: string;
}

/**
 * 创建 extract_memory_candidates 节点工厂。
 * 依赖 ModelGateway 进行模型调用。
 */
export function createExtractMemoryCandidatesNode(modelGateway: ModelGateway) {
  return async function extractMemoryCandidates(
    state: ReflectionStateType
  ): Promise<ReflectionStateUpdate> {
    log.info('extracting memory candidates', {
      traceId: state.traceId
    });

    // 如果已经因为负载不完整而结束，跳过
    if (state.reflectionResult) {
      log.info('reflection already concluded, skipping extraction');
      return {};
    }

    const payload = state.reflectionPayload;
    const personaName = state.persona?.characterName ?? '助手';
    const userPetName = state.persona?.userPetName ?? '用户';

    // 构建提取 prompt
    const systemPrompt = `你是一个记忆提取助手。分析以下用户与AI桌宠${personaName}的对话，提取值得长期记忆的信息。

只提取以下类型的信息：
- profile: 用户的身份信息（如职业、生日）
- preference: 用户的稳定偏好（如喜欢简洁回答、偏好某类音乐）
- event: 有后续价值的重要事件（如考试日期、项目截止日）
- relationship: 用户与当前角色的共同经历或关系信息
- project: 长期项目信息

不要提取：
- 密码、Token、API Key、银行卡号、身份证号
- 一次性验证码
- 普通寒暄（你好、谢谢等）
- 临时情绪（今天心情不好等）
- 模型推测而非用户明确提供的信息

【关键规则——证据引用】
每个候选必须包含 evidenceQuote 字段，值必须是用户消息(userMessage)的原文子串（逐字复制，不可摘要、不可改写）。
- assistantReply 只是语境，不能作为证据来源。
- 如果信息来自 AI 回复而非用户陈述，不要生成候选。
- 用户问"我叫什么名字""你记得我吗"这类查询不应生成记忆候选——这是查询而非陈述。

返回 JSON 格式：
{"candidates": [{"type": "profile|preference|event|relationship|project", "content": "记忆内容", "scope": "global|character", "confidence": 0.0-1.0, "evidenceQuote": "用户原文子串"}]}

如果没有值得记忆的信息，返回 {"candidates": []}`;

    const userPrompt = `【用户消息(userMessage)】用户(${userPetName})说：${payload.userMessage}

【AI回复(assistantReply)】${personaName}回复：${payload.assistantReply}

注意：evidenceQuote 必须从上方【用户消息(userMessage)】中逐字截取，不能从【AI回复】中截取。`;

    try {
      const result = await modelGateway.invoke({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        mode: 'low_cost',
        complexity: 'simple',
        responseFormat: 'json',
        temperature: 0.3,
        maxOutputTokens: 500,
        traceId: state.traceId,
        correlationId: state.event.correlationId
      });

      const candidates = parseExtractedCandidates(result.parsed, result.content);
      log.info('memory candidates extracted', {
        traceId: state.traceId,
        fields: { count: candidates.length }
      });

      return {
        candidates,
        modelCallCount: state.modelCallCount + 1
      };
    } catch (error) {
      log.warn('model extraction failed, returning empty candidates', {
        traceId: state.traceId,
        fields: { error: (error as Error)?.message }
      });
      // 失败不中断，返回空候选
      return {
        candidates: [],
        errors: [...state.errors, {
          code: 'model_unavailable' as const,
          message: (error as Error)?.message ?? 'Model extraction failed',
          node: 'extract_memory_candidates',
          recovered: true,
          occurredAt: new Date().toISOString()
        }]
      };
    }
  };
}

/** 解析模型返回的候选 */
function parseExtractedCandidates(parsed: unknown, rawContent: string): MemoryCandidate[] {
  let data: { candidates?: ExtractedCandidate[] };

  if (parsed && typeof parsed === 'object' && 'candidates' in parsed) {
    data = parsed as { candidates: ExtractedCandidate[] };
  } else {
    // 尝试从原始内容解析 JSON
    try {
      data = JSON.parse(rawContent);
    } catch {
      log.warn('failed to parse model output as JSON', {
        fields: { rawLength: rawContent.length }
      });
      return [];
    }
  }

  if (!data.candidates || !Array.isArray(data.candidates)) {
    return [];
  }

  const validTypes = ['profile', 'preference', 'event', 'relationship', 'project'];
  const validScopes = ['global', 'character'];

  const candidates: MemoryCandidate[] = [];
  for (const item of data.candidates) {
    if (!item.content || typeof item.content !== 'string') continue;
    if (!item.type || !validTypes.includes(item.type)) continue;

    candidates.push({
      type: item.type as MemoryCandidate['type'],
      content: item.content.trim(),
      scope: (item.scope && validScopes.includes(item.scope))
        ? item.scope as MemoryCandidate['scope']
        : 'character', // 默认角色级
      confidence: typeof item.confidence === 'number'
        ? Math.max(0, Math.min(1, item.confidence))
        : 0.5,
      sourceMessageId: undefined,
      evidenceQuote: typeof item.evidenceQuote === 'string' ? item.evidenceQuote.trim() : undefined,
      sourceRole: 'user',
      valid: false,
      updated: false
    });
  }

  return candidates;
}
