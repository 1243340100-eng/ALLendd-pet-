/**
 * agent_decide 节点。
 * 通过 ModelGateway 调用 planningModel，决定下一步动作。
 *
 * 要求 1：planning 请求统一经过 ModelGateway，不得直接 fetch。
 * 要求 2：使用 planningModel 别名（经 ModelGateway 解析为真实 API model ID）。
 * 要求 3：状态面板显示 planningModel 实际解析值和 response.model。
 * 要求 5：Agent 可以选择 ask_clarification / create_draft / patch_tasks / delete_task / add_task / request_confirmation / publish_plan。
 * 要求 9：加入 TimeService 当前时间、时区、用户资料和现有计划上下文。
 */
import type { PlanningStateType } from '../state';
import type { ModelGateway } from '../../../../services/ModelGateway';
import { MODEL_ALIAS } from '../../../../shared/constants';
import { getDefaultAppConfig, applyUserModelAliases, resolveModelName } from '../../../../infrastructure/config/config-loader';
import { validateAgentAction } from '../tools';
import { settingsRepository } from '../../../../infrastructure/database/repositories/settings-repository';
import { createLogger } from '../../../../infrastructure/logging/logger';
import { sanitizePlanningTraceText } from '../sanitize';

const log = createLogger('PlanningGraph:agentDecide');

/** 确认关键词 - 用户说这些话表示确认发布。
 * 修复 6：收紧确认条件，"好的"不再作为确认关键词，因为太容易在日常对话中出现。
 * 只有明确的确认意图才算确认。
 */
const CONFIRMATION_KEYWORDS = ['就这样', '确认', '没问题', '可以了', '发布吧', '就这样吧', '确定了', 'ok', 'OK'];

/** 判断用户输入是否为确认信号 */
export function isConfirmationInput(input: string): boolean {
  const trimmed = input.trim().toLowerCase();
  return CONFIRMATION_KEYWORDS.some(kw => trimmed === kw.toLowerCase() || trimmed === kw.toLowerCase());
}

/**
 * 根据动作类型生成默认消息。
 * 当模型输出缺少 message 字段时使用（v4-pro 在 patch_tasks 等复杂场景下可能缺失）。
 */
function getDefaultMessage(action: { type?: string; clarificationQuestion?: string }): string {
  switch (action.type) {
    case 'ask_clarification':
      return action.clarificationQuestion ?? '能再补充一下细节吗？';
    case 'create_draft':
      return '好的，我为你生成了今日计划草案，请查看。';
    case 'patch_tasks':
      return '好的，我已经调整了任务安排。';
    case 'delete_task':
      return '好的，已经删除了指定任务。';
    case 'add_task':
      return '好的，已经添加了新任务。';
    case 'request_confirmation':
      return '草案已就绪，确认发布吗？';
    case 'publish_plan':
      return '好的，正在为你发布计划。';
    default:
      return '好的。';
  }
}

