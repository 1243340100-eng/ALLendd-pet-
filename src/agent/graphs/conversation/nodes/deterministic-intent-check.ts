/**
 * 节点：deterministic_intent_check
 * 基于规则的意图检测，不消耗模型调用。
 *
 * 检测模式：
 * - create_reminder: 用户明确说"提醒我..."、"帮我定个提醒..."等
 * - list_schedule: "今天有什么..."、"今日计划"、"待办"等
 * - expression: "笑一下"、"挥手"、"跳一下"等表情请求
 * - chat: 默认
 *
 * 明确说"提醒我……"即视为本次创建授权。
 */
import type { ConversationStateType, ConversationStateUpdate } from '../state';
import type { Intent } from '../state';
import { SKILL_ID } from '../../../../shared/constants';
import { createLogger } from '../../../../infrastructure/logging/logger';

const log = createLogger('ConversationGraph:deterministic_intent_check');

/** 创建提醒的关键词模式 */
const REMINDER_PATTERNS = [
  /提醒我/,
  /帮我.*提醒/,
  /设.*提醒/,
  /定.*提醒/,
  /设置.*闹钟/,
  /帮我.*定时/
];

/** 查询计划的关键词模式 */
const SCHEDULE_PATTERNS = [
  /今天.*(?:有什么|哪些|计划|安排|提醒|待办|任务)/,
  /今日(?:计划|安排|待办|任务)/,
  /有什么.*(?:计划|安排|提醒|待办|任务)/,
  /我的.*(?:计划|安排|待办|任务)/
];

/** 表情请求的关键词模式 */
const EXPRESSION_PATTERNS = [
  /(?:笑|开心|高兴|难过|伤心|生气)一下/,
  /挥(?:手|一下)/,
  /跳(?:一下|跃)/,
  /跑(?:一下)/,
  /(?:发呆|休息)一下/,
  /变.*(?:表情|动作)/,
  /(?:做.*表情|做.*动作)/
];

/** 表情映射 */
const EXPRESSION_MAP: Record<string, string> = {
  '笑': 'idle',
  '开心': 'jumping',
  '高兴': 'jumping',
  '难过': 'failed',
  '伤心': 'failed',
  '生气': 'failed',
  '挥手': 'waving',
  '跳': 'jumping',
  '跑': 'running',
  '发呆': 'idle',
  '休息': 'idle'
};

/** 检测意图 */
export function detectIntent(text: string): {
  intent: Intent;
  selectedSkillId: string | null;
  expression?: string;
} {
  const trimmed = text.trim();

  // 检查提醒
  for (const pattern of REMINDER_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { intent: 'create_reminder', selectedSkillId: SKILL_ID.CREATE_REMINDER };
    }
  }

  // 检查计划查询
  for (const pattern of SCHEDULE_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { intent: 'list_schedule', selectedSkillId: SKILL_ID.LIST_TODAY_SCHEDULE };
    }
  }

  // 检查表情请求
  for (const pattern of EXPRESSION_PATTERNS) {
    if (pattern.test(trimmed)) {
      // 尝试匹配具体表情
      let expression = 'idle';
      for (const [keyword, expr] of Object.entries(EXPRESSION_MAP)) {
        if (trimmed.includes(keyword)) {
          expression = expr;
          break;
        }
      }
      return {
        intent: 'expression',
        selectedSkillId: SKILL_ID.SET_PET_EXPRESSION,
        expression
      };
    }
  }

  // 默认聊天
  return { intent: 'chat', selectedSkillId: null };
}

export async function deterministicIntentCheck(
  state: ConversationStateType
): Promise<ConversationStateUpdate> {
  log.info('checking intent deterministically', {
    traceId: state.traceId
  });

  // checkpoint 恢复：如果已有提醒草稿且缺失字段，保持 create_reminder 意图
  // 用户补充时间（如"明天下午3点"）时不会包含"提醒我"关键词，
  // 但应继续创建提醒流程而非进入普通聊天
  if (state.reminderDraft && state.missingFields.length > 0) {
    log.info('checkpoint resume detected, keeping create_reminder intent', {
      traceId: state.traceId,
      fields: { missingFields: state.missingFields }
    });
    return {
      intent: 'create_reminder',
      selectedSkillId: SKILL_ID.CREATE_REMINDER
    };
  }

  const result = detectIntent(state.userInput);

  log.info('intent detected', {
    traceId: state.traceId,
    fields: { intent: result.intent, skillId: result.selectedSkillId }
  });

  const update: ConversationStateUpdate = {
    intent: result.intent,
    selectedSkillId: result.selectedSkillId
  };

  // 如果检测到表情请求，预设表情
  if (result.expression) {
    update.expression = result.expression;
  }

  return update;
}
