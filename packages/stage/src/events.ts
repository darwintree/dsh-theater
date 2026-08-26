import {
  KNOWN_SESSION_EVENT_TYPES,
  type JsonValue,
  type SessionEvent,
} from '@deepseek-ai/dsh-session'

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

/** The unique durable configuration event for one Stage ID, when present. */
export function configuredEvent(
  events: readonly SessionEvent[],
  stageId: string,
): SessionEvent<'stage/configured'> | undefined {
  const configured = stageEvents(events, stageId).filter(isStageConfiguredEvent)
  if (configured.length > 1) {
    throw new Error(`Stage ${JSON.stringify(stageId)} has multiple configurations`)
  }
  return configured[0]
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