/** 构建 system prompt */
function buildSystemPrompt(state: PlanningStateType): string {
  const time = state.timeContext;
  const user = state.userContext;
  const draft = state.currentDraft;

  const timeInfo = time
    ? `当前时间：${time.localDisplay}（${time.weekday}），时区：${time.timezone}（UTC${time.utcOffset}）`
    : '当前时间未知';

  const userInfo = user
    ? `用户昵称：${user.displayName}`
    : '用户信息未知';

  // 包含任务 ID 和 order_index，供 patch_tasks / delete_task 引用
  const draftInfo = draft && draft.tasks.length > 0
    ? `当前草案（版本 ${draft.draftVersion}）：\n${draft.tasks.map((t, i) => `${i + 1}. [id=${t.id}] ${t.start_time}-${t.end_time} ${t.content}`).join('\n')}`
    : '当前没有草案';

  // 阶段提示：让模型知道当前是否处于 awaiting_confirmation
  const phaseHint = state.awaitingConfirmation
    ? '\n当前阶段：草案已就绪，正在等待用户确认。用户如果说"就这样/确认/没问题"等明确确认词时，可以选择 publish_plan。'
    : '';

  return `你是用户的桌面宠物助手，擅长帮用户制定可执行的一日计划。

当前上下文：
${timeInfo}
${userInfo}
${draftInfo}${phaseHint}

你可以选择以下动作之一（输出严格 JSON，不要包裹在 markdown 代码块中）：

1. ask_clarification - 当用户目标模糊时，询问关键问题（如具体时间、优先级）。信息充分时不要追问。
2. create_draft - 信息充分时，创建计划草案（首次或完全重建）
3. patch_tasks - 局部修改任务（如"把第二项推迟半小时"、"下午不要太满"）。使用 patches 数组，每项含 id 字段引用任务。
4. delete_task - 删除单个任务（如"删除代码审查"）。使用 taskId 字段引用任务 ID。
5. add_task - 添加新任务到已有草案。新任务时间必须与现有任务不冲突。
6. request_confirmation - 草案完成后请求用户确认
7. publish_plan - 用户明确确认后发布计划（仅当用户说"就这样"等明确确认词时）

规则：
- 模糊目标会先询问关键问题，不直接编造时间表
- 信息充分时不进行多余询问，直接生成草案
- 用户反馈优先 patch 当前草案，不默认删除全部任务重建
- "把第二项推迟半小时"只修改目标任务，不影响其他任务
- "删除代码审查"不会改变其他任务
- "下午不要排太满"等语义修改：保留主要目标和顺序，合理拉长任务间隔或缩短任务时长增加缓冲
- 添加任务时：在现有任务之间或之后寻找不冲突的时间段；如果用户指定的时间与现有任务冲突，先解释冲突并提出调整方案（如推迟新任务或缩短时长），不要直接覆盖现有任务
- 当前时间之后才允许安排未开始任务
- 每个任务必须带开始时间和结束时间（HH:MM 格式）
- 任务数量 3-6 个，时间段不重叠
- 任务要具体可执行
- 每轮只输出一个动作，不要在 message 中编造未写入 tasks/patches 的内容

输出格式（严格 JSON）：
{
  "type": "动作类型",
  "clarificationQuestion": "追问问题（仅 ask_clarification 时）",
  "tasks": [{"start_time": "09:00", "end_time": "10:00", "content": "任务内容"}],
  "patches": [{"id": "任务ID", "start_time": "新时间", "end_time": "新时间", "content": "新内容"}],
  "taskId": "要删除的任务ID",
  "taskIndex": 1,
  "newTask": {"start_time": "11:00", "end_time": "12:00", "content": "新任务内容"},
  "message": "你对用户说的话"
}`;
}

/** 构建 user message */
function buildUserMessage(state: PlanningStateType): string {
  return state.userInput;
}

