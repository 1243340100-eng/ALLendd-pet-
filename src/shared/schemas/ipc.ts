/**
 * IPC 通道白名单与输入校验 schema。
 * 所有 Renderer → Main 的 IPC 调用输入必须经此校验。
 * 对应架构计划第 1 节"所有 IPC 输入经过 Schema 校验"。
 */
import { z } from 'zod';

/** IPC 通道白名单：只有这些通道允许从 Renderer 调用 */
export const IPC_CHANNELS = [
  'api-config-get',
  'api-config-save',
  'material:list',
  'material:import',
  'material:apply',
  'material:restore-default',
  'runtime:reset-user-data',
  'chat-send',
  'onboarding-submit',
  'onboarding:get-state',
  'onboarding:start',
  'onboarding:submit-answer',
  'onboarding:submit-answers',
  'onboarding:suggest',
  'onboarding:revise-summary',
  'onboarding:confirm-summary',
  'onboarding:reset',
  'onboarding:save-pending-answers',
  'onboarding:clear-pending-answers',
  'proactive-event:ack',
  'safe-shell:interpret',
  'safe-shell:confirm',
  'safe-shell:cancel',
  'safe-shell:get-settings',
  'safe-shell:set-enabled',
  'pet-data:get',
  'pet-data:update',
  'memory:list',
  'memory:add',
  'memory:update',
  'memory:delete',
  'memory:clear-expired-short-term',
  'memory:clear-type',
  'memory:clear-all',
  'memory:export',
  'memory:detect-explicit-intent',
  'memory:analyze-and-apply',
  'architecture:get-status',
  'architecture:trigger-digest',
  'reminder:list',
  'reminder:delete',
  'affection:get',
  'affection:set-score',
  'affection:adjust',
  'affection:detect-event',
  'window:focus',
  'set-window-scale',
  'planning:update-draft'
] as const;

export type IpcChannel = typeof IPC_CHANNELS[number];

/** 判断通道是否在白名单内 */
export function isKnownIpcChannel(channel: string): channel is IpcChannel {
  return (IPC_CHANNELS as readonly string[]).includes(channel);
}

