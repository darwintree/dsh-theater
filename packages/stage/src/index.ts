/// <reference types="node" />

import { Service, type Context } from '@deepseek-ai/cordis'
import {
  KNOWN_SESSION_EVENT_TYPES,
  snapshotJsonValue,
  type JsonValue,
  type Session,
  type SessionEvent,
} from '@deepseek-ai/dsh-session'

export type { JsonValue } from '@deepseek-ai/dsh-session'

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

/** Durable Stage configuration record, persisted in `stage/configured`. */
export interface StageConfigured {
  readonly stageId: string
  readonly machine: string
  readonly version: string
  readonly config: JsonValue
}

/** Durable Stage Op record, persisted in `stage/op` for accepted ops only. */
export interface StageOp {
  readonly stageId: string
  readonly op: JsonValue
  readonly outcome?: JsonValue
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    'stage/configured': StageConfigured
    'stage/op': StageOp
  }
}

export type StageSessionEvent =
  | SessionEvent<'stage/configured'>
  | SessionEvent<'stage/op'>

export const STAGE_REQUIRED_EVENT_TYPES = ['stage/configured', 'stage/op'] as const

export function isStageConfiguredEvent(
  event: SessionEvent,
): event is SessionEvent<'stage/configured'> {
  return event.type === 'stage/configured'
}

export function isStageOpEvent(event: SessionEvent): event is SessionEvent<'stage/op'> {
  return event.type === 'stage/op'
}

export function isStageEvent(event: SessionEvent): event is StageSessionEvent {
  return isStageConfiguredEvent(event) || isStageOpEvent(event)
}

/** All persisted Stage events for one Stage ID, in Session order. */
export function stageEvents(
  events: readonly SessionEvent[],
  stageId: string,
): StageSessionEvent[] {
  return events.filter((event): event is StageSessionEvent =>
    isStageEvent(event) && event.data.stageId === stageId)
}

interface RequiredEventRegistration {
  initiallyKnown: boolean
  owners: number
}

interface RequiredEventRegistry {
  catalogs: WeakMap<Set<string>, Map<string, RequiredEventRegistration>>
}

const requiredRegistryKey = Symbol.for('@darwintree/dsh-stage/required-session-event-types')
const requiredRegistryGlobal = globalThis as typeof globalThis & {
  [key: symbol]: RequiredEventRegistry | undefined
}
const requiredEventCatalog = KNOWN_SESSION_EVENT_TYPES as Set<string>

function requiredEventRegistry(): RequiredEventRegistry {
  return requiredRegistryGlobal[requiredRegistryKey] ??= { catalogs: new WeakMap() }
}

/**
 * Register the required Stage Session Event names for one Service lifecycle.
 * Uses the lifecycle-counted registrar so a cache-busted module instance shares
 * ownership with its siblings; deepseek-harness is not modified.
 */
export function registerStageSessionEventTypes(): () => void {
  const registry = requiredEventRegistry()
  let registrations = registry.catalogs.get(requiredEventCatalog)
  if (registrations === undefined) {
    registrations = new Map()
    registry.catalogs.set(requiredEventCatalog, registrations)
  }
  const owned = STAGE_REQUIRED_EVENT_TYPES.map((type) => {
    let registration = registrations.get(type)
    if (registration === undefined) {
      registration = { initiallyKnown: requiredEventCatalog.has(type), owners: 0 }
      registrations.set(type, registration)
    }
    registration.owners += 1
    requiredEventCatalog.add(type)
    return [type, registration] as const
  })
  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    for (const [type, registration] of owned) {
      registration.owners -= 1
      if (registration.owners !== 0) continue
      if (!registration.initiallyKnown) requiredEventCatalog.delete(type)
      registrations.delete(type)
    }
  }
}

/** Inputs to lazily create or restore one Stage. */
export interface EnsureStageInput {
  /** The calling Agent Session — the authority for Stage persistence. */
  readonly session: Session
  /** Construction capability for the State Machine kind. */
  readonly factory: StateMachineFactory
  /** First-use config input; ignored when the Stage is already configured. */
  readonly config?: unknown
}

/** The public transition outcome returned by `interact`. */
export type InteractionResult =
  | { kind: 'accepted'; outcome?: JsonValue }
  | { kind: 'domain-rejected'; reason: string }

interface LiveStage {
  readonly machine: StateMachine
  readonly session: Session
}

function nonEmpty(value: string, label: string): string {
  if (value.trim() === '') throw new Error(`${label} must be non-empty`)
  return value
}

function configuredEvent(
  events: readonly SessionEvent[],
  stageId: string,
): SessionEvent<'stage/configured'> | undefined {
  const configured = stageEvents(events, stageId).filter(isStageConfiguredEvent)
  if (configured.length > 1) {
    throw new Error(`Stage ${JSON.stringify(stageId)} has multiple configurations`)
  }
  return configured[0]
}

function replayMachine(
  events: readonly SessionEvent[],
  factory: StateMachineFactory,
  stageId: string,
  config: JsonValue,
): StateMachine {
  const machine = factory.create(config)
  if (machine.kind !== factory.kind || machine.version !== factory.version) {
    throw new Error(
      `State Machine kind/version mismatch for Stage ${JSON.stringify(stageId)}`,
    )
  }
  for (const event of stageEvents(events, stageId)) {
    if (isStageOpEvent(event)) {
      const result = machine.transition(event.data.op)
      if (result.kind !== 'accepted') {
        throw new Error(`replay encountered non-accepted Stage Op for ${JSON.stringify(stageId)}`)
      }
    }
  }
  return machine
}