/** 创建 agent_decide 节点 */
export function createAgentDecideNode(deps: { modelGateway: ModelGateway }) {
  return async function agentDecide(state: PlanningStateType): Promise<Partial<PlanningStateType>> {
    // 修复 3：如果已发布，不允许再次发布（防止重复发布）
    if (state.published) {
      log.info('plan already published, skipping', {
        traceId: state.traceId,
        fields: { input: sanitizePlanningTraceText(state.userInput, 100) }
      });
      return {
        agentAction: {
          type: 'ask_clarification' as const,
          clarificationQuestion: '计划已经发布了，如需修改请告诉我。',
          message: '计划已经发布了，如需修改请告诉我。'
        },
        responseText: '计划已经发布了，如需修改请告诉我。',
        shouldAskUser: true,
        modelCallCount: state.modelCallCount
      };
    }

    // 修复 6：收紧确认条件
    // - "好的"不再在任何有草案的状态下自动发布
    // - 对话确认只允许在 awaiting_confirmation 阶段生效
    // - 确认按钮（isConfirmation=true）作为明确确认事件，可以在有草案时发布
    if (state.isConfirmation) {
      // 确认按钮事件：明确确认，可以在有草案时发布
      log.info('explicit confirmation button event, skipping model call', {
        traceId: state.traceId,
        fields: { input: sanitizePlanningTraceText(state.userInput, 100) }
      });

      if (state.currentDraft) {
        const planId = state.currentDraft.planId;
        const { planRepository } = require('../../../../infrastructure/database/repositories/plan-repository');
        planRepository.markUserConfirmed(planId);

        return {
          userConfirmed: true,
          agentAction: {
            type: 'publish_plan' as const,
            message: '好的，计划已发布！'
          },
          responseText: '好的，计划已发布！',
          modelCallCount: state.modelCallCount
        };
      }

      return {
        userConfirmed: true,
        agentAction: {
          type: 'ask_clarification' as const,
          clarificationQuestion: '还没有计划草案，请先告诉我你今天的目标。',
          message: '还没有计划草案，请先告诉我你今天的目标。'
        },
        responseText: '还没有计划草案，请先告诉我你今天的目标。',
        shouldAskUser: true,
        modelCallCount: state.modelCallCount
      };
    }

    // 对话中的确认关键词：只在 awaiting_confirmation 阶段生效
    if (isConfirmationInput(state.userInput)) {
      if (state.awaitingConfirmation && state.currentDraft) {
        log.info('dialog confirmation in awaiting_confirmation phase, publishing', {
          traceId: state.traceId,
          fields: { input: sanitizePlanningTraceText(state.userInput, 100) }
        });
        const planId = state.currentDraft.planId;
        const { planRepository } = require('../../../../infrastructure/database/repositories/plan-repository');
        planRepository.markUserConfirmed(planId);

        return {
          userConfirmed: true,
          agentAction: {
            type: 'publish_plan' as const,
            message: '好的，计划已发布！'
          },
          responseText: '好的，计划已发布！',
          modelCallCount: state.modelCallCount
        };
      }

      // 不在 awaiting_confirmation 阶段的确认词：不自动发布，交给模型处理
      log.info('confirmation keyword outside awaiting_confirmation phase, deferring to model', {
        traceId: state.traceId,
        fields: { input: sanitizePlanningTraceText(state.userInput, 100), awaitingConfirmation: state.awaitingConfirmation }
      });
    }

    // 调用 ModelGateway（使用 planningModel 别名）
    const systemPrompt = buildSystemPrompt(state);
    const userMessage = buildUserMessage(state);

    // 解析 planningModel 别名为实际模型 ID（供状态面板显示）
    // 从用户配置 + 默认配置合并后解析
    const defaultConfig = getDefaultAppConfig();
    const userAliases = settingsRepository.getModelAliases();
    const mergedConfig = applyUserModelAliases(defaultConfig, userAliases);
    const resolvedModel = resolveModelName(mergedConfig.modelAliases, MODEL_ALIAS.PLANNING);
    // 读取用户配置的模型 ID（供 trace 记录三者一致性检查）
    const configuredModel = settingsRepository.get('model_alias_planning') ?? '';

    log.info('calling planning model', {
      traceId: state.traceId,
      fields: {
        alias: MODEL_ALIAS.PLANNING,
        resolvedModel,
        hasDraft: !!state.currentDraft,
        inputLength: state.userInput.length,
        hasLastError: !!state.lastToolError
      }
    });

    // 修复 2：如果有上一次工具错误，注入到模型上下文，禁止盲目重试
    const modelMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: systemPrompt },
      ...state.messages.map(m => ({ role: m.role, content: m.content }))
    ];

    if (state.lastToolError) {
      // 注入上一次工具错误信息，让模型知道什么失败了
      modelMessages.push({ role: 'user', content: userMessage });
      modelMessages.push({
        role: 'assistant',
        content: `我尝试执行动作 ${state.lastAttemptedAction || '(unknown)'}，但失败了。错误：${state.lastToolError}`
      });
      modelMessages.push({
        role: 'user',
        content: '上一次操作失败了，请根据错误信息修正并重新选择动作。不要重复完全相同的动作。'
      });
    } else {
      modelMessages.push({ role: 'user', content: userMessage });
    }

    const result = await deps.modelGateway.invoke({
      messages: modelMessages,
      mode: 'balanced',
      alias: MODEL_ALIAS.PLANNING,
      responseFormat: 'json',
      temperature: 0.7,
      maxOutputTokens: 8000,
      traceId: state.traceId
    });

    // 记录模型透明度信息
    const responseModel = result.model; // API 返回的真实模型
    if (state.currentDraft) {
      const { planRepository } = require('../../../../infrastructure/database/repositories/plan-repository');
      planRepository.updateModelInfo(state.currentDraft.planId, resolvedModel || null, responseModel || null);
    }
    // 保存到 settings 供状态面板读取
    if (resolvedModel) {
      settingsRepository.setPlanningModelResolved(resolvedModel);
    }

    if (!result.success) {
      log.error('planning model call failed', {
        traceId: state.traceId,
        fields: { errorCode: result.errorCode }
      });
      return {
        errors: [...state.errors, {
          code: result.errorCode ?? 'model_invalid_output' as const,
          message: 'Planning model call failed',
          node: 'agent_decide',
          recovered: false,
          occurredAt: new Date().toISOString()
        }],
        modelCallCount: state.modelCallCount + 1,
        resolvedModel,
        responseModel,
        configuredModel,
        // 累计 token（即使失败也累加）
        totalInputTokens: state.totalInputTokens + (result.inputTokens ?? 0),
        totalOutputTokens: state.totalOutputTokens + (result.outputTokens ?? 0),
        tracePhases: [...state.tracePhases, {
          name: 'agent_decide',
          success: false,
          error: result.errorCode ?? 'model call failed',
          durationMs: result.durationMs
        }]
      };
    }

    // 解析模型输出的 JSON
    let parsed: unknown;
    try {
      parsed = typeof result.parsed === 'object' ? result.parsed : JSON.parse(result.content);
    } catch {
      // 处理可能的 markdown 代码块包裹
      let cleaned = result.content.trim();
      if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
        try {
          parsed = JSON.parse(cleaned);
        } catch {
          parsed = undefined;
        }
      }
    }

    // 诊断日志：记录解析后的对象结构（使用非脱敏字段名）
    if (parsed && typeof parsed === 'object') {
      const parsedObj = parsed as Record<string, unknown>;
      log.info('parsed model output structure', {
        traceId: state.traceId,
        fields: {
          parsedKeys: Object.keys(parsedObj),
          hasMessage: 'message' in parsedObj,
          messageType: typeof parsedObj.message,
          actionType: parsedObj.type
        }
      });
    } else {
      log.warn('parsed model output is not an object', {
        traceId: state.traceId,
        fields: {
          parsedType: typeof parsed,
          rawModelOutput: result.content.slice(0, 500)
        }
      });
    }

    // 预处理：确保 message 字段存在且为非空字符串（v4-pro 兼容性防御）
    // 即使 Zod schema 已设为 optional，某些模型可能在复杂场景下输出非预期结构。
    // 在校验前预填充，确保 Zod 校验不会因 message 缺失而失败。
    if (parsed && typeof parsed === 'object') {
      const parsedObj = parsed as Record<string, unknown>;
      if (typeof parsedObj.message !== 'string' || parsedObj.message.trim().length === 0) {
        const defaultMsg = getDefaultMessage(parsedObj);
        log.info('pre-filling missing message field', {
          traceId: state.traceId,
          fields: { actionType: parsedObj.type, defaultMsg }
        });
        parsedObj.message = defaultMsg;
      }
    }

    // Zod 校验
    const validation = validateAgentAction(parsed);
    if (!validation.valid) {
      log.warn('agent action validation failed', {
        traceId: state.traceId,
        fields: {
          error: validation.error,
          rawModelOutput: result.content.slice(0, 500),
          parsedKeys: parsed && typeof parsed === 'object' ? Object.keys(parsed as object) : 'not-object',
          parsedHasMessage: parsed && typeof parsed === 'object' ? 'message' in (parsed as object) : false
        }
      });
      return {
        errors: [...state.errors, {
          code: 'model_invalid_output' as const,
          message: `模型输出非法参数: ${validation.error}`,
          node: 'agent_decide',
          recovered: false,
          occurredAt: new Date().toISOString()
        }],
        modelCallCount: state.modelCallCount + 1,
        resolvedModel,
        responseModel,
        configuredModel,
        // 累计 token（校验失败但模型已调用，token 已消耗）
        totalInputTokens: state.totalInputTokens + (result.inputTokens ?? 0),
        totalOutputTokens: state.totalOutputTokens + (result.outputTokens ?? 0),
        responseText: '抱歉，我理解你的需求时遇到了问题，能再详细说明一下吗？',
        shouldAskUser: true,
        tracePhases: [...state.tracePhases, {
          name: 'agent_decide',
          success: false,
          error: `validation: ${validation.error?.slice(0, 120)}`,
          durationMs: result.durationMs
        }]
      };
    }

    const action = validation.action!;
    // 修复 v4-pro 兼容性：模型可能未输出 message 字段，此时使用默认消息补全
    const usedDefaultMessage = !action.message;
    if (usedDefaultMessage) {
      action.message = getDefaultMessage(action);
      log.info('agent action message missing, using default', {
        traceId: state.traceId,
        fields: { actionType: action.type, defaultMsg: action.message }
      });
    }

    log.info('agent action decided', {
      traceId: state.traceId,
      fields: { actionType: action.type, hasMessage: !!action.message, usedDefaultMessage }
    });

    return {
      agentAction: action,
      responseText: action.message,
      shouldAskUser: action.type === 'ask_clarification',
      awaitingConfirmation: action.type === 'request_confirmation',
      modelCallCount: state.modelCallCount + 1,
      resolvedModel,
      responseModel,
      // Trace: 记录 token usage 和耗时
      lastInputTokens: result.inputTokens,
      lastOutputTokens: result.outputTokens,
      // 累计 token（所有模型调用之和）
      totalInputTokens: state.totalInputTokens + (result.inputTokens ?? 0),
      totalOutputTokens: state.totalOutputTokens + (result.outputTokens ?? 0),
      lastModelDurationMs: result.durationMs,
      configuredModel,
      tracePhases: [...state.tracePhases, {
        name: 'agent_decide',
        success: true,
        actionType: action.type,
        durationMs: result.durationMs
      }]
    };
  };
}
