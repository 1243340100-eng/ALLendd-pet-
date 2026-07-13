/**
 * 角色初始化向导 - 数据 Schema 与字段白名单。
 *
 * 三种核心数据形态：
 * - CharacterRequirementDraft：采集过程中持续合并的草稿
 * - CharacterRequirementSummary：信息完整后由程序构建的结构化摘要
 * - CompiledCharacterProfile：ProfileCompiler 确定性编译出的最终角色配置
 *
 * 阶段顺序：basic → speaking → relationship → taboos → review
 *
 * 安全约束：
 * - 所有模型/IPC 输入使用严格 Zod Schema，拒绝未知字段
 * - 限制字符串与数组长度
 * - 模型只能更新白名单字段，不能修改阶段、版本、锁定状态、安全规则
 */
import { z } from 'zod';

// ===== 阶段 =====

export const ONBOARDING_STAGE = {
  BASIC: 'basic',
  SPEAKING: 'speaking',
  RELATIONSHIP: 'relationship',
  TABOOS: 'taboos',
  REVIEW: 'review'
} as const;

export type OnboardingStage = typeof ONBOARDING_STAGE[keyof typeof ONBOARDING_STAGE];

/** 阶段顺序（review 为终态） */
export const STAGE_ORDER: readonly OnboardingStage[] = [
  ONBOARDING_STAGE.BASIC,
  ONBOARDING_STAGE.SPEAKING,
  ONBOARDING_STAGE.RELATIONSHIP,
  ONBOARDING_STAGE.TABOOS,
  ONBOARDING_STAGE.REVIEW
] as const;

// ===== 字段白名单 =====

/**
 * 全部可采集字段名（白名单）。
 * 模型只能更新这些字段，其它字段（revision/isLocked/stage/securityRules 等）禁止模型修改。
 */
export const DRAFT_FIELD_NAMES = [
  // basic
  'characterName',
  'characterIdentity',
  'userPetName',
  'selfPetName',
  'referenceCharacter',
  'keepTraits',
  'excludeTraits',
  // speaking
  'tone',
  'replyLength',
  'proactiveFollowUp',
  'jokeLevel',
  'flirtLevel',
  'tsundereLevel',
  'catchphrase',
  'forbiddenExpressions',
  // relationship
  'relationshipType',
  'intimacyLevel',
  'forbiddenBoundaries',
  'lowMoodResponse',
  'dangerousRequestResponse',
  // taboos
  'cannotBecome',
  'cannotSay',
  'cannotDo',
  'avoidAssistantFeel'
] as const;

export type DraftFieldName = typeof DRAFT_FIELD_NAMES[number];

/** 字段 → 所属阶段 */
export const FIELD_TO_STAGE: Record<DraftFieldName, OnboardingStage> = {
  characterName: ONBOARDING_STAGE.BASIC,
  characterIdentity: ONBOARDING_STAGE.BASIC,
  userPetName: ONBOARDING_STAGE.BASIC,
  selfPetName: ONBOARDING_STAGE.BASIC,
  referenceCharacter: ONBOARDING_STAGE.BASIC,
  keepTraits: ONBOARDING_STAGE.BASIC,
  excludeTraits: ONBOARDING_STAGE.BASIC,

  tone: ONBOARDING_STAGE.SPEAKING,
  replyLength: ONBOARDING_STAGE.SPEAKING,
  proactiveFollowUp: ONBOARDING_STAGE.SPEAKING,
  jokeLevel: ONBOARDING_STAGE.SPEAKING,
  flirtLevel: ONBOARDING_STAGE.SPEAKING,
  tsundereLevel: ONBOARDING_STAGE.SPEAKING,
  catchphrase: ONBOARDING_STAGE.SPEAKING,
  forbiddenExpressions: ONBOARDING_STAGE.SPEAKING,

  relationshipType: ONBOARDING_STAGE.RELATIONSHIP,
  intimacyLevel: ONBOARDING_STAGE.RELATIONSHIP,
  forbiddenBoundaries: ONBOARDING_STAGE.RELATIONSHIP,
  lowMoodResponse: ONBOARDING_STAGE.RELATIONSHIP,
  dangerousRequestResponse: ONBOARDING_STAGE.RELATIONSHIP,

  cannotBecome: ONBOARDING_STAGE.TABOOS,
  cannotSay: ONBOARDING_STAGE.TABOOS,
  cannotDo: ONBOARDING_STAGE.TABOOS,
  avoidAssistantFeel: ONBOARDING_STAGE.TABOOS
};

