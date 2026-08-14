import type { JsonValue, Session, SessionEvent, SessionStore, SessionId } from '@deepseek-ai/dsh-session'
import {
  appendTheaterEvent,
  listTheaterEvents,
  type TheaterEvent,
  type TheaterEventMap,
  type TheaterEventType,
} from './events.js'
import type { TheaterScenario, TheaterTurnRecommendation } from './scenario.js'

/** Runtime wrapper around one shared DSH performance session. */
export class TheaterPerformance<TConfig = unknown> {
  private disposed = false

  constructor(
    readonly id: string,
    readonly session: Session,
    readonly scenario: TheaterScenario<TConfig>,
    readonly config: TConfig,
    readonly characterSessions: Readonly<Record<string, SessionId>>,
    private readonly sessions: Pick<SessionStore, 'flush'>,
    private readonly release?: () => void,
  ) {}

  /** Append one typed shared performance fact. */
  append<K extends TheaterEventType>(
    type: K,
    data: TheaterEventMap[K],
    summary: string,
  ): SessionEvent<'user/message'> {
    if (this.disposed) throw new Error(`performance ${JSON.stringify(this.id)} is disposed`)
    return appendTheaterEvent({
      session: this.session,
      performanceId: this.id,
      type,
      data,
      summary,
    })
  }

  /** Structured performance facts in durable session order. */
  eventLog(): TheaterEvent[] {
    return listTheaterEvents(this.session.events)
  }

  /** Ask the domain for the next turn without driving an agent yet. */
  recommendNextTurn(): TheaterTurnRecommendation | null {
    if (this.disposed) throw new Error(`performance ${JSON.stringify(this.id)} is disposed`)
    return this.scenario.nextTurn({
      config: this.config,
      performanceEvents: this.session.events,
    })
  }

  /** Await every configured DSH persistence backend for this session. */
  async flush(): Promise<boolean> {
    if (this.disposed) throw new Error(`performance ${JSON.stringify(this.id)} is disposed`)
    return this.sessions.flush(this.session)
  }

  /** Flush, then release the live session when this handle owns it. */
  async dispose(): Promise<void> {
    if (this.disposed) return
    try {
      await this.sessions.flush(this.session)
    } finally {
      this.disposed = true
      this.release?.()
    }
  }
}

/** JSON-safe configuration stored in the first performance fact. */
export interface StoredPerformanceConfiguration {
  performanceId: string
  scenarioId: string
  config: JsonValue
  characterSessions: Record<string, SessionId>
}
