/**
 * 运行时 Persona 构建器。
 * 将角色包 persona 中的 {{user_display_name}} 模板变量替换为用户实际的 displayName。
 * 不修改原始 persona 对象，返回深拷贝。
 */
import { createLogger } from '../infrastructure/logging/logger';
import type { PersonaConfig } from '../shared/contracts/graph-state';
import type { UserContext } from './UserContextService';

const log = createLogger('RuntimePersonaBuilder');

/** 模板变量占位符 */
const USER_DISPLAY_NAME_PLACEHOLDER = '{{user_display_name}}';

export class RuntimePersonaBuilder {
  /**
   * 构建运行时 Persona。
   * 将角色包 persona 中的 {{user_display_name}} 模板变量替换为用户实际的 displayName。
   * 不修改原始 persona 对象，返回深拷贝。
   *
   * 角色身份字段（characterId, characterName）不可被用户设置覆盖。
   */
  build(basePersona: PersonaConfig, userContext: UserContext): PersonaConfig {
    const displayName = userContext.displayName;

    // 深拷贝，避免修改原始对象
    const runtime: PersonaConfig = JSON.parse(JSON.stringify(basePersona));

    // 替换所有文本字段中的模板变量
    runtime.corePrompt = this.replacePlaceholder(runtime.corePrompt, displayName);
    runtime.speakingStyle = runtime.speakingStyle?.map(s => this.replacePlaceholder(s, displayName));
    runtime.relationshipBoundary = runtime.relationshipBoundary?.map(s => this.replacePlaceholder(s, displayName));
    runtime.forbiddenDrift = runtime.forbiddenDrift?.map(s => this.replacePlaceholder(s, displayName));
    runtime.commonTone = runtime.commonTone?.map(s => this.replacePlaceholder(s, displayName));
    runtime.memoryGuidance = runtime.memoryGuidance?.map(s => this.replacePlaceholder(s, displayName));
    runtime.reminderGuidance = runtime.reminderGuidance?.map(s => this.replacePlaceholder(s, displayName));

    // sampleDialogues 中的 user 和 expected 都可能包含占位符
    if (runtime.sampleDialogues) {
      runtime.sampleDialogues = runtime.sampleDialogues.map(d => ({
        user: this.replacePlaceholder(d.user, displayName),
        expected: this.replacePlaceholder(d.expected, displayName)
      }));
    }

    // userPetName 替换为 displayName
    runtime.userPetName = displayName;

    log.debug('runtime persona built', {
      fields: { displayName, characterName: runtime.characterName }
    });

    return runtime;
  }

  private replacePlaceholder(text: string, replacement: string): string {
    if (!text) return text;
    return text.split(USER_DISPLAY_NAME_PLACEHOLDER).join(replacement);
  }
}