// ===== 长度限制 =====

export const LENGTH_LIMITS = {
  stringFieldMax: 500,
  arrayFieldMax: 12,
  arrayItemMax: 200,
  catchphraseMax: 80,
  identityMax: 300,
  // 单轮用户回答
  userAnswerMax: 2000,
  // 单轮问题文本
  questionTextMax: 600,
  // 摘要展示文本
  summaryDisplayMax: 2000
} as const;

// ===== 草稿字段 Schemas =====

const trimmedNonEmpty = (max: number) =>
  z.string().trim().min(1).max(max);

const stringArray = (maxItems: number, itemMax: number) =>
  z.array(z.string().trim().min(1).max(itemMax)).max(maxItems);

/** 单个草稿字段的可选值类型 */
export const draftFieldValueSchema = z.union([
  trimmedNonEmpty(LENGTH_LIMITS.stringFieldMax),
  stringArray(LENGTH_LIMITS.arrayFieldMax, LENGTH_LIMITS.arrayItemMax),
  z.enum(['low', 'medium', 'high']),
  trimmedNonEmpty(LENGTH_LIMITS.catchphraseMax)
]);

/** 草稿字段值类型（TypeScript 视图） */
export type DraftFieldValue = z.infer<typeof draftFieldValueSchema>;

// ===== CharacterRequirementDraft =====

/**
 * 采集过程中持续合并的草稿。
 * - fields 只能包含白名单字段
 * - ambiguities 记录非明确冲突，等待用户澄清
 * - revision 用于乐观锁
 * - stage/isLocked/securityRulesLocked 禁止模型修改
 */
export const characterRequirementDraftSchema = z.object({
  fields: z.record(z.enum(DRAFT_FIELD_NAMES), draftFieldValueSchema.nullable()),
  ambiguities: z.array(z.object({
    field: z.enum(DRAFT_FIELD_NAMES),
    reason: z.string().trim().min(1).max(LENGTH_LIMITS.stringFieldMax),
    candidates: z.array(z.string().trim().min(1).max(LENGTH_LIMITS.arrayItemMax)).max(LENGTH_LIMITS.arrayFieldMax).default([])
  })).max(LENGTH_LIMITS.arrayFieldMax * 2),
  /** 已被用户明确 correction 覆盖的字段记录 */
  corrections: z.array(z.object({
    field: z.enum(DRAFT_FIELD_NAMES),
    oldValue: z.string().max(LENGTH_LIMITS.stringFieldMax),
    newValue: z.string().max(LENGTH_LIMITS.stringFieldMax),
    reason: z.string().max(LENGTH_LIMITS.stringFieldMax).default('')
  })).max(LENGTH_LIMITS.arrayFieldMax * 2),
  revision: z.number().int().min(0).default(0),
  stage: z.enum([ONBOARDING_STAGE.BASIC, ONBOARDING_STAGE.SPEAKING, ONBOARDING_STAGE.RELATIONSHIP, ONBOARDING_STAGE.TABOOS, ONBOARDING_STAGE.REVIEW]),
  isLocked: z.boolean().default(false),
  securityRulesLocked: z.boolean().default(true),
  updatedAt: z.string().max(64).default('')
});

export type CharacterRequirementDraft = z.infer<typeof characterRequirementDraftSchema>;

// ===== AnswerExtractor 输出 =====

/** 模型提取的单字段更新 */
export const fieldUpdateSchema = z.object({
  field: z.enum(DRAFT_FIELD_NAMES),
  value: draftFieldValueSchema,
  /** 值来源：用户原话子串或明确表达；不可凭空补全 */
  evidenceQuote: z.string().trim().min(1).max(LENGTH_LIMITS.userAnswerMax)
});

export const explicitCorrectionSchema = z.object({
  field: z.enum(DRAFT_FIELD_NAMES),
  oldValue: z.string().max(LENGTH_LIMITS.stringFieldMax),
  newValue: z.string().max(LENGTH_LIMITS.stringFieldMax),
  reason: z.string().max(LENGTH_LIMITS.stringFieldMax).default(''),
  /** V8 新增：correction 必须携带 evidence（用户原话子串），程序化校验 */
  evidence: z.string().trim().min(1).max(LENGTH_LIMITS.userAnswerMax)
});

