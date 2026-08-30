import {
  KNOWN_SESSION_EVENT_TYPES,
  type SessionEvent,
  type TurnEndReason,
} from '@deepseek-ai/dsh-session'
import type { TheaterConfigured, TheaterSegmentEnded } from './types.js'

export const THEATER_REQUIRED_EVENT_TYPES = [
  'theater/character-configured',
  'theater/configured',
  'theater/segment-started',
  'theater/segment-ended',
] as const

interface EventTypeOwner {
  initiallyKnown: boolean
  owners: number
}

interface EventTypeRegistry {
  catalogs: WeakMap<Set<string>, Map<string, EventTypeOwner>>
}

const eventTypeRegistryKey = Symbol.for('@darwintree/dsh-theater/session-event-types')
const eventTypeRegistryGlobal = globalThis as typeof globalThis & {
  [key: symbol]: EventTypeRegistry | undefined
}

/** Register Theater's durable vocabulary for one Service lifecycle. */
export function registerTheaterSessionEventTypes(): () => void {
  const registry = eventTypeRegistryGlobal[eventTypeRegistryKey] ??= { catalogs: new WeakMap() }
  const catalog = KNOWN_SESSION_EVENT_TYPES as Set<string>
  let owners = registry.catalogs.get(catalog)
  if (owners === undefined) registry.catalogs.set(catalog, owners = new Map())
  const owned = THEATER_REQUIRED_EVENT_TYPES.map((type) => {
    let owner = owners.get(type)
    if (owner === undefined) owners.set(type, owner = { initiallyKnown: catalog.has(type), owners: 0 })
    owner.owners += 1
    catalog.add(type)
    return [type, owner] as const
  })
  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    for (const [type, owner] of owned) {
      owner.owners -= 1
      if (owner.owners !== 0) continue
      if (!owner.initiallyKnown) catalog.delete(type)
      owners.delete(type)
    }
  }
}

interface DurableAnalysis {
  configured: TheaterConfigured
  stack: string[]
  forkablePositions: number[]
  watermarks: Map<string, number>
}

export function analyze(events: readonly SessionEvent[]): DurableAnalysis {
  let configured: TheaterConfigured | undefined
  const stack: string[] = []
  const forkablePositions: number[] = []
  const watermarks = new Map<string, number>()
  for (const event of events) {
    if (event.type === 'theater/configured') {
      if (configured !== undefined) throw new Error('Performance has multiple theater/configured events')
      configured = { ...event.data, autoAdvance: event.data.autoAdvance ?? true }
    } else if (event.type === 'theater/segment-started') {
      if (configured === undefined) throw new Error('Character Segment started before Performance configuration')
      stack.push(event.data.characterId)
    } else if (event.type === 'theater/segment-ended') {
      const expected = stack.pop()
      if (expected === undefined || expected !== event.data.characterId) {
        throw new Error(`Character Segment end for ${JSON.stringify(event.data.characterId)} violates LIFO order`)
      }
      watermarks.set(event.data.characterId, event.data.characterSessionSeq)
    }
    if (configured !== undefined && stack.length === 0) forkablePositions.push(event.seq + 1)
  }
  if (configured === undefined) throw new Error('Session is not a Theater Performance')
  return { configured, stack, forkablePositions, watermarks }
}

export function settlement(reason: TurnEndReason): Pick<TheaterSegmentEnded, 'outcome' | 'error'> {
  switch (reason.kind) {
    case 'completed': return { outcome: 'completed' }
    case 'aborted': return { outcome: 'aborted', error: { message: 'Character action aborted', code: 'ABORTED' } }
    case 'error': return { outcome: 'error', error: reason.error }
    case 'max-tokens': return { outcome: 'error', error: { message: 'Character action exhausted its token limit', code: 'MAX_TOKENS' } }
    case 'blocked': return { outcome: 'error', error: { message: 'Character action blocked', code: 'BLOCKED' } }
    case 'interrupted': return { outcome: 'error', error: { message: 'Character action interrupted', code: 'INTERRUPTED' } }
  }
}
