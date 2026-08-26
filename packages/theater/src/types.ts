import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { JsonValue, SessionId } from '@deepseek-ai/dsh-session'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { InteractionResult, StageConfigured } from '@darwintree/dsh-stage'

export interface TheaterToolDeclaration {
  readonly factory: string
  readonly params?: unknown
}

export interface TheaterCharacterContribution {
  readonly id: string
  readonly tools: readonly TheaterToolDeclaration[]
}

/** One Performance-bound Stage capability handed to an ordinary Tool. */
export interface TheaterStageHandle {
  read(): JsonValue
  interact(op: unknown): Promise<InteractionResult>
}

/** Host-registered constructor for one preset-declared Character Tool. */
export interface TheaterToolFactory {
  readonly kind: string
  resolveConfig(input: unknown): JsonValue
  create(
    config: JsonValue,
    stage: (stageId: string) => TheaterStageHandle,
  ): ToolDefinition
}

export interface TheaterConfiguredTool {
  readonly factory: string
  readonly config: JsonValue
}

export interface TheaterConfiguredCharacter {
  readonly id: string
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

/** Read-only capabilities available for one liveness decision. */
export interface DirectorContext {
  readStage(stageId: string): JsonValue
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

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    'theater/character-configured': TheaterCharacterConfigured
    'theater/configured': TheaterConfigured
    'theater/segment-started': TheaterSegmentStarted
    'theater/segment-ended': TheaterSegmentEnded
  }
}

export type PerformanceRuntimeStatus = 'running' | 'completed' | 'failed' | 'incompatible'

export interface PerformanceRead {
  readonly performanceId: SessionId
  readonly presetId: string
  readonly status: PerformanceRuntimeStatus
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

export interface CreatePerformanceInput {
  readonly performanceId: SessionId
  readonly presetId: string
}

export interface ResumePerformanceInput {
  readonly performanceId: SessionId
}

export interface ForkPerformanceInput {
  readonly sourcePerformanceId: SessionId
  /** Exclusive Performance Session sequence. */
  readonly cursor: number
  readonly childPerformanceId: SessionId
}
