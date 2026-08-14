import { Service, type Context } from '@deepseek-ai/cordis'
import {
  SessionId,
  snapshotJsonValue,
  type Session,
  type SessionId as SessionIdType,
} from '@deepseek-ai/dsh-session'
import { theaterEventFromSessionEvent } from './events.js'
import { TheaterPerformance } from './performance.js'
import type { TheaterScenario } from './scenario.js'

declare module '@deepseek-ai/cordis' {
  interface Context {
    theater: TheaterRuntime
  }
}

/** Input for creating one live performance session. */
export interface CreateTheaterPerformanceInput {
  performanceId: string
  scenarioId: string
  config: unknown
  characterSessions: Record<string, SessionIdType>
  sessionId?: SessionIdType
}

function validateCharacterIds(ids: readonly string[]): string[] {
  const result = [...ids]
  if (result.length === 0) throw new Error('a Theater scenario must declare at least one character')
  const seen = new Set<string>()
  for (const id of result) {
    if (id.trim() === '') throw new Error('Theater character ids must be non-empty')
    if (seen.has(id)) throw new Error(`duplicate Theater character id: ${id}`)
    seen.add(id)
  }
  return result
}

function validateCharacterSessions(
  characters: readonly string[],
  sessions: Readonly<Record<string, SessionIdType>>,
): void {
  const expected = new Set(characters)
  for (const character of characters) {
    if (sessions[character] === undefined) {
      throw new Error(`missing session id for Theater character ${JSON.stringify(character)}`)
    }
  }
  const unknown = Object.keys(sessions).filter(character => !expected.has(character))
  if (unknown.length > 0) {
    throw new Error(`session mapping contains unknown Theater character(s): ${unknown.join(', ')}`)
  }
}

/** `ctx.theater`: scenario registry and performance-session factory. */
export class TheaterRuntime extends Service {
  static inject = ['sessions']

  private readonly scenarios = new Map<string, TheaterScenario<unknown>>()

  constructor(ctx: Context) {
    super(ctx, 'theater')
  }

  /** Register one domain scenario for the calling plugin fiber. */
  registerScenario<TConfig>(scenario: TheaterScenario<TConfig>): () => void {
    if (scenario.id.trim() === '') throw new Error('Theater scenario id must be non-empty')
    const erased = scenario as TheaterScenario<unknown>
    const dispose = this.ctx.effect(() => {
      if (this.scenarios.has(scenario.id)) {
        throw new Error(`Theater scenario already registered: ${scenario.id}`)
      }
      this.scenarios.set(scenario.id, erased)
      return () => {
        if (this.scenarios.get(scenario.id) === erased) this.scenarios.delete(scenario.id)
      }
    }, 'theater.registerScenario()')
    return () => void dispose()
  }

  /** Registered scenario ids in insertion order. */
  listScenarios(): string[] {
    return [...this.scenarios.keys()]
  }

  /** Resolve one scenario or fail loudly. */
  requireScenario<TConfig = unknown>(id: string): TheaterScenario<TConfig> {
    const scenario = this.scenarios.get(id)
    if (scenario === undefined) throw new Error(`unknown Theater scenario: ${id}`)
    return scenario as TheaterScenario<TConfig>
  }

  /** Create, configure, publish, and flush one performance session. */
  async create<TConfig = unknown>(
    input: CreateTheaterPerformanceInput,
  ): Promise<TheaterPerformance<TConfig>> {
    if (input.performanceId.trim() === '') throw new Error('performanceId must be non-empty')
    const scenario = this.requireScenario<TConfig>(input.scenarioId)
    const parsedConfig = scenario.parseConfig(input.config)
    const storedConfig = snapshotJsonValue(parsedConfig)
    if (storedConfig === undefined) {
      throw new Error(`scenario ${JSON.stringify(input.scenarioId)} returned non-JSON configuration`)
    }
    const characters = validateCharacterIds(scenario.characters(parsedConfig))
    validateCharacterSessions(characters, input.characterSessions)

    const sessionId = input.sessionId ?? SessionId(`theater:${input.performanceId}`)
    const session = this.ctx.sessions.prepare(sessionId)
    const performance = new TheaterPerformance<TConfig>(
      input.performanceId,
      session,
      scenario,
      parsedConfig,
      Object.freeze({ ...input.characterSessions }),
      this.ctx.sessions,
    )

    performance.append('theater/configured', {
      performanceId: input.performanceId,
      scenarioId: input.scenarioId,
      config: storedConfig,
      characterSessions: { ...input.characterSessions },
    }, `Performance ${input.performanceId} configured for scenario ${input.scenarioId}.`)

    let detach: (() => void) | undefined
    let releaseEffect: (() => void) | undefined
    try {
      detach = this.ctx.sessions.enter(session)
      this.ctx.sessions.announce(session)
      releaseEffect = this.ctx.effect(() => () => detach?.(), `theater.performance(${input.performanceId})`)
      const live = new TheaterPerformance<TConfig>(
        input.performanceId,
        session,
        scenario,
        parsedConfig,
        Object.freeze({ ...input.characterSessions }),
        this.ctx.sessions,
        () => void releaseEffect?.(),
      )
      await live.flush()
      return live
    } catch (error: unknown) {
      if (releaseEffect !== undefined) void releaseEffect()
      else detach?.()
      throw error
    }
  }

  /** Open an already-live performance session using its configured fact. */
  open<TConfig = unknown>(session: Session): TheaterPerformance<TConfig> {
    const configured = session.events
      .map(theaterEventFromSessionEvent)
      .find(event => event?.type === 'theater/configured')
    if (configured === undefined || configured.type !== 'theater/configured') {
      throw new Error(`session ${JSON.stringify(session.id)} is not a configured Theater performance`)
    }
    const data = configured.data
    const scenario = this.requireScenario<TConfig>(data.scenarioId)
    const parsedConfig = scenario.parseConfig(data.config)
    const characters = validateCharacterIds(scenario.characters(parsedConfig))
    validateCharacterSessions(characters, data.characterSessions)
    return new TheaterPerformance<TConfig>(
      data.performanceId,
      session,
      scenario,
      parsedConfig,
      Object.freeze({ ...data.characterSessions }),
      this.ctx.sessions,
    )
  }
}

export default TheaterRuntime
