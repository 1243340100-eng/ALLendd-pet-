/**
 * 节点：compose_message
 * 根据事件类型组合消息文本。
 *
 * 开机日报包含：角色问候、今日提醒、今日任务、未完成任务、天气。
 * 天气失败时显示"天气暂时不可用"，其余日报照常生成。
 */
import type { ProactiveStateType, ProactiveStateUpdate } from '../state';
import { PROACTIVE_DEFAULT_EXPRESSION, PROACTIVE_DEFAULT_MOTION } from '../state';
import { createLogger } from '../../../../infrastructure/logging/logger';

const log = createLogger('ProactiveGraph:compose_message');

export async function composeMessage(
  state: ProactiveStateType
): Promise<ProactiveStateUpdate> {
  log.info('composing message', {
    traceId: state.traceId,
    fields: { proactiveType: state.proactiveType, delivery: state.delivery }
  });

  // 已被抑制：不需要组合消息
  if (state.delivery === 'suppressed') {
    return { composedMessage: '' };
  }

  let message = '';
  let expression = PROACTIVE_DEFAULT_EXPRESSION;
  let motion = PROACTIVE_DEFAULT_MOTION;

  switch (state.proactiveType) {
    case 'reminder':
      message = composeReminderMessage(state);
      expression = 'waiting';
      motion = 'waving';
      break;
    case 'startup_digest':
      message = composeStartupDigest(state);
      expression = 'waving';
      motion = 'waving';
      break;
    case 'daily_greeting':
      message = composeDailyGreeting(state);
      expression = 'idle';
      motion = 'idle';
      break;
  }

  log.info('message composed', {
    fields: { messageLength: message.length }
  });

  return { composedMessage: message, expression, motion };
}

/** 组合提醒消息 */
function composeReminderMessage(state: ProactiveStateType): string {
  const payload = state.event.payload as { content?: string; priority?: string };
  const content = payload.content ?? (state.composedMessage || '提醒');
  const priority = payload.priority;
  const prefix = priority === 'high' ? '[重要] ' : '';
  return `${prefix}提醒：${content}`;
}

/** 组合开机日报 */
function composeStartupDigest(state: ProactiveStateType): string {
  const parts: string[] = [];
  const userPetName = state.persona?.userPetName ?? '';
  const greeting = userPetName ? `${userPetName}，早上好！` : '早上好！';
  parts.push(greeting);

  // 日程
  if (state.scheduleItems.length > 0) {
    const scheduleLines = state.scheduleItems.map((item) => {
      const prefix = item.overdue ? '[已过期] ' : '';
      const typeLabel = item.type === 'reminder' ? '提醒' : '任务';
      return `${prefix}${typeLabel}：${item.title}`;
    });
    parts.push(`今日计划（${state.scheduleItems.length}项）：\n${scheduleLines.join('\n')}`);
  } else {
    parts.push('今天没有待办事项。');
  }

  // 天气
  if (state.weather) {
    parts.push(`天气：${state.weather.city} ${state.weather.temperatureC}°C ${state.weather.description}`);
  } else {
    parts.push('天气暂时不可用');
  }

  return parts.join('\n\n');
}

/** 组合每日问候 */
function composeDailyGreeting(state: ProactiveStateType): string {
  const userPetName = state.persona?.userPetName ?? '';
  const hour = new Date().getHours();
  let greeting: string;
  if (hour < 6) {
    greeting = '夜深了，注意休息。';
  } else if (hour < 12) {
    greeting = userPetName ? `${userPetName}，早上好！` : '早上好！';
  } else if (hour < 18) {
    greeting = userPetName ? `${userPetName}，下午好！` : '下午好！';
  } else {
    greeting = userPetName ? `${userPetName}，晚上好！` : '晚上好！';
  }

  if (state.weather) {
    return `${greeting}\n\n${state.weather.city}现在${state.weather.temperatureC}°C，${state.weather.description}。`;
  }
  return greeting;
}
