import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { Director, DirectorContext, DirectorDecision } from './types.js'

function createAbortError(message = 'Director decision aborted'): Error {
  const error = new Error(message)
  error.name = 'AbortError'
  return error
}

function waitUntilAborted(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    signal.addEventListener('abort', () => resolve(), { once: true })
  })
}

export interface StepDirectorOptions {
  /** Start in continuous mode without pausing at Director Points (defaults to `false`). */
  readonly continuous?: boolean
}

export interface StepDirectorController {
  /** Wrap any inner Director so it pauses before invoking `inner` unless permitted or continuous. */
  wrap(director: Director): Director
  /** Grant `count` Turn permits (defaults to 1). */
  allow(count?: number): void
  /**
   * Grant one Turn permit and resolve once the Turn settles at the next paused
   * Director Point, completes, or the Main Loop stops.
   */
  step(): Promise<void>
  /** Switch between paused step-gating (`false`) and continuous advancement (`true`). */
  setContinuous(enabled: boolean): void
  /** Whether continuous mode is currently enabled. */
  isContinuous(): boolean
  /** Whether the wrapped Director is currently parked at a Director Point waiting for a permit. */
  isWaiting(): boolean
  /** Resolves immediately if waiting, or when the wrapped Director next parks (or ends). */
  whenWaiting(): Promise<void>
}

/**
 * Create a step-gating Director wrapper. When paused (`continuous: false`), the
 * wrapped Director parks at each Director Point before invoking the inner
 * Director, so side-effecting or human Directors are never called prematurely
 * and `act` decisions are never discarded.
 */
export function createStepDirector(options: StepDirectorOptions = {}): StepDirectorController {
  let continuous = options.continuous ?? false
  let permits = 0
  let waiting = false
  let completed = false
  let activeSignal: AbortSignal | undefined
  let wakePermit: (() => void) | undefined
  const waitingResolvers: Array<() => void> = []

  const flushWaiting = () => {
    while (waitingResolvers.length > 0) waitingResolvers.shift()!()
  }

  const releasePermit = () => {
    const wake = wakePermit
    wakePermit = undefined
    wake?.()
  }

  const waitForPermit = (signal: AbortSignal): Promise<void> => {
    if (continuous || permits > 0) return Promise.resolve()
    if (signal.aborted) return Promise.reject(createAbortError())
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        if (wakePermit === onPermit) wakePermit = undefined
        reject(createAbortError())
      }
      const onPermit = () => {
        signal.removeEventListener('abort', onAbort)
        resolve()
      }
      wakePermit = onPermit
      signal.addEventListener('abort', onAbort, { once: true })
    })
  }

  const waitForNextBoundary = (): Promise<void> => {
    if (completed || activeSignal?.aborted) return Promise.resolve()
    return new Promise((resolve) => {
      const signal = activeSignal
      const finish = () => {
        const index = waitingResolvers.indexOf(onBoundary)
        if (index >= 0) waitingResolvers.splice(index, 1)
        signal?.removeEventListener('abort', finish)
        resolve()
      }
      const onBoundary = () => finish()
      waitingResolvers.push(onBoundary)
      signal?.addEventListener('abort', finish, { once: true })
    })
  }

  return {
    wrap(inner: Director): Director {
      return async (context) => {
        activeSignal = context.signal
        if (!continuous && permits === 0) {
          if (context.signal.aborted) throw createAbortError()
          waiting = true
          flushWaiting()
          try {
            await waitForPermit(context.signal)
          } finally {
            waiting = false
          }
        }
        if (context.signal.aborted) throw createAbortError()
        if (!continuous && permits > 0) permits -= 1
        const decision = await inner(context)
        if (decision.kind === 'complete') {
          completed = true
          flushWaiting()
        }
        return decision
      }
    },

    allow(count = 1): void {
      if (!Number.isSafeInteger(count) || count < 1) {
        throw new Error('step permit count must be a positive integer')
      }
      permits += count
      if (waiting) releasePermit()
    },

    async step(): Promise<void> {
      if (continuous) throw new Error('cannot step while continuous mode is enabled')
      if (completed || activeSignal?.aborted) throw new Error('step Director is no longer active')
      if (!waiting) await this.whenWaiting()
      if (completed || activeSignal?.aborted) throw new Error('step Director is no longer active')
      const nextBoundary = waitForNextBoundary()
      permits += 1
      releasePermit()
      await nextBoundary
    },

    setContinuous(enabled: boolean): void {
      if (typeof enabled !== 'boolean') throw new Error('continuous mode must be boolean')
      continuous = enabled
      if (continuous) {
        permits = 0
        if (waiting) releasePermit()
      }
    },

    isContinuous(): boolean {
      return continuous
    },

    isWaiting(): boolean {
      return waiting
    },

    whenWaiting(): Promise<void> {
      if (waiting || completed || activeSignal?.aborted) return Promise.resolve()
      return waitForNextBoundary()
    },
  }
}