export const ambiguitySchema = z.object({
  field: z.enum(DRAFT_FIELD_NAMES),
  reason: z.string().trim().min(1).max(LENGTH_LIMITS.stringFieldMax),
  candidates: z.array(z.string().trim().min(1).max(LENGTH_LIMITS.arrayItemMax)).max(LENGTH_LIMITS.arrayFieldMax).default([])
});

/** AnswerExtractor 严格输出 schema */
export const answerExtractionSchema = z.object({
  updates: z.array(fieldUpdateSchema).max(LENGTH_LIMITS.arrayFieldMax),
  explicitCorrections: z.array(explicitCorrectionSchema).max(LENGTH_LIMITS.arrayFieldMax),
  ambiguities: z.array(ambiguitySchema).max(LENGTH_LIMITS.arrayFieldMax)
}).strict();

export type AnswerExtraction = z.infer<typeof answerExtractionSchema>;

// ===== CharacterRequirementSummary =====

/**
 * 信息完整后由程序构建的结构化摘要。
 * 真正交给 ProfileCompiler 的必须是程序构建并校验过的结构化 Summary，
 * 不能直接使用模型生成的 displayText。
 */
export const characterRequirementSummarySchema = z.object({
  fields: z.record(z.enum(DRAFT_FIELD_NAMES), draftFieldValueSchema.nullable()),
  /** 面向 UI 的展示文本（SummaryGenerator 生成，不能新增事实） */
  displayText: z.string().trim().min(1).max(LENGTH_LIMITS.summaryDisplayMax),
  /** 来源草稿 revision，便于审计 */
  sourceRevision: z.number().int().min(0),
  /** 摘要生成时间 ISO */
  generatedAt: z.string().max(64),
  /** 基础角色包 ID（用于编译时引用视觉/动画资源） */
  baseCharacterId: z.string().trim().min(1).max(128)
}).strict();

export type CharacterRequirementSummary = z.infer<typeof characterRequirementSummarySchema>;

// ===== PersonalityProfile =====

/**
 * 性格画像（与角色身份严格分离）。
 * 只包含回复长度/追问/玩笑/撒娇/吐槽等可调参数，
 * 不能写入身份、称呼、世界观、关系边界或禁区。
 */
export const personalityProfileSchema = z.object({
  replyLength: z.enum(['short', 'medium', 'long']),
  proactiveFollowUp: z.enum(['low', 'medium', 'high']),
  jokeLevel: z.enum(['low', 'medium', 'high']).default('low'),
  flirtLevel: z.enum(['low', 'medium', 'high']).default('low'),
  tsundereLevel: z.enum(['low', 'medium', 'high']).default('low'),
  /** 语气提示词列表（harness 用），不包含身份信息 */
  toneHints: z.array(z.string().trim().min(1).max(LENGTH_LIMITS.arrayItemMax)).max(LENGTH_LIMITS.arrayFieldMax).default([]),
  /** harness 必须避免的话题或表达 */
  mustAvoid: z.array(z.string().trim().min(1).max(LENGTH_LIMITS.arrayItemMax)).max(LENGTH_LIMITS.arrayFieldMax).default([])
}).strict();

export type PersonalityProfile = z.infer<typeof personalityProfileSchema>;

// ===== CompiledCharacterProfile =====

/**
 * ProfileCompiler 的最终产物。
 * - persona：交给 ConversationGraph 的 PersonaConfig
 * - personalityProfile：交给 ConversationHarnessAdapter 的可调参数
 * - baseCharacterId / configVersion：审计与回滚
 */
