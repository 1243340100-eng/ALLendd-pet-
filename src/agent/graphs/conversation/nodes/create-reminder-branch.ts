/**
 * 节点：create_reminder 分支
 *
 * 流程：
 * ReminderParserService.parse（本地正则 + 模型提取）
 * → 判断字段是否完整
 *    ├─ 不完整：写 checkpoint，询问用户
 *    └─ 完整：PermissionGuard → save_reminder → 返回成功信息
 *
 * 不得在数据库提交成功前回复"已经创建"。
 * 明确说"提醒我……"即视为本次创建授权，不额外弹窗。
 *
 * 修正：
 * - 时间解析统一交由 ReminderParserService 处理（支持相对时间和模型提取）
 * - 缺少具体时间时不擅自默认，而是追问用户
 * - checkpoint 恢复时传 existingDraft 给 parser，parser 内部合并
 * - 重复规则使用 JSON 格式 { frequency: 'daily' } 保持与 SchedulerService 一致
 * - 时区通过 parser 的 timeService 获取
 */
import type { ConversationStateType, ConversationStateUpdate } from '../state';
import type { SkillRegistry } from '../../../../services/SkillRegistry';
import type { ReminderDraft } from '../../../../shared/contracts/graph-state';
import type { ReminderParserService } from '../../../../services/ReminderParserService';
import { createLogger } from '../../../../infrastructure/logging/logger';

const log = createLogger('ConversationGraph:create_reminder_branch');

export function createCreateReminderBranchNode(
  skillRegistry: SkillRegistry,
  reminderParserService: ReminderParserService
) {
  return async function createReminderBranch(
    state: ConversationStateType
  ): Promise<ConversationStateUpdate> {
    log.info('create_reminder branch start', {
      traceId: state.traceId
    });

    // 使用 ReminderParserService 解析（checkpoint 恢复时传 existingDraft）
    const parseResult = await reminderParserService.parse(
      state.userInput,
      state.reminderDraft ?? undefined
    );

    const draft: ReminderDraft = parseResult.draft;
    const missingFields = parseResult.missingFields;

    log.info('reminder draft extracted', {
      fields: {
        content: draft.content?.slice(0, 50),
        triggerAt: draft.triggerAt,
        missing: missingFields,
        source: parseResult.source,
        confidence: parseResult.confidence
      }
    });

    // 判断字段是否完整
    if (missingFields.length > 0) {
      const checkpointId = `ckpt-reminder-${Date.now()}`;
      const askMessage = `我需要更多信息来创建提醒。请补充以下信息：\n${missingFields.map((f) => `- ${f}`).join('\n')}`;

      log.info('reminder fields missing, asking user', {
        fields: { missingFields, checkpointId }
      });

      return {
        reminderDraft: draft,
        missingFields,
        shouldAskUser: true,
        askUserMessage: askMessage,
        checkpointReason: 'missing_reminder_fields',
        checkpointId,
        responseText: askMessage,
        expression: 'waiting'
      };
    }

    // 字段完整：调用 SkillRegistry 执行创建提醒
    try {
      const result = await skillRegistry.execute(
        'create_reminder',
        {
          content: draft.content!,
          triggerAt: draft.triggerAt!,
          timezone: 'Asia/Shanghai',
          isRepeating: draft.isRepeating ?? false,
          recurrenceRule: draft.recurrenceRule ?? '',
          priority: draft.priority ?? 'normal'
        },
        {
          userId: state.userId,
          characterId: state.characterId,
          sessionId: state.sessionId,
          traceId: state.traceId
        }
      );

      if (result.success && result.output) {
        const output = result.output as { message: string; reminderId: string };
        log.info('reminder created successfully', {
          fields: { reminderId: output.reminderId }
        });

        return {
          skillResult: result.output,
          responseText: output.message,
          expression: 'waving',
          motion: 'waving'
        };
      } else {
        log.warn('reminder creation failed', {
          fields: { error: result.error }
        });
        return {
          skillResult: null,
          responseText: `创建提醒时遇到了问题：${result.error ?? '未知错误'}。请稍后再试。`,
          expression: 'failed',
          motion: 'failed',
          errors: [...state.errors, {
            code: 'database_error' as const,
            message: result.error ?? 'Reminder creation failed',
            node: 'create_reminder_branch',
            recovered: false,
            occurredAt: new Date().toISOString()
          }]
        };
      }
    } catch (error) {
      log.error('create_reminder branch exception', {
        traceId: state.traceId,
        fields: { error: (error as Error)?.message }
      });
      return {
        responseText: '创建提醒时遇到了一些问题，请稍后再试。',
        expression: 'failed',
        motion: 'failed',
        errors: [...state.errors, {
          code: 'unknown' as const,
          message: (error as Error)?.message ?? 'Unknown error',
          node: 'create_reminder_branch',
          recovered: false,
          occurredAt: new Date().toISOString()
        }]
      };
    }
  };
}
