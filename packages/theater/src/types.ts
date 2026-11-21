import type { ModelSelection } from '@deepseek-ai/dsh-agent'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { InteractionResult, StageConfigured } from '@darwintree/dsh-stage'

export interface TheaterToolDeclaration {
  readonly factory: string
  readonly params?: unknown
}

export interface TheaterCharacterContribution {
  readonly id: string
  readonly title?: string
  readonly model?: ModelSelection
  readonly systemPrompt: string
  readonly tools: readonly TheaterToolDeclaration[]
}

/** One Performance-bound Stage capability handed to an ordinary Tool. */
export interface TheaterStageHandle {
  read(): JsonValue
  interact(op: unknown): Promise<InteractionResult>
}

/** One semantic entry produced within a Character Turn, in chronological order. */
export type CharacterTurnEntry =
  | {
      readonly kind: 'text'
      readonly text: string
    }
  | {
      readonly kind: 'tool-call'
      readonly callId: string
      readonly name: string
      readonly rawArguments: string
      readonly arguments?: Readonly<Record<string, unknown>>
    }
  | {
      readonly kind: 'tool-result'
      readonly callId: string
      readonly name: string
      readonly content: readonly ContentBlock[]
      readonly isError: boolean
    }

/** One Tool call within a Character Turn paired with its settled result when present. */
export interface CharacterTurnToolCall {
  readonly callId: string
  readonly name: string
  readonly rawArguments: string
  readonly arguments?: Readonly<Record<string, unknown>>
  readonly result?: {
    readonly content: readonly ContentBlock[]
    readonly isError: boolean
  }
}

/** Structured read-only view of the currently open Character Turn. */
export interface ActiveCharacterTurnRead {
  readonly characterId: string
  readonly entries: readonly CharacterTurnEntry[]
  readonly toolCalls: readonly CharacterTurnToolCall[]
}

/** Structured read-only view of one settled Character Turn reconstructed from its durable Segment. */
export interface CharacterTurnRead {
  readonly characterId: string
  readonly outcome: 'completed' | 'aborted' | 'error'
  readonly entries: readonly CharacterTurnEntry[]
  readonly toolCalls: readonly CharacterTurnToolCall[]
}

/** Performance-bound capabilities handed to a Character Tool. */
export interface TheaterToolContext {
  readonly characterId: string
  readonly characterIds: readonly string[]
  stage(stageId: string): TheaterStageHandle
  currentTurnKind(): 'top-level' | 'nested'
  readCurrentTurn(): ActiveCharacterTurnRead
  readSettledTurns(): readonly CharacterTurnRead[]
  runNestedTurn(
    characterId: string,
    instruction: readonly ContentBlock[],
  ): Promise<CharacterTurnRead>
  abortTurn(reason?: string): never
}

/** Host-registered constructor for one preset-declared Character Tool. */
export interface TheaterToolFactory {
  readonly kind: string
  resolveConfig(input: unknown): JsonValue
  create(config: JsonValue, context: TheaterToolContext): ToolDefinition
}

export interface TheaterConfiguredTool {
  readonly factory: string
  readonly config: JsonValue
}

export interface TheaterConfiguredCharacter {
  readonly id: string
  readonly model?: ModelSelection
  readonly systemPrompt: string
  readonly tools: readonly TheaterConfiguredTool[]
}

export interface TheaterCharacterConfigured {
  readonly characterId: string
}

/** One Character action selected by a Director and executed by the Theater Main Loop. */
export interface DirectorAction {
  readonly kind: 'act'
  readonly characterId: string
  readonly instruction: readonly ContentBlock[]
}

/** One liveness decision interpreted by the Theater Main Loop. */
export type DirectorDecision =
  | DirectorAction
  | { readonly kind: 'complete' }

/** Read-only capabilities and cancellation signal available for one liveness decision. */
export interface DirectorContext {
  readonly signal: AbortSignal
  readStage(stageId: string): JsonValue
  readSettledTurns(): readonly CharacterTurnRead[]
}

/** Decide whether to act or complete from current durable state. */
export type Director = (context: DirectorContext) => Promise<DirectorDecision>

export interface TheaterConfigured {
  readonly presetId: string
  readonly characters: readonly TheaterConfiguredCharacter[]
  readonly stages: readonly StageConfigured[]
}

export interface TheaterSegmentStarted {
  readonly characterId: string
}

export interface TheaterSegmentEnded {
  readonly characterId: string
  readonly characterSessionSeq: number
  readonly outcome: 'completed' | 'aborted' | 'error'
  readonly error?: { readonly message: string; readonly code: string }
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    theater: {
      readonly kind: 'theater'
      readonly form: 'instructions'
    }
  }
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    'theater/character-configured': TheaterCharacterConfigured
    'theater/configured': TheaterConfigured
    'theater/segment-started': TheaterSegmentStarted
    'theater/segment-ended': TheaterSegmentEnded
  }
}

export type PerformancePhase = 'active' | 'completed' | 'failed' | 'incompatible'
export type PerformanceActivity = 'idle' | 'awaiting-director' | 'executing-turn'

export interface PerformanceRead {
  readonly performanceId: SessionId
  readonly presetId: string
  readonly cwd: string
  readonly phase: PerformancePhase
  readonly activity: PerformanceActivity
  readonly error?: string
  readonly characters: Readonly<Record<string, SessionId>>
  readonly stages: Readonly<Record<string, {
    readonly configuration: StageConfigured
    readonly state?: JsonValue
    readonly completed?: boolean
  }>>
  readonly forkablePositions: readonly number[]
  readonly lineage: {
    readonly parentSession?: SessionId
    readonly seedLength?: number
  }
}

export interface DirectorOverrideOptions {
  /** Replace the preset's default Director for this Performance runtime. */
  readonly director?: Director
  /** Wrap the effective Director (e.g. step gating or turn limit). */
  readonly wrapDirector?: (director: Director) => Director
}

export interface CreatePerformanceInput extends DirectorOverrideOptions {
  readonly performanceId: SessionId
  readonly presetId: string
  readonly cwd: string
}

export interface ResumePerformanceInput extends DirectorOverrideOptions {
  readonly performanceId: SessionId
}

export interface ForkPerformanceInput extends DirectorOverrideOptions {
  readonly sourcePerformanceId: SessionId
  /** Exclusive Performance Session sequence. */
  readonly cursor: number
  readonly childPerformanceId: SessionId
}
