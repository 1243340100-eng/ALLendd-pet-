/**
 * character-onboarding 服务模块统一导出。
 *
 * 核心数据形态：
 * - CharacterRequirementDraft（采集草稿）
 * - CharacterRequirementSummary（结构化摘要）
 * - CompiledCharacterProfile（编译后角色配置）
 *
 * 阶段顺序：basic → speaking → relationship → taboos → review
 */
export * from './schemas';
export * from './CoverageValidator';
export * from './AnswerExtractor';
export * from './QuestionGenerator';
export * from './SummaryGenerator';
export * from './ProfileCompiler';
