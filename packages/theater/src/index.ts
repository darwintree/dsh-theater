export { characterSessionId } from './configuration.js'
export {
  createHumanDirector,
  createStepDirector,
  createTurnLimitDirector,
} from './directors.js'
export type {
  HumanDirectorController,
  HumanDirectorRequest,
  StepDirectorController,
  StepDirectorOptions,
  TurnLimitDirectorController,
} from './directors.js'
export { THEATER_REQUIRED_EVENT_TYPES, registerTheaterSessionEventTypes } from './events.js'
export { TheaterService, TheaterService as default } from './service.js'
export type {
  ActiveCharacterTurnRead,
  CharacterTurnEntry,
  CharacterTurnRead,
  CharacterTurnToolCall,
  CreatePerformanceInput,
  Director,
  DirectorAction,
  DirectorContext,
  DirectorDecision,
  DirectorOverrideOptions,
  ForkPerformanceInput,
  PerformanceActivity,
  PerformancePhase,
  PerformanceRead,
  ResumePerformanceInput,
  TheaterCharacterContribution,
  TheaterCharacterConfigured,
  TheaterConfigured,
  TheaterConfiguredCharacter,
  TheaterConfiguredTool,
  TheaterSegmentEnded,
  TheaterSegmentStarted,
  TheaterStageHandle,
  TheaterToolDeclaration,
  TheaterToolContext,
  TheaterToolFactory,
} from './types.js'