export const compiledCharacterProfileSchema = z.object({
  persona: z.object({
    characterId: z.string().min(1).max(128),
    characterName: z.string().min(1).max(128),
    corePrompt: z.string().min(1).max(8000),
    speakingStyle: z.array(z.string().min(1).max(LENGTH_LIMITS.stringFieldMax)).max(LENGTH_LIMITS.arrayFieldMax * 2),
    relationshipBoundary: z.array(z.string().min(1).max(LENGTH_LIMITS.stringFieldMax)).max(LENGTH_LIMITS.arrayFieldMax * 2),
    forbiddenDrift: z.array(z.string().min(1).max(LENGTH_LIMITS.stringFieldMax)).max(LENGTH_LIMITS.arrayFieldMax * 2),
    commonTone: z.array(z.string().min(1).max(LENGTH_LIMITS.stringFieldMax)).max(LENGTH_LIMITS.arrayFieldMax * 2),
    sampleDialogues: z.array(z.object({
      user: z.string().min(1).max(LENGTH_LIMITS.stringFieldMax),
      expected: z.string().min(1).max(LENGTH_LIMITS.stringFieldMax)
    })).max(8).default([]),
    userPetName: z.string().max(64).optional(),
    defaultLanguage: z.string().max(16).optional(),
    memoryGuidance: z.array(z.string().min(1).max(LENGTH_LIMITS.stringFieldMax)).max(LENGTH_LIMITS.arrayFieldMax * 2).optional(),
    reminderGuidance: z.array(z.string().min(1).max(LENGTH_LIMITS.stringFieldMax)).max(LENGTH_LIMITS.arrayFieldMax * 2).optional()
  }),
  personalityProfile: personalityProfileSchema,
  baseCharacterId: z.string().min(1).max(128),
  configVersion: z.number().int().min(1),
  /** Summary 来源 revision，便于审计 */
  sourceRevision: z.number().int().min(0),
  compiledAt: z.string().max(64)
}).strict();

export type CompiledCharacterProfile = z.infer<typeof compiledCharacterProfileSchema>;

// ===== V9 问题卡片协议 =====

/** 问题类型：文本输入 / 单选 / 多选 / 混合（选项+其他） */
export type QuestionType = 'text' | 'single_choice' | 'multiple_choice' | 'hybrid';

/** 问题选项 */
export const questionOptionSchema = z.object({
  id: z.string().min(1).max(32),
  label: z.string().trim().min(1).max(200),
  /** 选项值，必须符合对应字段的 draftFieldValueSchema */
  value: draftFieldValueSchema
}).strict();

export type QuestionOption = z.infer<typeof questionOptionSchema>;

/**
 * 单张问题卡片。
 * - fieldPaths：关联字段（1-4 个），必须来自 DRAFT_FIELD_NAMES 白名单
 * - type：决定 UI 渲染形式
 * - options：single_choice / multiple_choice / hybrid 必填
 * - allowOther：是否提供"其他"自由输入
 * - suggestedAnswer：AI 建议答案（文本题可空时由 SuggestionGenerator 填充）
 * - required：是否必填
 */
export const onboardingQuestionSchema = z.object({
  id: z.string().min(1).max(128),
  fieldPaths: z.array(z.enum(DRAFT_FIELD_NAMES)).min(1).max(4),
  type: z.enum(['text', 'single_choice', 'multiple_choice', 'hybrid']),
  question: z.string().trim().min(5).max(LENGTH_LIMITS.questionTextMax),
  description: z.string().trim().max(300).optional(),
  options: z.array(questionOptionSchema).max(8).optional(),
  allowOther: z.boolean().default(false),
  otherPlaceholder: z.string().max(100).optional(),
  suggestedAnswer: z.string().max(LENGTH_LIMITS.stringFieldMax).optional(),
  /** 多选题最大选择数量 */
  maxSelect: z.number().int().min(1).max(8).optional(),
  required: z.boolean().default(true)
}).strict();

export type OnboardingQuestion = z.infer<typeof onboardingQuestionSchema>;

/**
 * 用户对单张问题卡片的回答。
 * - 纯选项回答：selectedOptionIds（程序从 checkpoint 的 question.options 重新映射 value，不调用模型）
 * - 自由文本：customText（调用 AnswerExtractor）
 * - 混合：两者皆有
 *
 * 安全约束：不包含 selectedValues，后端从可信的 question.options 重新提取值
 */
export const onboardingQuestionAnswerSchema = z.object({
  questionId: z.string().min(1).max(128),
  fieldPaths: z.array(z.enum(DRAFT_FIELD_NAMES)).min(1).max(4),
  answerType: z.enum(['text', 'single_choice', 'multiple_choice', 'hybrid']),
  selectedOptionIds: z.array(z.string().min(1).max(32)).max(8).optional(),
  customText: z.string().max(LENGTH_LIMITS.userAnswerMax).optional(),
  usedSuggestedAnswer: z.boolean().optional()
}).strict();

export type OnboardingQuestionAnswer = z.infer<typeof onboardingQuestionAnswerSchema>;

// ===== pendingAnswers：未提交的卡片选择临时保存 =====

/** 单条 pendingAnswer（不含 selectedValues，安全约束与正式回答一致） */
export const pendingAnswerEntrySchema = z.object({
  questionId: z.string().min(1).max(128),
  selectedOptionIds: z.array(z.string().min(1).max(32)).max(8).optional(),
  customText: z.string().max(LENGTH_LIMITS.userAnswerMax).optional(),
  usedSuggestedAnswer: z.boolean().optional()
}).strict();

