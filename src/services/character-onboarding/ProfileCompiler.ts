/**
 * ProfileCompiler - 确定性编译角色配置。
 *
 * 严格约束：
 * - 必须是纯程序逻辑，不调用模型
 * - 输入：CharacterRequirementSummary + 基础角色包 persona/manifest + 配置版本
 * - 输出：CompiledCharacterProfile
 *
 * 映射原则：
 * - 身份、称呼、核心设定 → corePrompt
 * - 语气和表达 → speakingStyle / commonTone
 * - 关系 → relationshipBoundary
 * - 禁区和排除特质 → forbiddenDrift
 * - 回复长度、追问、玩笑、撒娇、吐槽 → personality profile
 *
 * 安全约束：
 * - 身份和世界观不能写入 personality profile
 * - 不得继承默认 Roxy 身份、称呼或关系，除非用户明确填写
 * - 第一阶段不生成示例对话
 * - 视觉资源继续复用默认基础角色包
 */
import type { PersonaConfig } from '../../shared/contracts/graph-state';
import type { CharacterManifest } from '../CharacterPackManager';
import {
  type CharacterRequirementSummary,
  type CompiledCharacterProfile,
  type DraftFieldName,
  type PersonalityProfile
} from './schemas';

/** ProfileCompiler 输入 */
export interface ProfileCompilerInput {
  summary: CharacterRequirementSummary;
  /** 基础角色包 manifest（用于 baseCharacterId 和 pack_version） */
  baseManifest: CharacterManifest;
  /** 基础角色包原始 persona（仅用于引用默认语言等非身份字段，不复用身份） */
  basePersona: PersonaConfig;
  /** 配置版本 */
  configVersion: number;
}

/** ProfileCompiler 输出 */
export interface ProfileCompilerOutput {
  ok: boolean;
  profile: CompiledCharacterProfile | null;
  reason?: string;
}

/** 默认 personality profile（用户未填时使用） */
function getDefaultPersonalityProfile(): PersonalityProfile {
  return {
    replyLength: 'medium',
    proactiveFollowUp: 'medium',
    jokeLevel: 'low',
    flirtLevel: 'low',
    tsundereLevel: 'low',
    toneHints: [],
    mustAvoid: []
  };
}

/** 安全地取字符串字段值 */
function getStringField(summary: CharacterRequirementSummary, field: DraftFieldName): string | null {
  const v = summary.fields[field];
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v.trim() || null;
  return null;
}

/** 安全地取数组字段值 */
function getStringArrayField(summary: CharacterRequirementSummary, field: DraftFieldName): string[] | null {
  const v = summary.fields[field];
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) return v.map((s) => String(s).trim()).filter((s) => s.length > 0);
  return null;
}

/** 安全地取枚举字段值 */
function getEnumField(summary: CharacterRequirementSummary, field: DraftFieldName, allowed: readonly string[]): string | null {
  const v = summary.fields[field];
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' && (allowed as readonly string[]).includes(v)) return v;
  return null;
}

/** 编译 corePrompt（身份、称呼、核心设定） */
function buildCorePrompt(summary: CharacterRequirementSummary): string {
  const parts: string[] = [];

  const characterName = getStringField(summary, 'characterName');
  const characterIdentity = getStringField(summary, 'characterIdentity');
  const selfPetName = getStringField(summary, 'selfPetName');
  const userPetName = getStringField(summary, 'userPetName');
  const referenceCharacter = getStringField(summary, 'referenceCharacter');
  const keepTraits = getStringArrayField(summary, 'keepTraits');
  const excludeTraits = getStringArrayField(summary, 'excludeTraits');

  if (characterName) {
    parts.push(`你是 ${characterName}。`);
  }
  if (characterIdentity) {
    parts.push(characterIdentity);
  }
  if (selfPetName) {
    parts.push(`你自称"${selfPetName}"。`);
  }
  if (userPetName) {
    parts.push(`你称呼用户为"${userPetName}"。`);
  }

  // 参考角色约束（用户明确填写时才加入）
  if (referenceCharacter) {
    parts.push(`参考角色：${referenceCharacter}。`);
    if (keepTraits && keepTraits.length > 0) {
      parts.push(`可保留的参考特质：${keepTraits.join('、')}。`);
    }
    if (excludeTraits && excludeTraits.length > 0) {
      parts.push(`必须排除的参考特质：${excludeTraits.join('、')}。`);
    }
    parts.push('你不是任何原作角色本体，不能复制原作种族、经历、世界观、恋爱线或台词。');
  }

  // 语气身份描述（来自 speaking 阶段，但只取身份相关描述，不放 personality profile）
  const tone = getStringField(summary, 'tone');
  if (tone) {
    parts.push(`你的语气风格：${tone}。`);
  }

  return parts.join('\n');
}

