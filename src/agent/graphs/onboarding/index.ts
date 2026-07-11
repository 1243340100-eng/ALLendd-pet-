/**
 * OnboardingGraph barrel 导出。
 */
export { OnboardingState, createInitialOnboardingState, getDefaultPreferences, getDefaultProactivePolicy } from './state';
export type { OnboardingStep, UserPreferences, ProactivePolicyConfig, OnboardingStateType, OnboardingStateUpdate } from './state';
export { createOnboardingGraph, OnboardingGraphRunner } from './graph';
export { loadInstallationState } from './nodes/load-installation-state';
export { createValidateCharacterPackNode } from './nodes/validate-character-pack';
export { collectUserPreferences, applyUserPreferences } from './nodes/collect-user-preferences';
export { buildPersonaConfig, mergePersonaWithUserCustomizations, detectLockedFieldOverride } from './nodes/build-persona-config';
export type { UserPersonaCustomizations } from './nodes/build-persona-config';
export { configureProactivePolicy } from './nodes/configure-proactive-policy';
export { configureModelMode } from './nodes/configure-model-mode';
export { saveOnboardingResult } from './nodes/save-onboarding-result';
export { activateCharacter } from './nodes/activate-character';
export { finish } from './nodes/finish';
