/**
 * 节点：route_or_extract
 * 如果确定性检查已确定意图，直接通过。
 * 如果未确定（即 chat），不调用模型——chat 是默认意图，无需路由。
 *
 * 该节点还执行 memory_gate 判断：
 * - 如果意图是 chat，判断是否需要检索记忆。
 * - memory_gate 优先使用规则和当前上下文，不单独消耗模型调用。
 */
import type { ConversationStateType, ConversationStateUpdate } from '../state';
import type { ModelGateway } from '../../../../services/ModelGateway';
import { createLogger } from '../../../../infrastructure/logging/logger';

const log = createLogger('ConversationGraph:route_or_extract');

/** memory_gate 规则：判断是否需要检索记忆 */
export function shouldRetrieveMemory(userInput: string, _messages: ConversationStateType['messages']): boolean {
  const text = userInput.trim();

  // 包含代词引用：可能需要历史上下文
  if (/那个|上次|之前|记得|你说过|我说过|我们聊过/.test(text)) {
    return true;
  }

  // 包含具体名词：可能需要查找相关记忆
  if (/我的.*是什么|我还记得|名字|电话|地址|生日/.test(text)) {
    return true;
  }

  // 消息较长：可能需要更多上下文
  if (text.length > 50) {
    return true;
  }

  return false;
}

/**
 * 创建 route_or_extract 节点。
 * V1 实现：确定性检查已足够覆盖主要意图。
 * 如果意图为 chat，判断是否需要记忆检索。
 * 不在此节点调用模型——将路由和主回复合并为一次调用。
 */
export function createRouteOrExtractNode(_modelGateway: ModelGateway) {
  return async function routeOrExtract(
    state: ConversationStateType
  ): Promise<ConversationStateUpdate> {
    log.info('route_or_extract', {
      traceId: state.traceId,
      fields: { intent: state.intent }
    });

    // 意图已由确定性检查确定
    if (state.intent) {
      log.info('intent already determined', {
        fields: { intent: state.intent }
      });

      // 如果是 chat，预判断是否需要记忆检索
      if (state.intent === 'chat') {
        const needMemory = shouldRetrieveMemory(state.userInput, state.messages);
        return {
          // 标记是否需要记忆检索，由 chat 分支使用
          // 此处不直接执行，留给 chat 分支处理
        };
      }

      return {};
    }

    // V1: 不会走到这里，因为确定性检查默认返回 'chat'
    // 如果未来需要模型路由，在这里添加
    log.warn('no intent detected, defaulting to chat');
    return { intent: 'chat' };
  };
}