export interface HumanDirectorRequest {
  readonly context: DirectorContext
  act(characterId: string, instruction: readonly ContentBlock[]): void
  complete(): void
}

export interface HumanDirectorController {
  readonly director: Director
  /** Resolves with the currently pending or next human decision request. */
  nextRequest(): Promise<HumanDirectorRequest>
  /** Whether the Director is currently awaiting a human decision at a Director Point. */
  isWaiting(): boolean
  /** Submit an `act` decision for the currently pending request. */
  act(characterId: string, instruction: readonly ContentBlock[]): void
  /** Submit a `complete` decision for the currently pending request. */
  complete(): void
}

/**
 * Create a pluggable Human-driven Director. At each Director Point, it parks
 * awaiting an external `act()` or `complete()` decision and honors the
 * Theater Main Loop's `AbortSignal`.
 */
export function createHumanDirector(): HumanDirectorController {
  interface PendingDecision {
    readonly request: HumanDirectorRequest
    readonly settle: (decision: DirectorDecision) => void
  }

  let pending: PendingDecision | undefined
  let requestDelivered = false
  const requestWaiters: Array<{
    resolve: (request: HumanDirectorRequest) => void
    reject: (error: Error) => void
  }> = []

  const director: Director = (context) => {
    if (context.signal.aborted) return Promise.reject(createAbortError())
    return new Promise<DirectorDecision>((resolve, reject) => {
      let settled = false
      const cleanup = () => {
        context.signal.removeEventListener('abort', onAbort)
        if (pending?.request === request) {
          pending = undefined
          requestDelivered = false
        }
      }
      const settle = (decision: DirectorDecision) => {
        if (settled) return
        settled = true
        cleanup()
        resolve(decision)
      }
      const onAbort = () => {
        if (settled) return
        settled = true
        cleanup()
        const error = createAbortError()
        while (requestWaiters.length > 0) requestWaiters.shift()!.reject(error)
        reject(error)
      }
      const request: HumanDirectorRequest = {
        context,
        act(characterId, instruction) {
          settle({ kind: 'act', characterId, instruction })
        },
        complete() {
          settle({ kind: 'complete' })
        },
      }
      pending = { request, settle }
      requestDelivered = false
      context.signal.addEventListener('abort', onAbort, { once: true })
      const waiter = requestWaiters.shift()
      if (waiter !== undefined) {
        requestDelivered = true
        waiter.resolve(request)
      }
    })
  }

  return {
    director,

    nextRequest(): Promise<HumanDirectorRequest> {
      if (pending !== undefined && !requestDelivered) {
        requestDelivered = true
        return Promise.resolve(pending.request)
      }
      return new Promise((resolve, reject) => {
        requestWaiters.push({ resolve, reject })
      })
    },

    isWaiting(): boolean {
      return pending !== undefined
    },

    act(characterId: string, instruction: readonly ContentBlock[]): void {
      if (pending === undefined) throw new Error('Human Director has no pending decision request')
      pending.request.act(characterId, instruction)
    },

    complete(): void {
      if (pending === undefined) throw new Error('Human Director has no pending decision request')
      pending.request.complete()
    },
  }
}

export interface TurnLimitDirectorController {
  /** Wrap an inner Director to grant at most `maxSegments` `act` decisions before parking. */
  wrap(director: Director): Director
  /** Resolves once the limit has been reached at a Director Point. */
  whenReached(): Promise<void>
  readonly reached: boolean
  readonly turnsGranted: number
}

/**
 * Create a Director wrapper that allows up to `maxSegments` top-level `act`
 * decisions and then parks at the next Director Point (without calling the
 * inner Director again) until cancelled via `AbortSignal`.
 */
export function createTurnLimitDirector(maxSegments: number): TurnLimitDirectorController {
  if (!Number.isSafeInteger(maxSegments) || maxSegments < 1) {
    throw new Error(`maxSegments must be a positive integer, received ${String(maxSegments)}`)
  }
  let turnsGranted = 0
  let reached = false
  const reachedWaiters: Array<() => void> = []

  const notifyReached = () => {
    while (reachedWaiters.length > 0) reachedWaiters.shift()!()
  }

  return {
    wrap(inner: Director): Director {
      return async (context) => {
        if (context.signal.aborted) throw createAbortError()
        if (turnsGranted >= maxSegments) {
          reached = true
          notifyReached()
          await waitUntilAborted(context.signal)
          throw createAbortError()
        }
        const decision = await inner(context)
        if (decision.kind === 'act') turnsGranted += 1
        return decision
      }
    },

    whenReached(): Promise<void> {
      if (reached) return Promise.resolve()
      return new Promise((resolve) => {
        reachedWaiters.push(resolve)
      })
    },

    get reached(): boolean {
      return reached
    },

    get turnsGranted(): number {
      return turnsGranted
    },
  }
}
