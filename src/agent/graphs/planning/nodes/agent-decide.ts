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

const log = createLogger('PlanningGraph:agentDecide');

/** 确认关键词 - 用户说这些话表示确认发布 */
const CONFIRMATION_KEYWORDS = ['就这样', '确认', '没问题', '可以了', '发布吧', '就这样吧', '确定了', 'ok', 'OK', '好的'];

/** 判断用户输入是否为确认信号 */
export function isConfirmationInput(input: string): boolean {
  const trimmed = input.trim().toLowerCase();
  return CONFIRMATION_KEYWORDS.some(kw => trimmed === kw.toLowerCase() || trimmed === kw.toLowerCase());
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

  const draftInfo = draft && draft.tasks.length > 0
    ? `当前草案（版本 ${draft.draftVersion}）：\n${draft.tasks.map((t, i) => `${i + 1}. ${t.start_time}-${t.end_time} ${t.content}`).join('\n')}`
    : '当前没有草案';

  return `你是用户的桌面宠物助手，擅长帮用户制定可执行的一日计划。

当前上下文：
${timeInfo}
${userInfo}
${draftInfo}

你可以选择以下动作之一（输出严格 JSON，不要包裹在 markdown 代码块中）：

1. ask_clarification - 当用户目标模糊时，询问关键问题（如具体时间、优先级）
2. create_draft - 信息充分时，创建计划草案（首次或完全重建）
3. patch_tasks - 局部修改任务（如"把第二项推迟半小时"、"下午不要太满"）
4. delete_task - 删除单个任务（如"删除代码审查"）
5. add_task - 添加新任务到已有草案
6. request_confirmation - 草案完成后请求用户确认
7. publish_plan - 用户明确确认后发布计划（仅当用户说"就这样"等确认词时）

规则：
- 模糊目标会先询问关键问题，不直接编造时间表
- 信息充分时不进行多余询问，直接生成草案
- 用户反馈优先 patch 当前草案，不默认删除全部任务重建
- "把第二项推迟半小时"只修改目标任务，不影响其他任务
- "删除代码审查"不会改变其他任务
- 当前时间之后才允许安排未开始任务
- 每个任务必须带开始时间和结束时间（HH:MM 格式）
- 任务数量 3-6 个，时间段不重叠
- 任务要具体可执行

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
    // 要求 12：输入框反馈、确认按钮、手动改时间都进入同一个 PlanningGraph
    // 如果是确认信号，直接设置 userConfirmed，不调用模型
    if (state.isConfirmation || isConfirmationInput(state.userInput)) {
      log.info('user confirmation detected, skipping model call', {
        traceId: state.traceId,
        fields: { input: state.userInput }
      });

      // 如果有草案，标记用户确认并直接发布
      if (state.currentDraft) {
        const planId = state.currentDraft.planId;
        const { planRepository } = require('../../../../infrastructure/database/repositories/plan-repository');
        planRepository.markUserConfirmed(planId);

        // 直接执行 publish_plan
        return {
          userConfirmed: true,
          agentAction: {
            type: 'publish_plan' as const,
            message: '好的，计划已发布！'
          },
          responseText: '好的，计划已发布！',
          modelCallCount: state.modelCallCount // 不增加，未调用模型
        };
      }

      // 没有草案却确认，返回提示
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

    // 调用 ModelGateway（使用 planningModel 别名）
    const systemPrompt = buildSystemPrompt(state);
    const userMessage = buildUserMessage(state);

    // 解析 planningModel 别名为实际模型 ID（供状态面板显示）
    // 从用户配置 + 默认配置合并后解析
    const defaultConfig = getDefaultAppConfig();
    const userAliases = settingsRepository.getModelAliases();
    const mergedConfig = applyUserModelAliases(defaultConfig, userAliases);
    const resolvedModel = resolveModelName(mergedConfig.modelAliases, MODEL_ALIAS.PLANNING);

    log.info('calling planning model', {
      traceId: state.traceId,
      fields: {
        alias: MODEL_ALIAS.PLANNING,
        resolvedModel,
        hasDraft: !!state.currentDraft,
        inputLength: state.userInput.length
      }
    });

    const result = await deps.modelGateway.invoke({
      messages: [
        { role: 'system', content: systemPrompt },
        ...state.messages.map(m => ({ role: m.role, content: m.content })),
        { role: 'user', content: userMessage }
      ],
      mode: 'balanced',
      alias: MODEL_ALIAS.PLANNING,
      responseFormat: 'json',
      temperature: 0.7,
      maxOutputTokens: 2000,
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
        responseModel
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

    // Zod 校验
    const validation = validateAgentAction(parsed);
    if (!validation.valid) {
      log.warn('agent action validation failed', {
        traceId: state.traceId,
        fields: { error: validation.error, content: result.content.slice(0, 200) }
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
        responseText: '抱歉，我理解你的需求时遇到了问题，能再详细说明一下吗？',
        shouldAskUser: true
      };
    }

    const action = validation.action!;
    log.info('agent action decided', {
      traceId: state.traceId,
      fields: { actionType: action.type, hasMessage: !!action.message }
    });

    return {
      agentAction: action,
      responseText: action.message,
      shouldAskUser: action.type === 'ask_clarification',
      awaitingConfirmation: action.type === 'request_confirmation',
      modelCallCount: state.modelCallCount + 1,
      resolvedModel,
      responseModel
    };
  };
}
