import type { JsonValue } from '@deepseek-ai/dsh-session'

/** One accepted or domain-rejected transition. Program faults throw. */
export type TransitionResult =
  | { kind: 'accepted'; outcome?: JsonValue }
  | { kind: 'domain-rejected'; reason: string }

/**
 * A pure live game state object: it owns live state and deterministic domain
 * rules only. It never touches Context, Session, events, or flush; the Stage
 * Service owns persistence. The same canonical Op drives live transitions and
 * replay, so a State Machine exposes a single {@link transition} entry.
 */
export interface StateMachine {
  /** Durable kind, recorded separately from the Stage ID. */
  readonly kind: string
  /** Durable version, paired with kind for compatible restoration. */
  readonly version: string
  /**
   * Apply one canonical Op to live state. Accepted transitions atomically
   * advance state and may return an optional observational outcome; replay
   * is governed by the Op itself, never the outcome. Domain rejections return
   * a reason without changing state. Program faults throw.
   */
  transition(op: JsonValue): TransitionResult
  /** A detached JSON snapshot of the current live state. */
  read(): JsonValue
  /** Whether the Stage has reached a terminal state. */
  readonly completed: boolean
}

/**
 * A construction capability for one State Machine kind. Resolved config is the
 * authoritative input after creation; plugin config is only the first input.
 * The concrete factory interface is an implementation decision, not part of
 * the public Stage contract.
 */
export interface StateMachineFactory {
  readonly kind: string
  readonly version: string
  /** Validate and detach the first-use config input into durable JSON. */
  resolveConfig(input: unknown): JsonValue
  /** Construct one fresh live State Machine from resolved config. */
  create(config: JsonValue): StateMachine
}
