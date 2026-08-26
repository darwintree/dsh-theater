/// <reference types="node" />

export type { JsonValue } from '@deepseek-ai/dsh-session'
export type {
  ResolvedStageDeclaration,
  StageDeclaration,
  StageDeclarations,
} from './catalog.js'
export {
  isStageConfiguredEvent,
  isStageEvent,
  isStageOpEvent,
  registerStageSessionEventTypes,
  STAGE_REQUIRED_EVENT_TYPES,
  stageEvents,
} from './events.js'
export type {
  StageConfigured,
  StageOp,
  StageSessionEvent,
} from './events.js'
export type {
  StateMachine,
  StateMachineFactory,
  TransitionResult,
} from './machine.js'
export { StageService, StageService as default } from './service.js'
export type { EnsureStageInput, InteractionResult } from './service.js'
