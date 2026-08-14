import { describe, expect, it } from 'vitest'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import {
  appendTheaterEvent,
  listTheaterEvents,
  theaterEventFromSessionEvent,
} from '../src/events.js'

describe('Theater event envelope', () => {
  it('round-trips through a known DSH user/message event', () => {
    const session = Session.create(SessionId('performance-test'))
    const event = appendTheaterEvent({
      session,
      performanceId: 'test',
      type: 'theater/configured',
      data: {
        performanceId: 'test',
        scenarioId: 'fake',
        config: {},
        characterSessions: {
          a: SessionId('agent-a'),
        },
      },
      summary: 'Configured fake performance.',
    })

    expect(event.type).toBe('user/message')
    expect(theaterEventFromSessionEvent(event)).toEqual({
      type: 'theater/configured',
      data: {
        performanceId: 'test',
        scenarioId: 'fake',
        config: {},
        characterSessions: {
          a: 'agent-a',
        },
      },
    })
    expect(listTheaterEvents(session.events)).toHaveLength(1)
    expect(session.deriveMessages()).toHaveLength(1)
  })
})
