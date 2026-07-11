/**
 * 用户上下文服务。
 * 从 users 表和 app_settings 表合并读取用户信息，供运行时 Persona 构建使用。
 */
import { settingsRepository } from '../infrastructure/database/repositories/settings-repository';
import { getDatabase } from '../infrastructure/database/connection';
import { createLogger } from '../infrastructure/logging/logger';
import type { PersonaConfig } from '../shared/contracts/graph-state';

const log = createLogger('UserContextService');

export interface UserContext {
  userId: string;
  /** 用户设置的昵称 */
  nickname: string;
  /** 用户偏好的称呼 */
  preferredName: string;
  /** 显示名称：优先 preferredName，其次 nickname，最后角色包 userPetName */
  displayName: string;
  /** 时区 */
  timezone: string;
  /** 语言 */
  locale: string;
}

export class UserContextService {
  /**
   * 加载用户上下文。
   * 从 users 表和 app_settings 表合并读取。
   */
  load(userId: string, fallbackPersona?: PersonaConfig | null): UserContext {
    // 1. 从 users 表读取 nickname 和 preferred_name
    // 2. 从 app_settings 读取 timezone（默认 Asia/Shanghai）和 locale（默认 zh-CN）
    // 3. 计算 displayName:
    //    - 优先 preferred_name（非空）
    //    - 其次 nickname（非空）
    //    - 再次 fallbackPersona?.userPetName（非空）
    //    - 最后 '用户'

    let nickname = '';
    let preferredName = '';

    try {
      const db = getDatabase();
      const row = db.prepare('SELECT nickname, preferred_name FROM users WHERE id = ?').get(userId) as any;
      if (row) {
        nickname = row.nickname ?? '';
        preferredName = row.preferred_name ?? '';
      }
    } catch (error) {
      log.warn('failed to load user from users table', {
        fields: { userId, error: (error as Error)?.message }
      });
    }

    const timezone = settingsRepository.get('user_timezone') ?? 'Asia/Shanghai';
    const locale = settingsRepository.get('user_locale') ?? 'zh-CN';

    const displayName = preferredName || nickname || fallbackPersona?.userPetName || '用户';

    return {
      userId,
      nickname,
      preferredName,
      displayName,
      timezone,
      locale
    };
  }
}
