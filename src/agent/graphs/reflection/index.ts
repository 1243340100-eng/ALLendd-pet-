/**
 * ReflectionGraph barrel exports。
 */
export {
  ReflectionState,
  createInitialReflectionState
} from './state';
export type {
  ReflectionStateType,
  ReflectionStateUpdate,
  MemoryCandidate,
  ReflectionResult,
  ReflectionGraphError
} from './state';

export {
  createReflectionGraph,
  ReflectionGraphRunner
} from './graph';
export type { ReflectionGraphDeps } from './graph';

export {
  detectSensitiveInfo,
  isCasualGreeting,
  isTemporaryEmotion,
  involvesOtherCharacter,
  validateContent
} from './nodes/sensitive-info-filter';
