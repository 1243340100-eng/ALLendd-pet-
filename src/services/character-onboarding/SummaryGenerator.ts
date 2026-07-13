/**
 * SummaryGenerator - 生成面向 UI 的 displayText。
 *
 * 严格约束：
 * - 只生成面向 UI 的 displayText，不能新增事实
 * - 真正交给 ProfileCompiler 的必须是程序构建并校验过的结构化 Summary
 * - 不调用模型（确定性映射）
 * - 输出文本必须从草稿 fields 中提取，禁止补充或推断
 */
import {
  DRAFT_FIELD_NAMES,
  FIELD_TO_STAGE,
  ONBOARDING_STAGE,
  STAGE_ORDER,
  LENGTH_LIMITS,
  characterRequirementSummarySchema,
  type CharacterRequirementDraft,
  type CharacterRequirementSummary,
  type DraftFieldName
} from './schemas';
import { isReadyForReview } from './CoverageValidator';
import { createLogger } from '../../infrastructure/logging/logger';

const log = createLogger('SummaryGenerator');

/** SummaryGenerator 输入 */
export interface SummaryGeneratorInput {
  draft: CharacterRequirementDraft;
  /** 基础角色包 ID */
  baseCharacterId: string;
}

/** SummaryGenerator 输出 */
export interface SummaryGeneratorOutput {
  ok: boolean;
  summary: CharacterRequirementSummary | null;
  reason?: string;
}

/** 字段中文标签 */
const FIELD_LABELS: Record<DraftFieldName, string> = {
  characterName: '角色名字',
  characterIdentity: '身份设定',
  userPetName: '对你的称呼',
  selfPetName: '角色自称',
  referenceCharacter: '参考角色',
  keepTraits: '保留特质',
  excludeTraits: '排除特质',
  tone: '语气风格',
  replyLength: '回复长度',
  proactiveFollowUp: '主动追问',
  jokeLevel: '玩笑程度',
  flirtLevel: '撒娇程度',
  tsundereLevel: '吐槽程度',
  catchphrase: '口癖',
  forbiddenExpressions: '禁止表达',
  relationshipType: '关系类型',
  intimacyLevel: '亲密程度',
  forbiddenBoundaries: '禁止边界',
  lowMoodResponse: '低落时回应',
  dangerousRequestResponse: '危险请求回应',
  cannotBecome: '不能变成',
  cannotSay: '不能说',
  cannotDo: '不能做',
  avoidAssistantFeel: '避免助手感'
};

/** 将字段值格式化为展示字符串 */
function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '（未填写）';
  if (Array.isArray(value)) {
    if (value.length === 0) return '（无）';
    return value.join('、');
  }
  if (typeof value === 'string') return value;
  return String(value);
}

/** 回复长度枚举 → 中文 */
function replyLengthLabel(v: unknown): string {
  if (v === 'low') return '简短';
  if (v === 'medium') return '适中';
  if (v === 'high') return '详细';
  return formatValue(v);
}

/** 程度枚举 → 中文 */
function levelLabel(v: unknown): string {
  if (v === 'low') return '低';
  if (v === 'medium') return '中';
  if (v === 'high') return '高';
  return formatValue(v);
}

/** 字段值格式化分发 */
function formatFieldValue(field: DraftFieldName, value: unknown): string {
  if (value === null || value === undefined) return '（未填写）';
  if (field === 'replyLength') return replyLengthLabel(value);
  if (field === 'proactiveFollowUp' || field === 'jokeLevel' || field === 'flirtLevel' || field === 'tsundereLevel') {
    return levelLabel(value);
  }
  return formatValue(value);
}

/** 阶段中文标题 */
const STAGE_TITLES: Record<typeof ONBOARDING_STAGE[keyof typeof ONBOARDING_STAGE], string> = {
  [ONBOARDING_STAGE.BASIC]: '一、基础信息',
  [ONBOARDING_STAGE.SPEAKING]: '二、说话风格',
  [ONBOARDING_STAGE.RELATIONSHIP]: '三、关系边界',
  [ONBOARDING_STAGE.TABOOS]: '四、角色禁区',
  [ONBOARDING_STAGE.REVIEW]: '五、确认'
};

/**
 * 生成面向 UI 的 displayText。
 * 不调用模型，确定性从草稿 fields 提取。
 */
export function generateSummaryText(draft: CharacterRequirementDraft): string {
  const lines: string[] = [];

  for (const stage of STAGE_ORDER) {
    if (stage === ONBOARDING_STAGE.REVIEW) continue;
    const stageFields = DRAFT_FIELD_NAMES.filter((f) => FIELD_TO_STAGE[f] === stage);
    if (stageFields.length === 0) continue;

    lines.push(STAGE_TITLES[stage]);
    for (const f of stageFields) {
      const label = FIELD_LABELS[f] ?? f;
      const value = formatFieldValue(f, draft.fields[f]);
      lines.push(`  ${label}：${value}`);
    }
    lines.push('');
  }

  if (draft.ambiguities.length > 0) {
    lines.push('待澄清：');
    for (const a of draft.ambiguities) {
      const label = FIELD_LABELS[a.field] ?? a.field;
      lines.push(`  ${label}：${a.reason}`);
    }
    lines.push('');
  }

  return lines.join('\n').slice(0, LENGTH_LIMITS.summaryDisplayMax);
}

/**
 * 构建结构化 Summary（真正交给 ProfileCompiler 的输入）。
 * 必须在草稿已达到 review 阶段后调用。
 */
export function buildSummary(input: SummaryGeneratorInput): SummaryGeneratorOutput {
  const { draft, baseCharacterId } = input;

  if (!isReadyForReview(draft)) {
    return { ok: false, summary: null, reason: 'draft-not-ready-for-review' };
  }

  const displayText = generateSummaryText(draft);

  const summary: CharacterRequirementSummary = {
    fields: { ...draft.fields },
    displayText,
    sourceRevision: draft.revision,
    generatedAt: new Date().toISOString(),
    baseCharacterId
  };

  const summaryValidation = characterRequirementSummarySchema.safeParse(summary);
  if (!summaryValidation.success) {
    log.warn('built summary failed schema validation', {
      fields: {
        reason: summaryValidation.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
      }
    });
    return { ok: false, summary: null, reason: 'summary-schema-validation-failed' };
  }

  return { ok: true, summary };
}
