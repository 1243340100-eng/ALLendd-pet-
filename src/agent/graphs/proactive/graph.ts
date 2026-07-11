/**
 * ProactiveEventGraph 定义。
 * 对应架构计划第 5.3 节。
 *
 * 流程：
 * receive_event → load_proactive_policy → deduplicate
 * → check_fullscreen → check_dnd → check_ignore_state → check_daily_quota
 * → load_event_context → compose_message → choose_delivery_channel
 * → render_or_notify → record_delivery → END
 *
 * 主动策略：
 * - 全屏游戏时暂停所有桌宠主动弹出、声音和系统通知
 * - 全屏期间到期提醒保留为待投递，退出全屏后补发
 * - 勿扰期间普通问候直接跳过；提醒延迟至勿扰结束
 * - 非提醒型主动行为每日最多 5 次
 * - 用户主动创建的到期提醒属于履约行为，不得因为问候配额而丢失
 * - 对同类问候连续忽略 2 次后，当天停止该类问候
 */
import { StateGraph, START, END } from '@langchain/langgraph';
import { ProactiveState } from './state';
import type { ProactiveStateType } from './state';
import type { FullscreenAdapter } from '../../../adapters/fullscreen/FullscreenAdapter';
import type { NotificationAdapter } from '../../../adapters/notifications/NotificationAdapter';
import type { SoundAdapter } from '../../../adapters/sound/SoundAdapter';
import type { WeatherAdapter } from '../../../adapters/weather/WeatherAdapter';
import { TimeService } from '../../../services/TimeService';
import { receiveEvent } from './nodes/receive-event';
import { loadProactivePolicy } from './nodes/load-proactive-policy';
import { deduplicate } from './nodes/deduplicate';
import { createCheckFullscreenNode } from './nodes/check-fullscreen';
import { createCheckDndNode } from './nodes/check-dnd';
import { checkIgnoreState } from './nodes/check-ignore-state';
import { checkDailyQuota } from './nodes/check-daily-quota';
import { createLoadEventContextNode } from './nodes/load-event-context';
import { composeMessage } from './nodes/compose-message';
import { chooseDeliveryChannel } from './nodes/choose-delivery-channel';
import { createRenderOrNotifyNode } from './nodes/render-or-notify';
import { recordDelivery } from './nodes/record-delivery';
import { createLogger } from '../../../infrastructure/logging/logger';

const log = createLogger('ProactiveGraph');

/** ProactiveEventGraph 依赖 */
export interface ProactiveGraphDeps {
  fullscreenAdapter: FullscreenAdapter;
  notificationAdapter: NotificationAdapter;
  soundAdapter: SoundAdapter;
  weatherAdapter: WeatherAdapter | null;
  timeService: TimeService;
}

/** 创建 ProactiveEventGraph */
export function createProactiveGraph(deps: ProactiveGraphDeps) {
  const checkFullscreen = createCheckFullscreenNode(deps.fullscreenAdapter);
  const checkDnd = createCheckDndNode(deps.timeService);
  const loadEventContext = createLoadEventContextNode(deps.weatherAdapter, deps.timeService);
  const renderOrNotify = createRenderOrNotifyNode(deps.notificationAdapter, deps.soundAdapter);

  const graph = new StateGraph(ProactiveState)
    .addNode('receive_event', receiveEvent)
    .addNode('load_proactive_policy', loadProactivePolicy)
    .addNode('deduplicate', deduplicate)
    .addNode('check_fullscreen', checkFullscreen)
    .addNode('check_dnd', checkDnd)
    .addNode('check_ignore_state', checkIgnoreState)
    .addNode('check_daily_quota', checkDailyQuota)
    .addNode('load_event_context', loadEventContext)
    .addNode('compose_message', composeMessage)
    .addNode('choose_delivery_channel', chooseDeliveryChannel)
    .addNode('render_or_notify', renderOrNotify)
    .addNode('record_delivery', recordDelivery)
    // 线性流程：每个检查节点设置 delivery 状态，后续节点据此决定是否跳过
    .addEdge(START, 'receive_event')
    .addEdge('receive_event', 'load_proactive_policy')
    .addEdge('load_proactive_policy', 'deduplicate')
    .addEdge('deduplicate', 'check_fullscreen')
    .addEdge('check_fullscreen', 'check_dnd')
    .addEdge('check_dnd', 'check_ignore_state')
    .addEdge('check_ignore_state', 'check_daily_quota')
    .addEdge('check_daily_quota', 'load_event_context')
    .addEdge('load_event_context', 'compose_message')
    .addEdge('compose_message', 'choose_delivery_channel')
    .addEdge('choose_delivery_channel', 'render_or_notify')
    .addEdge('render_or_notify', 'record_delivery')
    .addEdge('record_delivery', END);

  return graph.compile();
}

/** ProactiveEventGraph 运行器 */
export class ProactiveGraphRunner {
  private compiledGraph: ReturnType<typeof createProactiveGraph>;

  constructor(deps: ProactiveGraphDeps) {
    this.compiledGraph = createProactiveGraph(deps);
  }

  /** 运行主动事件图 */
  async run(initialState: ProactiveStateType): Promise<ProactiveStateType> {
    log.info('running proactive graph', {
      traceId: initialState.traceId,
      fields: { proactiveType: initialState.proactiveType }
    });

    try {
      const result = await this.compiledGraph.invoke(initialState);
      const finalState = result as ProactiveStateType;

      log.info('proactive graph completed', {
        traceId: initialState.traceId,
        fields: {
          delivery: finalState.delivery,
          delivered: finalState.deliveryResult?.delivered ?? false,
          errors: finalState.errors.length
        }
      });

      return finalState;
    } catch (error) {
      log.error('proactive graph failed', {
        traceId: initialState.traceId,
        fields: { error: (error as Error)?.message }
      });

      // Graph 失败不会崩溃：返回安全后备状态
      return {
        ...initialState,
        delivery: 'suppressed',
        deliveryResult: {
          channel: 'suppressed',
          message: '',
          expression: initialState.expression,
          motion: initialState.motion,
          delivered: false
        },
        errors: [...initialState.errors, {
          code: 'unknown' as const,
          message: (error as Error)?.message ?? 'Unknown error',
          node: 'proactive_graph',
          recovered: false,
          occurredAt: new Date().toISOString()
        }]
      };
    }
  }
}
