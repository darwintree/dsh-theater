import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import type {
  JsonValue,
  Session,
  SessionEvent,
  SessionId,
} from '@deepseek-ai/dsh-session'

/** Merge-extensible shared performance-event vocabulary. */
export interface TheaterEventMap {
  'theater/configured': {
    performanceId: string
    scenarioId: string
    config: JsonValue
    characterSessions: Record<string, SessionId>
  }
}

/** String event names contributed by Theater and its domain packages. */
export type TheaterEventType = Extract<keyof TheaterEventMap, string>

/** One typed event embedded in a Theater message source. */
export type TheaterEvent<K extends TheaterEventType = TheaterEventType> = {
  [P in K]: {
    type: P
    data: TheaterEventMap[P]
  }
}[K]

/** Message source used by a dedicated performance session. */
export interface TheaterMessageSource {
  kind: 'theater'
  performanceId: string
  event: TheaterEvent
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    theater: TheaterMessageSource
  }
}

/** Input accepted by {@link appendTheaterEvent}. */
export interface AppendTheaterEventInput<K extends TheaterEventType> {
  session: Session
  performanceId: string
  type: K
  data: TheaterEventMap[K]
  summary: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Whether a user message carries one structured Theater event. */
export function isTheaterMessage(message: unknown): message is UserMessage & { source: TheaterMessageSource } {
  if (!isRecord(message) || message.role !== 'user' || !isRecord(message.source)) return false
  const source = message.source
  if (source.kind !== 'theater' || typeof source.performanceId !== 'string') return false
  if (!isRecord(source.event) || typeof source.event.type !== 'string') return false
  return Object.hasOwn(source.event, 'data')
}

/** Read the Theater event carried by one DSH session event. */
export function theaterEventFromSessionEvent(event: SessionEvent): TheaterEvent | undefined {
  if (event.type !== 'user/message' || !isTheaterMessage(event.data)) return undefined
  return event.data.source.event
}

/** Read every structured Theater event in session order. */
export function listTheaterEvents(events: readonly SessionEvent[]): TheaterEvent[] {
  const result: TheaterEvent[] = []
  for (const event of events) {
    const theaterEvent = theaterEventFromSessionEvent(event)
    if (theaterEvent !== undefined) result.push(theaterEvent)
  }
  return result
}

/**
 * Append one structured performance fact through DSH's known `user/message`
 * event. The summary is human-readable; consumers reconstruct state from the
 * typed source envelope.
 */
export function appendTheaterEvent<K extends TheaterEventType>(
  input: AppendTheaterEventInput<K>,
): SessionEvent<'user/message'> {
  if (input.performanceId.trim() === '') throw new Error('performanceId must be non-empty')
  if (input.summary.trim() === '') throw new Error('Theater event summary must be non-empty')

  const embedded = {
    type: input.type,
    data: input.data,
  } as unknown as TheaterEvent

  const message = createUserMessage({
    content: [{ type: 'text', text: input.summary }],
    source: {
      kind: 'theater',
      performanceId: input.performanceId,
      event: embedded,
    },
  })

  return input.session.append('user/message', message, { surfaceOp: 'append' })
}