export type PendingAnswerEntry = z.infer<typeof pendingAnswerEntrySchema>;

/**
 * pendingAnswers 数据包，保存在 checkpoint state_json 中。
 * - revision：保存时的 draft.revision，恢复时必须与当前 draft.revision 完全匹配
 * - questionSetFingerprint：问题集合指纹，恢复时必须与当前 currentQuestions 匹配
 * - answers：用户未提交的临时回答
 */
export const pendingAnswersDataSchema = z.object({
  revision: z.number().int().min(0),
  questionSetFingerprint: z.string().min(1).max(256),
  answers: z.array(pendingAnswerEntrySchema).max(8)
}).strict();

export type PendingAnswersData = z.infer<typeof pendingAnswersDataSchema>;

// ===== 字段问题元数据（用于确定性生成默认问题卡片） =====

/** 单选枚举字段的 A/B/C 选项 */
const LEVEL_OPTIONS = [
  { id: 'A', label: '低', value: 'low' as const },
  { id: 'B', label: '中', value: 'medium' as const },
  { id: 'C', label: '高', value: 'high' as const }
];

/** 字段 → 默认问题元数据 */
export const FIELD_QUESTION_META: Record<DraftFieldName, {
  type: QuestionType;
  question: string;
  description?: string;
  placeholder?: string;
  otherPlaceholder?: string;
  options?: QuestionOption[];
  allowOther?: boolean;
  required: boolean;
}> = {
  // ===== basic =====
  characterName: {
    type: 'text',
    question: '给角色起一个名字？（你平时用来叫这个角色的）',
    description: '这是角色的名字，例如"洛琪希"、"小明"',
    placeholder: '角色的名字',
    allowOther: false,
    required: true
  },
  characterIdentity: {
    type: 'text',
    question: '角色的身份和背景设定是什么？',
    description: '例如职业、来历、世界观',
    placeholder: '描述角色的身份设定',
    allowOther: false,
    required: true
  },
  userPetName: {
    type: 'text',
    question: '你希望角色怎么叫你？（角色对你的称呼）',
    description: '这是角色用来称呼你的名字，例如"主人"、"哥哥"、"小伙伴"',
    placeholder: '角色对你的称呼，如"主人"',
    allowOther: false,
    required: true
  },
  selfPetName: {
    type: 'text',
    question: '角色应该怎么自称？（角色提到自己时的称呼）',
    description: '这是角色提到自己时用的称呼，例如"我"、"人家"、"本小姐"，也可以用自己的名字',
    placeholder: '角色的自称，如"我"、"人家"',
    allowOther: false,
    required: true
  },
  referenceCharacter: {
    type: 'text',
    question: '有没有想参考的已有角色？',
    description: '没有可直接填"无"',
    placeholder: '参考角色名，或填"无"',
    allowOther: false,
    required: true
  },
  keepTraits: {
    type: 'hybrid',
    question: '想保留参考角色的哪些特质？',
    description: '可填写多个，用逗号分隔',
    placeholder: '想保留的特质',
    allowOther: true,
    required: false
  },
  excludeTraits: {
    type: 'hybrid',
    question: '想排除参考角色的哪些特质？',
    placeholder: '想排除的特质',
    allowOther: true,
    required: false
  },
  // ===== speaking =====
  tone: {
    type: 'text',
    question: '你希望角色的语气风格是什么样的？',
    description: '例如温柔、冷静、活泼',
    placeholder: '语气风格描述',
    allowOther: false,
    required: true
  },
  replyLength: {
    type: 'single_choice',
    question: '你希望角色平时的回复多长？',
    options: [
      { id: 'A', label: '偏短，日常尽量简洁', value: 'low' },
      { id: 'B', label: '适中，保持自然交流', value: 'medium' },
      { id: 'C', label: '偏详细，解释得比较完整', value: 'high' }
    ],
    allowOther: true,
    otherPlaceholder: '也可以自己描述',
    required: true
  },
  proactiveFollowUp: {
    type: 'single_choice',
    question: '角色是否会主动追问？',
    options: [
      { id: 'A', label: '不主动，被动回应', value: 'low' },
      { id: 'B', label: '偶尔追问', value: 'medium' },
      { id: 'C', label: '经常主动追问', value: 'high' }
    ],
    allowOther: true,
    otherPlaceholder: '也可以自己描述',
    required: true
  },
  jokeLevel: {
    type: 'single_choice',
    question: '角色可以开玩笑的程度？',
    options: LEVEL_OPTIONS,
    allowOther: true,
    otherPlaceholder: '也可以自己描述',
    required: true
  },
  flirtLevel: {
    type: 'single_choice',
    question: '角色可以撒娇的程度？',
    options: LEVEL_OPTIONS,
    allowOther: true,
    otherPlaceholder: '也可以自己描述',
    required: true
  },
  tsundereLevel: {
    type: 'single_choice',
    question: '角色可以吐槽的程度？',
    options: LEVEL_OPTIONS,
    allowOther: true,
    otherPlaceholder: '也可以自己描述',
    required: true
  },
  catchphrase: {
    type: 'text',
    question: '有没有想要的口癖？',
    description: '没有可填"无"',
    placeholder: '口癖，或填"无"',
    allowOther: false,
    required: false
  },
  forbiddenExpressions: {
    type: 'hybrid',
    question: '有哪些表达是角色绝对不能说的？',
    placeholder: '禁止的表达，可填多个',
    allowOther: true,
    required: false
  },
  // ===== relationship =====
  relationshipType: {
    type: 'hybrid',
    question: '你希望和角色是什么关系？',
    options: [
      { id: 'A', label: '朋友', value: '朋友' },
      { id: 'B', label: '老师与学生', value: '老师与学生' },
      { id: 'C', label: '陪伴者', value: '陪伴者' },
      { id: 'D', label: '半监管半陪伴', value: '半监管半陪伴' }
    ],
    allowOther: true,
    otherPlaceholder: '其他关系描述',
    required: true
  },
  intimacyLevel: {
    type: 'text',
    question: '亲密程度希望是什么样的？',
    description: '例如礼貌距离、轻度暧昧、家人感',
    placeholder: '亲密程度描述',
    allowOther: false,
    required: true
  },
  forbiddenBoundaries: {
    type: 'hybrid',
    question: '有哪些边界是角色绝对不能越过的？',
    placeholder: '禁止的边界，可填多个',
    allowOther: true,
    required: false
  },
  lowMoodResponse: {
    type: 'text',
    question: '当你低落时，希望角色怎么回应？',
    placeholder: '低落时的回应方式',
    allowOther: false,
    required: true
  },
  dangerousRequestResponse: {
    type: 'text',
    question: '面对危险或过量请求时，希望角色怎么回应？',
    placeholder: '危险请求的回应方式',
    allowOther: false,
    required: true
  },
  // ===== taboos =====
  cannotBecome: {
    type: 'hybrid',
    question: '角色不能变成什么样？',
    placeholder: '不能变成的样子，可填多个',
    allowOther: true,
    required: false
  },
  cannotSay: {
    type: 'hybrid',
    question: '角色不能说什么？',
    placeholder: '不能说的内容，可填多个',
    allowOther: true,
    required: false
  },
  cannotDo: {
    type: 'hybrid',
    question: '角色不能做什么？',
    placeholder: '不能做的事，可填多个',
    allowOther: true,
    required: false
  },
  avoidAssistantFeel: {
    type: 'text',
    question: '需要避免的"普通 AI 助手感"有哪些？',
    placeholder: '需要避免的助手感描述',
    allowOther: false,
    required: false
  }
};

// ===== 工具函数 =====

/** 判断字段是否属于指定阶段 */
export function fieldBelongsToStage(field: DraftFieldName, stage: OnboardingStage): boolean {
  return FIELD_TO_STAGE[field] === stage;
}

/** 获取指定阶段的全部字段 */
export function getFieldsForStage(stage: OnboardingStage): DraftFieldName[] {
  return DRAFT_FIELD_NAMES.filter((f) => FIELD_TO_STAGE[f] === stage);
}

/** 创建初始草稿 */
export function createInitialDraft(): CharacterRequirementDraft {
  const fields: Record<string, null> = {};
  for (const f of DRAFT_FIELD_NAMES) {
    fields[f] = null;
  }
  return {
    fields: fields as CharacterRequirementDraft['fields'],
    ambiguities: [],
    corrections: [],
    revision: 0,
    stage: ONBOARDING_STAGE.BASIC,
    isLocked: false,
    securityRulesLocked: true,
    updatedAt: new Date().toISOString()
  };
}
