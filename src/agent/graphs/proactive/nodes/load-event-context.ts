/**
 * 节点：load_event_context
 * 加载事件所需上下文。
 *
 * 开机日报包含：角色问候、今日提醒、今日任务、未完成任务、天气。
 * 天气失败不影响其余日报。
 */
import type { ProactiveStateType, ProactiveStateUpdate } from '../state';
import type { ScheduleItem } from '../../../../shared/contracts/graph-state';
import type { WeatherAdapter } from '../../../../adapters/weather/WeatherAdapter';
import { TimeService } from '../../../../services/TimeService';
import { reminderRepository } from '../../../../infrastructure/database/repositories/reminder-repository';
import { taskRepository } from '../../../../infrastructure/database/repositories/task-repository';
import { settingsRepository } from '../../../../infrastructure/database/repositories/settings-repository';
import { createLogger } from '../../../../infrastructure/logging/logger';

const log = createLogger('ProactiveGraph:load_event_context');

export function createLoadEventContextNode(
  weatherAdapter: WeatherAdapter | null,
  timeService: TimeService
) {
  return async function loadEventContext(
    state: ProactiveStateType
  ): Promise<ProactiveStateUpdate> {
    log.info('loading event context', {
      traceId: state.traceId,
      fields: { proactiveType: state.proactiveType, delivery: state.delivery }
    });

    // 已被抑制：不需要加载上下文
    if (state.delivery === 'suppressed') {
      return {};
    }

    // 提醒事件只需要提醒内容
    if (state.proactiveType === 'reminder') {
      const payload = state.event.payload as {
        content?: string;
        reminderId?: string;
      };
      const content = payload.content ?? '提醒';
      return {
        composedMessage: content,
        scheduleItems: [],
        weather: null
      };
    }

    // 延迟投递的日报也需要加载上下文，以便退出全屏后补发
    // 开机日报和每日问候需要日程和天气
    const scheduleItems = loadScheduleItems(state, timeService);
    const weather = await loadWeather(weatherAdapter, state);

    return {
      scheduleItems,
      weather
    };
  };
}

/** 加载今日日程项 */
function loadScheduleItems(
  state: ProactiveStateType,
  timeService: TimeService
): ScheduleItem[] {
  const items: ScheduleItem[] = [];
  const now = timeService.nowUtc();
  const nowDate = new Date();
  const dayStart = timeService.getDayStartUtc(nowDate);
  const dayEnd = timeService.getDayEndUtc(nowDate);

  // 今日提醒
  try {
    const reminders = reminderRepository.getActiveReminders();
    for (const rem of reminders) {
      if (rem.user_id !== state.userId || rem.character_id !== state.characterId) continue;

      const isOverdue = rem.next_trigger_at < now;
      const isToday = rem.next_trigger_at >= dayStart && rem.next_trigger_at <= dayEnd;

      if (isToday || isOverdue) {
        items.push({
          id: rem.id,
          type: 'reminder',
          title: rem.content,
          scheduledAt: rem.next_trigger_at,
          completed: false,
          overdue: isOverdue
        });
      }
    }
  } catch (error) {
    log.warn('failed to load reminders', {
      fields: { error: (error as Error)?.message }
    });
  }

  // 今日任务
  try {
    const todayTasks = taskRepository.getTodayTasks(state.userId, state.characterId, dayStart, dayEnd);
    for (const task of todayTasks) {
      items.push({
        id: task.id,
        type: 'task',
        title: task.title,
        scheduledAt: task.due_at ?? '',
        completed: false,
        overdue: false
      });
    }

    // 已过期未完成任务
    const overdueTasks = taskRepository.getOverdueTasks(state.userId, state.characterId, now);
    for (const task of overdueTasks) {
      if (items.some((i) => i.id === task.id)) continue; // 避免重复
      items.push({
        id: task.id,
        type: 'task',
        title: task.title,
        scheduledAt: task.due_at ?? '',
        completed: false,
        overdue: true
      });
    }
  } catch (error) {
    log.warn('failed to load tasks', {
      fields: { error: (error as Error)?.message }
    });
  }

  // 按时间排序
  items.sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));

  log.info('schedule items loaded', {
    fields: { count: items.length, overdue: items.filter((i) => i.overdue).length }
  });

  return items;
}

/** 加载天气。失败不影响日报。 */
async function loadWeather(
  weatherAdapter: WeatherAdapter | null,
  state: ProactiveStateType
): Promise<ProactiveStateType['weather']> {
  if (!weatherAdapter || !weatherAdapter.isEnabled()) {
    return null;
  }

  // 未授权时跳过
  if (!weatherAdapter.isAuthorized()) {
    log.info('weather adapter not authorized, skipping');
    return null;
  }

  try {
    // 从设置读取天气城市（由 Onboarding 配置），回退到上海
    const city = settingsRepository.get('weather_city') || '上海';
    const snapshot = await weatherAdapter.getWeather(city);
    if (!snapshot) {
      log.info('weather unavailable');
      return null;
    }
    log.info('weather loaded', {
      fields: { city: snapshot.city, temp: snapshot.temperatureC, fromCache: snapshot.fromCache }
    });
    return snapshot;
  } catch (error) {
    log.warn('weather load failed, continuing without weather', {
      fields: { error: (error as Error)?.message }
    });
    return null;
  }
}