/** 各通道输入 schema */
export const ipcInputSchemas = {
  'api-config-save': z.object({
    provider: z.string().min(1).max(64),
    endpoint: z.string().url(),
    model: z.string().min(1).max(128),
    apiKey: z.string().max(512).optional()
  }),
  'material:apply': z.string().regex(/^material-[a-z0-9-]{8,80}$/i),
  'chat-send': z.object({
    message: z.string().min(1).max(8000),
    history: z.array(z.object({
      role: z.enum(['user', 'assistant']),
      content: z.string().max(8000),
      excludeFromAi: z.boolean().optional()
    })).max(200).optional()
  }),
  'safe-shell:interpret': z.string().min(1).max(2000),
  'safe-shell:confirm': z.string().min(1).max(128),
  'safe-shell:cancel': z.string().min(1).max(128),
  'safe-shell:set-enabled': z.boolean(),
  'memory:add': z.tuple([
    z.string().min(1).max(32),
    z.string().min(1).max(8000),
    z.record(z.string(), z.unknown()).optional()
  ]),
  'memory:update': z.tuple([
    z.string().min(1).max(32),
    z.string().min(1).max(128),
    z.record(z.string(), z.unknown())
  ]),
  'memory:delete': z.tuple([
    z.string().min(1).max(32),
    z.string().min(1).max(128)
  ]),
  'memory:list': z.string().min(1).max(32),
  'memory:clear-type': z.string().min(1).max(32),
  'onboarding-submit': z.object({
    nickname: z.string().min(1).max(32),
    preferredName: z.string().min(1).max(32),
    replyLength: z.enum(['short', 'medium', 'long']),
    proactiveLevel: z.enum(['low', 'medium', 'high']),
    weatherCity: z.string().max(64),
    weatherEnabled: z.boolean(),
    dndEnabled: z.boolean(),
    dndStart: z.string().max(8).optional(),
    dndEnd: z.string().max(8).optional(),
    systemNotificationEnabled: z.boolean(),
    soundEnabled: z.boolean(),
    memoryEnabled: z.boolean()
  }).refine(
    data => !data.weatherEnabled || data.weatherCity.trim().length > 0,
    { message: '启用天气时城市不能为空', path: ['weatherCity'] }
  ),
  'proactive-event:ack': z.string().min(1).max(128),
  'reminder:delete': z.string().min(1).max(128),
  'affection:set-score': z.tuple([
    z.number().min(0).max(100),
    z.string().max(500).optional()
  ]),
  'affection:adjust': z.tuple([
    z.number().min(-100).max(100),
    z.string().max(64),
    z.string().max(500).optional(),
    z.record(z.string(), z.unknown()).optional()
  ]),
  'set-window-scale': z.number().min(0.2).max(3),
  'planning:update-draft': z.object({
    planId: z.string().min(1).max(128),
    tasks: z.array(z.object({
      id: z.string().min(1).max(128).optional(),
      content: z.string().max(500).optional(),
      start_time: z.string().max(8).optional(),
      end_time: z.string().max(8).optional(),
      completed: z.union([z.boolean(), z.number()]).optional()
    })).max(50)
  }),
  // ===== V8 角色初始化向导 IPC =====
  // 'onboarding:get-state'：无输入，主进程从 checkpoint 恢复（无需 schema，走默认通过分支）
  // 启动向导（首次或重置后开始）
  'onboarding:start': z.object({
    revision: z.number().int().min(0)
  }).strict(),
  // 用户提交自然语言回答
  'onboarding:submit-answer': z.object({
    answer: z.string().min(1).max(2000),
    revision: z.number().int().min(0)
  }).strict(),
  // 用户在 review 阶段返回修改意见
  // targetStage 存在时：确定性地路由到该阶段的 generate_questions，不调用 AnswerExtractor
  // targetStage 不存在时：走 AnswerExtractor 自然语言提取流程
  'onboarding:revise-summary': z.object({
    feedback: z.string().min(1).max(2000),
    revision: z.number().int().min(0),
    targetStage: z.enum(['basic', 'speaking', 'relationship', 'taboos']).optional()
  }).strict(),
  // 用户确认摘要，触发 compile + lock
  'onboarding:confirm-summary': z.object({
    revision: z.number().int().min(0)
  }).strict(),
  // ===== V9 问题卡片协议 =====
  // V9：用户提交结构化问题卡片回答
  // 安全约束：不接收 selectedValues，后端从 checkpoint 中的 question.options 重新映射
  'onboarding:submit-answers': z.object({
    answers: z.array(z.object({
      questionId: z.string().min(1).max(128),
      fieldPaths: z.array(z.string().min(1).max(64)).min(1).max(4),
      answerType: z.enum(['text', 'single_choice', 'multiple_choice', 'hybrid']),
      selectedOptionIds: z.array(z.string().min(1).max(32)).max(8).optional(),
      customText: z.string().max(2000).optional(),
      usedSuggestedAnswer: z.boolean().optional()
    })).min(1).max(8),
    revision: z.number().int().min(0)
  }).strict(),
  // V9：用户请求 AI 建议答案
  'onboarding:suggest': z.object({
    questionId: z.string().min(1).max(128),
    revision: z.number().int().min(0)
  }).strict(),
  // P2: 保存未提交的卡片选择（debounce 后批量保存）
  // 安全约束：不接收 selectedValues，后端从 checkpoint 的 question.options 重新映射
  'onboarding:save-pending-answers': z.object({
    answers: z.array(z.object({
      questionId: z.string().min(1).max(128),
      selectedOptionIds: z.array(z.string().min(1).max(32)).max(8).optional(),
      customText: z.string().max(2000).optional(),
      usedSuggestedAnswer: z.boolean().optional()
    })).max(8),
    revision: z.number().int().min(0)
  }).strict(),
  // P2: 清除未提交的卡片选择（提交成功/进入下一批/reset 时调用）
  'onboarding:clear-pending-answers': z.object({
    revision: z.number().int().min(0)
  }).strict()
} as const;

/** 校验指定通道的输入 */
export function validateIpcInput(
  channel: string,
  input: unknown
): { valid: true; data: unknown } | { valid: false; issues: Array<{ path: string; message: string }> } {
  if (!isKnownIpcChannel(channel)) {
    return {
      valid: false,
      issues: [{ path: 'channel', message: `Unknown IPC channel: ${channel}` }]
    };
  }
  const schema = (ipcInputSchemas as Record<string, z.ZodTypeAny>)[channel];
  if (!schema) {
    // 通道存在但无需校验输入（如 get 类）
    return { valid: true, data: input };
  }
  const result = schema.safeParse(input);
  if (result.success) {
    return { valid: true, data: result.data };
  }
  return {
    valid: false,
    issues: result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message
    }))
  };
}