/** 编译 speakingStyle */
function buildSpeakingStyle(summary: CharacterRequirementSummary): string[] {
  const styles: string[] = [];

  const replyLength = getEnumField(summary, 'replyLength', ['low', 'medium', 'high']);
  if (replyLength === 'low') {
    styles.push('回复尽量简短，通常不超过两句话。');
  } else if (replyLength === 'high') {
    styles.push('可以适当详细回复，但仍保持结构清晰。');
  } else if (replyLength === 'medium') {
    styles.push('回复长度适中，不冗长也不敷衍。');
  }

  const proactiveFollowUp = getEnumField(summary, 'proactiveFollowUp', ['low', 'medium', 'high']);
  if (proactiveFollowUp === 'high') {
    styles.push('可以主动追问用户的状态或需求。');
  } else if (proactiveFollowUp === 'low') {
    styles.push('不主动追问，等用户明确提出再回应。');
  }

  const jokeLevel = getEnumField(summary, 'jokeLevel', ['low', 'medium', 'high']);
  if (jokeLevel === 'high') {
    styles.push('可以适度开玩笑了。');
  } else if (jokeLevel === 'low') {
    styles.push('不开玩笑，保持认真。');
  }

  const flirtLevel = getEnumField(summary, 'flirtLevel', ['low', 'medium', 'high']);
  if (flirtLevel === 'high') {
    styles.push('可以适度撒娇。');
  } else if (flirtLevel === 'low') {
    styles.push('不撒娇。');
  }

  const tsundereLevel = getEnumField(summary, 'tsundereLevel', ['low', 'medium', 'high']);
  if (tsundereLevel === 'high') {
    styles.push('可以适度吐槽。');
  } else if (tsundereLevel === 'low') {
    styles.push('不吐槽。');
  }

  const catchphrase = getStringField(summary, 'catchphrase');
  if (catchphrase && catchphrase !== '无') {
    styles.push(`口癖：${catchphrase}`);
  }

  const forbiddenExpressions = getStringArrayField(summary, 'forbiddenExpressions');
  if (forbiddenExpressions && forbiddenExpressions.length > 0) {
    styles.push(`禁止使用以下表达：${forbiddenExpressions.join('、')}。`);
  }

  return styles;
}

/** 编译 commonTone（从 tone 派生简单标签） */
function buildCommonTone(summary: CharacterRequirementSummary): string[] {
  const tone = getStringField(summary, 'tone');
  if (!tone) return [];
  // 拆分逗号或顿号，每段作为一项
  return tone.split(/[,，、]/).map((s) => s.trim()).filter((s) => s.length > 0).slice(0, 8);
}

/** 编译 relationshipBoundary */
function buildRelationshipBoundary(summary: CharacterRequirementSummary): string[] {
  const boundaries: string[] = [];

  const relationshipType = getStringField(summary, 'relationshipType');
  if (relationshipType) {
    boundaries.push(`关系类型：${relationshipType}。`);
  }

  const intimacyLevel = getStringField(summary, 'intimacyLevel');
  if (intimacyLevel) {
    boundaries.push(`亲密程度：${intimacyLevel}。`);
  }

  const forbiddenBoundaries = getStringArrayField(summary, 'forbiddenBoundaries');
  if (forbiddenBoundaries && forbiddenBoundaries.length > 0) {
    for (const b of forbiddenBoundaries) {
      boundaries.push(`不可越过：${b}。`);
    }
  }

  const lowMoodResponse = getStringField(summary, 'lowMoodResponse');
  if (lowMoodResponse) {
    boundaries.push(`用户低落时回应方式：${lowMoodResponse}。`);
  }

  const dangerousRequestResponse = getStringField(summary, 'dangerousRequestResponse');
  if (dangerousRequestResponse) {
    boundaries.push(`危险或过量请求时回应方式：${dangerousRequestResponse}。`);
  }

  return boundaries;
}

/** 编译 forbiddenDrift（禁区 + 排除特质 + 避免助手感） */
function buildForbiddenDrift(summary: CharacterRequirementSummary): string[] {
  const drifts: string[] = [];

  const excludeTraits = getStringArrayField(summary, 'excludeTraits');
  if (excludeTraits && excludeTraits.length > 0) {
    for (const t of excludeTraits) {
      drifts.push(`不展现特质：${t}。`);
    }
  }

  const cannotBecome = getStringArrayField(summary, 'cannotBecome');
  if (cannotBecome && cannotBecome.length > 0) {
    for (const c of cannotBecome) {
      drifts.push(`不能变成：${c}。`);
    }
  }

  const cannotSay = getStringArrayField(summary, 'cannotSay');
  if (cannotSay && cannotSay.length > 0) {
    for (const c of cannotSay) {
      drifts.push(`不能说：${c}。`);
    }
  }

  const cannotDo = getStringArrayField(summary, 'cannotDo');
  if (cannotDo && cannotDo.length > 0) {
    for (const c of cannotDo) {
      drifts.push(`不能做：${c}。`);
    }
  }

  const avoidAssistantFeel = getStringField(summary, 'avoidAssistantFeel');
  if (avoidAssistantFeel) {
    drifts.push(`避免普通 AI 助手感：${avoidAssistantFeel}。`);
  }

  // 安全底线（固定，不可被用户覆盖）
  drifts.push('不说作为一个语言模型、不自称 AI 或频繁加免责声明。');
  drifts.push('不让 harness 语气提示覆盖角色核心 Prompt。');

  return drifts;
}

