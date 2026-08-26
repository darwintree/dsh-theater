import { Service, type Context } from '@deepseek-ai/cordis'
import {
  snapshotJsonValue,
  type JsonValue,
  type Session,
  type SessionEvent,
} from '@deepseek-ai/dsh-session'
import {
  StageCatalog,
  type StageDeclarations,
} from './catalog.js'
import {
  configuredEvent,
  isStageOpEvent,
  registerStageSessionEventTypes,
  stageEvents,
  type StageOp,
} from './events.js'
import type { StateMachine, StateMachineFactory } from './machine.js'

/** Inputs to lazily create or restore one Stage. */
export interface EnsureStageInput {
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
}

function nonEmpty(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} must be non-empty`)
  }
  return value
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
 * State Machines by owning Session and Stage ID. The Service owns Session
 * configuration, accepted Op persistence, flush, replay, read, and completion;
 * State Machines hold only live state and deterministic domain rules. Stage
 * IDs are independent of State Machine kind and Agent identity.
 */
export class StageService extends Service {
  static inject = ['sessions']

  private readonly live = new WeakMap<Session, Map<string, LiveStage>>()
  private readonly catalog = new StageCatalog()

  constructor(ctx: Context) {
    super(ctx, 'stages')
    ctx.effect(registerStageSessionEventTypes, 'stages.sessionEventTypes()')
  }

  /** Register one process-wide State Machine factory kind. */
  registerFactory(factory: StateMachineFactory): () => void {
    return this.catalog.registerFactory(this.ctx, factory)
  }

  /** Resolve and register a preset's Stage declarations in its standing scope. */
  declare(declarations: StageDeclarations): () => void {
    return this.catalog.declare(this.ctx, declarations)
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
  async ensure(session: Session, stageId: string, input: EnsureStageInput): Promise<void> {
    return await this.ensureUsing(
      session,
      stageId,
      input.factory,
      () => snapshotJsonValue(input.factory.resolveConfig(input.config ?? {})),
    )
  }

  /** Lazily ensure one Stage from declarations visible to `declarationCtx`. */
  async ensureDeclared(
    declarationCtx: Context,
    session: Session,
    stageId: string,
  ): Promise<void> {
    const declaration = this.catalog.resolve(declarationCtx, stageId)
    if (declaration === undefined) {
      throw new Error(`Stage ${JSON.stringify(stageId)} is not declared in this scope`)
    }
    return await this.ensureUsing(
      session,
      stageId,
      declaration.factory,
      () => declaration.config,
    )
  }

  private async ensureUsing(
    session: Session,
    stageId: string,
    factory: StateMachineFactory,
    initialConfig: () => JsonValue | undefined,
  ): Promise<void> {
    nonEmpty(stageId, 'Stage ID')
    nonEmpty(factory.kind, 'State Machine kind')
    nonEmpty(factory.version, 'State Machine version')
    const live = this.liveFor(session)
    if (live.has(stageId)) return
    const configured = configuredEvent(session.events, stageId)
    if (configured !== undefined) {
      if (configured.data.machine !== factory.kind) {
        throw new Error(
          `State Machine kind mismatch for Stage ${JSON.stringify(stageId)}`,
        )
      }
      if (configured.data.version !== factory.version) {
        throw new Error(
          `Stage version mismatch for ${JSON.stringify(stageId)}`,
        )
      }
      const machine = replayMachine(
        session.events,
        factory,
        stageId,
        configured.data.config,
      )
      live.set(stageId, { machine })
      return
    }
    const config = initialConfig()
    if (config === undefined) {
      throw new Error(
        `State Machine ${JSON.stringify(factory.kind)} returned non-JSON configuration`,
      )
    }
    const machine = factory.create(config)
    if (machine.kind !== factory.kind || machine.version !== factory.version) {
      throw new Error(
        `State Machine kind/version mismatch for Stage ${JSON.stringify(stageId)}`,
      )
    }
    session.append('stage/configured', {
      stageId,
      machine: factory.kind,
      version: factory.version,
      config,
    })
    await this.ctx.sessions.flush(session)
    live.set(stageId, { machine })
  }

  /**
   * Apply one canonical Op to the live State Machine for `stageId`. Before
   * the transition, the Op is snapshotted as detached JSON; after an accepted
   * transition, the Stage Op is appended, the Session is flushed, and only
   * then is `accepted` returned. A flush failure rejects the call without
   * promising rollback of already advanced live state. Domain rejections
   * return a reason and are not persisted; program faults throw.
   */
  async interact(session: Session, stageId: string, op: unknown): Promise<InteractionResult> {
    const live = this.requireLive(session, stageId)
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
    session.append('stage/op', stageOp)
    await this.ctx.sessions.flush(session)
    return persistedOutcome === undefined
      ? { kind: 'accepted' }
      : { kind: 'accepted', outcome: persistedOutcome }
  }

  /** A detached JSON snapshot of the latest Stage state. */
  read(session: Session, stageId: string): JsonValue {
    return this.requireLive(session, stageId).machine.read()
  }

  /** Whether the Stage has reached a terminal state. */
  completed(session: Session, stageId: string): boolean {
    return this.requireLive(session, stageId).machine.completed
  }

  private liveFor(session: Session): Map<string, LiveStage> {
    let live = this.live.get(session)
    if (live === undefined) {
      live = new Map()
      this.live.set(session, live)
    }
    return live
  }

  private requireLive(session: Session, stageId: string): LiveStage {
    const live = this.live.get(session)?.get(stageId)
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