/**
 * `ctx.stages`: one concrete Cordis Service routing canonical Ops to live
 * State Machines by Stage ID. The Service owns Session configuration, accepted
 * Op persistence, flush, replay, read, and completion; State Machines hold
 * only live state and deterministic domain rules. Stage IDs are independent of
 * State Machine kind and Agent identity.
 */
export class StageService extends Service {
  static inject = ['sessions']

  private readonly live = new Map<string, LiveStage>()

  constructor(ctx: Context) {
    super(ctx, 'stages')
    ctx.effect(registerStageSessionEventTypes, 'stages.sessionEventTypes()')
  }

  /**
   * Lazily ensure one live Stage exists for `stageId`. When the Stage is
   * already live, returns it; when it is configured in the Session but not
   * live, reconstructs the State Machine and replays accepted Ops in Session
   * order; otherwise resolves the first-use config, persists
   * `stage/configured`, and flushes. Persisted resolved config is
   * authoritative after creation; later plugin config changes do not rewrite
   * an existing game.
   */
  async ensure(stageId: string, input: EnsureStageInput): Promise<void> {
    nonEmpty(stageId, 'Stage ID')
    nonEmpty(input.factory.kind, 'State Machine kind')
    nonEmpty(input.factory.version, 'State Machine version')
    const existing = this.live.get(stageId)
    if (existing !== undefined) {
      if (existing.session !== input.session) {
        throw new Error(`Stage ${JSON.stringify(stageId)} is bound to another Session`)
      }
      return
    }
    const configured = configuredEvent(input.session.events, stageId)
    if (configured !== undefined) {
      if (configured.data.machine !== input.factory.kind) {
        throw new Error(
          `State Machine kind mismatch for Stage ${JSON.stringify(stageId)}`,
        )
      }
      if (configured.data.version !== input.factory.version) {
        throw new Error(
          `Stage version mismatch for ${JSON.stringify(stageId)}`,
        )
      }
      const machine = replayMachine(
        input.session.events,
        input.factory,
        stageId,
        configured.data.config,
      )
      this.live.set(stageId, { machine, session: input.session })
      return
    }
    const config = snapshotJsonValue(input.factory.resolveConfig(input.config ?? {}))
    if (config === undefined) {
      throw new Error(
        `State Machine ${JSON.stringify(input.factory.kind)} returned non-JSON configuration`,
      )
    }
    const machine = input.factory.create(config)
    if (machine.kind !== input.factory.kind || machine.version !== input.factory.version) {
      throw new Error(
        `State Machine kind/version mismatch for Stage ${JSON.stringify(stageId)}`,
      )
    }
    input.session.append('stage/configured', {
      stageId,
      machine: input.factory.kind,
      version: input.factory.version,
      config,
    })
    await this.ctx.sessions.flush(input.session)
    this.live.set(stageId, { machine, session: input.session })
  }

  /**
   * Apply one canonical Op to the live State Machine for `stageId`. Before
   * the transition, the Op is snapshotted as detached JSON; after an accepted
   * transition, the Stage Op is appended, the Session is flushed, and only
   * then is `accepted` returned. A flush failure rejects the call without
   * promising rollback of already advanced live state. Domain rejections
   * return a reason and are not persisted; program faults throw.
   */
  async interact(stageId: string, op: unknown): Promise<InteractionResult> {
    const live = this.requireLive(stageId)
    const persistedOp = snapshotJsonValue(op as JsonValue)
    if (persistedOp === undefined) {
      throw new Error(`Stage ${JSON.stringify(stageId)} Op must be lossless JSON`)
    }
    const result = live.machine.transition(persistedOp)
    if (result.kind === 'domain-rejected') return result
    let persistedOutcome: JsonValue | undefined
    if (result.outcome !== undefined) {
      persistedOutcome = snapshotJsonValue(result.outcome as JsonValue)
      if (persistedOutcome === undefined) {
        throw new Error(
          `Stage ${JSON.stringify(stageId)} accepted a non-JSON observational outcome`,
        )
      }
    }
    const stageOp: StageOp = persistedOutcome === undefined
      ? { stageId, op: persistedOp }
      : { stageId, op: persistedOp, outcome: persistedOutcome }
    live.session.append('stage/op', stageOp)
    await this.ctx.sessions.flush(live.session)
    return persistedOutcome === undefined
      ? { kind: 'accepted' }
      : { kind: 'accepted', outcome: persistedOutcome }
  }

  /** A detached JSON snapshot of the latest Stage state. */
  read(stageId: string): JsonValue {
    return this.requireLive(stageId).machine.read()
  }

  /** Whether the Stage has reached a terminal state. */
  completed(stageId: string): boolean {
    return this.requireLive(stageId).machine.completed
  }

  private requireLive(stageId: string): LiveStage {
    const live = this.live.get(stageId)
    if (live === undefined) {
      throw new Error(`Stage ${JSON.stringify(stageId)} is not live; call ensure() first`)
    }
    return live
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    stages: StageService
  }
}

export default StageService