/** 编译 personality profile（与角色身份严格分离） */
function buildPersonalityProfile(summary: CharacterRequirementSummary): PersonalityProfile {
  const profile = getDefaultPersonalityProfile();

  const replyLength = getEnumField(summary, 'replyLength', ['low', 'medium', 'high']);
  if (replyLength === 'low') profile.replyLength = 'short';
  else if (replyLength === 'high') profile.replyLength = 'long';
  else profile.replyLength = 'medium';

  const proactiveFollowUp = getEnumField(summary, 'proactiveFollowUp', ['low', 'medium', 'high']);
  if (proactiveFollowUp) profile.proactiveFollowUp = proactiveFollowUp as 'low' | 'medium' | 'high';

  const jokeLevel = getEnumField(summary, 'jokeLevel', ['low', 'medium', 'high']);
  if (jokeLevel) profile.jokeLevel = jokeLevel as 'low' | 'medium' | 'high';

  const flirtLevel = getEnumField(summary, 'flirtLevel', ['low', 'medium', 'high']);
  if (flirtLevel) profile.flirtLevel = flirtLevel as 'low' | 'medium' | 'high';

  const tsundereLevel = getEnumField(summary, 'tsundereLevel', ['low', 'medium', 'high']);
  if (tsundereLevel) profile.tsundereLevel = tsundereLevel as 'low' | 'medium' | 'high';

  // toneHints 来自 tone 字段（不包含身份信息，仅风格提示词）
  const tone = getStringField(summary, 'tone');
  if (tone) {
    profile.toneHints = tone.split(/[,，、]/).map((s) => s.trim()).filter((s) => s.length > 0).slice(0, 8);
  }

  // mustAvoid 来自 forbiddenExpressions
  const forbiddenExpressions = getStringArrayField(summary, 'forbiddenExpressions');
  if (forbiddenExpressions) {
    profile.mustAvoid = forbiddenExpressions.slice(0, 12);
  }

  return profile;
}

/**
 * 确定性编译角色 Profile。
 * 纯程序逻辑，不调用模型。
 */
export function compileProfile(input: ProfileCompilerInput): ProfileCompilerOutput {
  const { summary, baseManifest, basePersona, configVersion } = input;

  // 必填字段校验：角色名字和身份必须有
  const characterName = getStringField(summary, 'characterName');
  if (!characterName) {
    return { ok: false, profile: null, reason: 'missing-character-name' };
  }

  // 生成新的 characterId（不继承 baseManifest.id，避免与基础包混淆）
  // 但保留 baseCharacterId 用于视觉资源引用
  const compiledCharacterId = `user-${baseManifest.id}-${summary.sourceRevision}`;

  const corePrompt = buildCorePrompt(summary);
  if (!corePrompt.trim()) {
    return { ok: false, profile: null, reason: 'empty-core-prompt' };
  }

  const speakingStyle = buildSpeakingStyle(summary);
  const commonTone = buildCommonTone(summary);
  const relationshipBoundary = buildRelationshipBoundary(summary);
  const forbiddenDrift = buildForbiddenDrift(summary);
  const personalityProfile = buildPersonalityProfile(summary);

  // 复用基础角色包的 defaultLanguage（不继承身份/称呼/关系）
  const defaultLanguage = basePersona.defaultLanguage ?? 'zh';

  // 用户称呼
  const userPetName = getStringField(summary, 'userPetName') ?? undefined;

  // 第一阶段不生成示例对话
  const sampleDialogues: Array<{ user: string; expected: string }> = [];

  const persona: PersonaConfig = {
    characterId: compiledCharacterId,
    characterName,
    corePrompt,
    speakingStyle,
    relationshipBoundary,
    forbiddenDrift,
    commonTone,
    sampleDialogues,
    userPetName,
    defaultLanguage
  };

  const profile: CompiledCharacterProfile = {
    persona,
    personalityProfile,
    baseCharacterId: baseManifest.id,
    configVersion,
    sourceRevision: summary.sourceRevision,
    compiledAt: new Date().toISOString()
  };

  return { ok: true, profile };
}

/** 当前配置版本号 */
export const CURRENT_CONFIG_VERSION = 1;

/** 从已有 persona 确定性生成兼容配置（旧用户兼容用，不调用模型） */
export function compileFromExistingPersona(
  basePersona: PersonaConfig,
  baseManifest: CharacterManifest
): CompiledCharacterProfile {
  return {
    persona: { ...basePersona },
    personalityProfile: getDefaultPersonalityProfile(),
    baseCharacterId: baseManifest.id,
    configVersion: CURRENT_CONFIG_VERSION,
    sourceRevision: 0,
    compiledAt: new Date().toISOString()
  };
}
