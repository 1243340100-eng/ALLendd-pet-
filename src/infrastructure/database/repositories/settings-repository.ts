/**
 * 应用设置 repository。验证"重启后设置仍存在"。
 */
import { getDatabase } from '../connection';
import type { ModelAliasMap } from '../../config/config-loader';

export const settingsRepository = {
  get(key: string): string | null {
    const row = getDatabase().prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as any;
    return row?.value ?? null;
  },

  set(key: string, value: string): void {
    getDatabase().prepare(`
      INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
    `).run(key, value);
  },

  getAll(): Record<string, string> {
    const rows = getDatabase().prepare('SELECT key, value FROM app_settings').all() as any[];
    const result: Record<string, string> = {};
    for (const row of rows) {
      result[row.key] = row.value;
    }
    return result;
  },

  delete(key: string): void {
    getDatabase().prepare('DELETE FROM app_settings WHERE key = ?').run(key);
  },

  /** 读取用户配置的模型别名映射 */
  getModelAliases(): Partial<ModelAliasMap> {
    const result: Partial<ModelAliasMap> = {};
    const fast = this.get('model_alias_fast');
    const balanced = this.get('model_alias_balanced');
    const reasoning = this.get('model_alias_reasoning');
    const planning = this.get('model_alias_planning');
    if (fast) result.fastModel = fast;
    if (balanced) result.balancedModel = balanced;
    if (reasoning) result.reasoningModel = reasoning;
    if (planning) result.planningModel = planning;
    return result;
  },

  /** 保存模型别名映射 */
  setModelAliases(aliases: Partial<ModelAliasMap>): void {
    if (aliases.fastModel) this.set('model_alias_fast', aliases.fastModel);
    if (aliases.balancedModel) this.set('model_alias_balanced', aliases.balancedModel);
    if (aliases.reasoningModel) this.set('model_alias_reasoning', aliases.reasoningModel);
    if (aliases.planningModel) this.set('model_alias_planning', aliases.planningModel);
  },

  /** 读取 planningModel 别名解析到的实际模型 ID（供状态面板显示） */
  getPlanningModelResolved(): string | null {
    return this.get('planning_model_resolved');
  },

  /** 保存 planningModel 别名解析到的实际模型 ID */
  setPlanningModelResolved(modelId: string): void {
    this.set('planning_model_resolved', modelId);
  }
};
