export { characterSessionId } from './configuration.js'
export { THEATER_REQUIRED_EVENT_TYPES, registerTheaterSessionEventTypes } from './events.js'
export { TheaterService, TheaterService as default } from './service.js'
export type {
  CreatePerformanceInput,
  Director,
  DirectorAction,
  DirectorContext,
  DirectorDecision,
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
  TheaterToolFactory,
} from './types.js'
