/**
 * Preload API 契约。
 * 定义 Renderer 可访问的 API 形状，与 preload.js 的 window.petAPI 对齐。
 * 对应架构计划第 1 节"所有高权限操作通过 preload 暴露的白名单 IPC 调用"。
 *
 * 此文件只定义类型契约，实际实现仍在 app/preload.js。
 * 后续 preload.js 可逐步迁移到此契约。
 */
import type { ChatReplyDto, ErrorDto } from '../shared/dto/renderer';

/** Renderer 侧可用的安全 API */
export interface PetApiContract {
  // 事件回调
  onHydrateNow: (callback: () => void) => void;
  onNightNow: (callback: () => void) => void;
  onSetState: (callback: (state: string) => void) => void;
  onSetScale: (callback: (scale: number) => void) => void;
  onDragDirection: (callback: (direction: string) => void) => void;
  onSetReminderMinutes: (callback: (minutes: number) => void) => void;
  onVisibilityMode: (callback: (visible: boolean) => void) => void;
  onShowApiSettings: (callback: () => void) => void;

  // API 配置
  getApiConfig: () => Promise<ApiConfigView>;
  saveApiConfig: (config: ApiConfigInput) => Promise<{ ok: boolean; error?: string }>;

  // 聊天
  sendChat: (payload: ChatSendInput) => Promise<ChatReplyDto | ErrorDto>;

  // Safe Shell
  safeShell: {
    interpret: (text: string) => Promise<SafeShellInterpretResult>;
    confirm: (id: string) => Promise<SafeShellConfirmResult>;
    cancel: (id: string) => Promise<void>;
    getSettings: () => Promise<SafeShellSettings>;
    setEnabled: (enabled: boolean) => Promise<void>;
  };

  // 数据
  getPetData: () => Promise<unknown>;
  updatePetData: (data: unknown) => Promise<unknown>;

  // 记忆
  listMemories: (type: string) => Promise<unknown[]>;
  addMemory: (type: string, content: string, options?: Record<string, unknown>) => Promise<unknown>;
  updateMemory: (type: string, id: string, patch: Record<string, unknown>) => Promise<unknown>;
  deleteMemory: (type: string, id: string) => Promise<void>;
  clearExpiredShortTermMemories: () => Promise<void>;
  clearMemories: (type: string) => Promise<void>;
  clearAllMemories: () => Promise<void>;
  detectExplicitMemoryIntent: (text: string) => Promise<unknown>;
  analyzeAndApplyMemory: (text: string) => Promise<unknown>;

  // 好感度
  getAffection: () => Promise<unknown>;
  setAffectionScore: (score: number, reason?: string) => Promise<unknown>;
  adjustAffection: (delta: number, eventType: string, reason?: string, options?: Record<string, unknown>) => Promise<unknown>;
  detectAffectionEvent: (text: string) => Promise<unknown>;

  // 窗口
  focusWindow: () => Promise<void>;
  setWindowScale: (scale: number) => Promise<void>;
  startDragAnimation: () => void;
  stopDragAnimation: () => void;
}

/** Renderer 可见的 API 配置（不含密钥） */
export interface ApiConfigView {
  provider: string;
  endpoint: string;
  model: string;
  hasApiKey: boolean;
  encryptionAvailable: boolean;
}

/** 保存 API 配置输入 */
export interface ApiConfigInput {
  provider: string;
  endpoint: string;
  model: string;
  apiKey?: string;
}

/** 聊天输入 */
export interface ChatSendInput {
  message: string;
  history?: Array<{
    role: 'user' | 'assistant';
    content: string;
    excludeFromAi?: boolean;
  }>;
}

export interface SafeShellInterpretResult {
  interpretationId: string;
  needsConfirm: boolean;
  preview: string;
  description: string;
  warning?: string;
}

export interface SafeShellConfirmResult {
  ok: boolean;
  stdout?: string;
  stderr?: string;
  error?: string;
}

export interface SafeShellSettings {
  enabled: boolean;
}

declare global {
  interface Window {
    petAPI: PetApiContract;
  }
}
