/**
 * ConversationHarnessAdapter - personality profile 到 harness 策略的薄适配层。
 *
 * 严格约束（计划第七节）：
 * - 只输出当前轮策略：responseDepth, boundaryAction, playfulness, maxMainPoints, askQuestion, toneHints, mustAvoid
 * - 不生成最终回复
 * - 不增加模型调用
 * - 永远不能覆盖 corePrompt、关系边界和禁区
 *
 * 策略映射（确定性，不调用模型）：
 * - replyLength → responseDepth
 * - proactiveFollowUp → askQuestion
 * - jokeLevel + flirtLevel + tsundereLevel → playfulness
 * - toneHints → 直接传递
 * - mustAvoid → 直接传递
 *
 * boundaryAction 由用户消息中的危险信号决定（默认 comply）。
 * maxMainPoints 由 replyLength 决定。
 */
import type { PersonalityProfile } from './character-onboarding/schemas';
import { createLogger } from '../infrastructure/logging/logger';

const log = createLogger('ConversationHarnessAdapter');

/** harness 策略输出 */
export interface HarnessPolicy {
  /** 回复深度 */
  responseDepth: 'tease' | 'brief' | 'normal' | 'deep';
  /** 边界动作（危险请求时） */
  boundaryAction: 'comply' | 'narrow_scope' | 'push_back' | 'refuse' | 'refuse_and_redirect';
  /** 玩笑/撒娇程度 */
  playfulness: 'none' | 'warm' | 'light_tease' | 'ask_for_praise' | 'soft_pout';
  /** 最大要点数 */
  maxMainPoints: number;
  /** 是否主动追问 */
  askQuestion: boolean;
  /** 语气提示词列表（来自 personality profile，不包含身份信息） */
  toneHints: string[];
  /** 必须避免的话题或表达（来自 personality profile） */
  mustAvoid: string[];
}

/** 危险信号关键词（用于决定 boundaryAction） */
const DANGER_SIGNALS = [
  '自杀', '自残', '杀人', '想死', '不想活', '结束生命',
  '过量服药', '吃很多药', '危险行为', '伤害自己', '伤害别人',
  '炸弹', '武器', '毒品'
];

/** 拒绝信号关键词（需要 refuse_and_redirect） */
const REFUSE_SIGNALS = [
  '越狱', '破解', '黑客', '攻击', '入侵',
  '非法', '违法', '违规'
];

/**
 * 检测用户消息中的危险信号，返回 boundaryAction。
 * 默认 comply，检测到危险信号时升级。
 */
function detectBoundaryAction(userMessage: string): HarnessPolicy['boundaryAction'] {
  const lower = userMessage.toLowerCase();
  for (const signal of DANGER_SIGNALS) {
    if (lower.includes(signal)) {
      return 'refuse_and_redirect';
    }
  }
  for (const signal of REFUSE_SIGNALS) {
    if (lower.includes(signal)) {
      return 'refuse';
    }
  }
  return 'comply';
}

/**
 * 根据 personality profile 的可调参数映射 playfulness。
 * - 全 low → none
 * - flirtLevel high → soft_pout
 * - jokeLevel high → light_tease
 * - 其他组合 → warm
 */
function mapPlayfulness(profile: PersonalityProfile): HarnessPolicy['playfulness'] {
  if (profile.jokeLevel === 'low' && profile.flirtLevel === 'low' && profile.tsundereLevel === 'low') {
    return 'none';
  }
  if (profile.flirtLevel === 'high') {
    return 'soft_pout';
  }
  if (profile.jokeLevel === 'high') {
    return 'light_tease';
  }
  if (profile.tsundereLevel === 'high') {
    return 'ask_for_praise';
  }
  return 'warm';
}

/**
 * 根据 replyLength 映射 responseDepth。
 * - short → brief
 * - medium → normal
 * - long → deep
 */
function mapResponseDepth(replyLength: PersonalityProfile['replyLength']): HarnessPolicy['responseDepth'] {
  switch (replyLength) {
    case 'short': return 'brief';
    case 'long': return 'deep';
    default: return 'normal';
  }
}

/**
 * 根据 replyLength 映射 maxMainPoints。
 */
function mapMaxMainPoints(replyLength: PersonalityProfile['replyLength']): number {
  switch (replyLength) {
    case 'short': return 1;
    case 'long': return 4;
    default: return 2;
  }
}

/**
 * 根据用户消息和 personality profile 生成当前轮 harness 策略。
 *
 * 纯程序逻辑，不调用模型。
 * 输出的策略永远不会覆盖 corePrompt、关系边界和禁区。
 */
export function generateHarnessPolicy(
  profile: PersonalityProfile,
  userMessage: string
): HarnessPolicy {
  const policy: HarnessPolicy = {
    responseDepth: mapResponseDepth(profile.replyLength),
    boundaryAction: detectBoundaryAction(userMessage),
    playfulness: mapPlayfulness(profile),
    maxMainPoints: mapMaxMainPoints(profile.replyLength),
    askQuestion: profile.proactiveFollowUp !== 'low',
    toneHints: [...profile.toneHints],
    mustAvoid: [...profile.mustAvoid]
  };

  log.info('harness policy generated', {
    fields: {
      responseDepth: policy.responseDepth,
      boundaryAction: policy.boundaryAction,
      playfulness: policy.playfulness,
      maxMainPoints: policy.maxMainPoints,
      askQuestion: policy.askQuestion,
      toneHintsCount: policy.toneHints.length,
      mustAvoidCount: policy.mustAvoid.length
    }
  });

  return policy;
}

/**
 * 默认 harness 策略（无 personality profile 时使用）。
 */
export function getDefaultHarnessPolicy(userMessage: string): HarnessPolicy {
  return {
    responseDepth: 'normal',
    boundaryAction: detectBoundaryAction(userMessage),
    playfulness: 'none',
    maxMainPoints: 2,
    askQuestion: false,
    toneHints: [],
    mustAvoid: []
  };
}
