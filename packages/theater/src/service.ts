/// <reference types="node" />

import { Service, type Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import {
  SessionId,
  SessionLogOffset,
  SessionSeq,
  type SessionId as SessionIdType,
} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { createScope } from '@deepseek-ai/dsh-scope'
import { TheaterCatalog } from './catalog.js'
import { characterSessionId, nonEmpty, resolvedConfiguration } from './configuration.js'
import { analyze, registerTheaterSessionEventTypes } from './events.js'
import { ensureSessionTitle, PerformanceRuntime } from './runtime.js'
import type {
  CreatePerformanceInput,
  Director,
  ForkPerformanceInput,
  PerformanceRead,
  ResumePerformanceInput,
  TheaterCharacterContribution,
  TheaterToolFactory,
} from './types.js'

/** `ctx.theater`: preset-composed Performance creation, driving, reading, resume, and fork. */
export class TheaterService extends Service {
  static inject = ['sessions', 'agents', 'agentPresets', 'agentDefaultModel', 'systemPrompt', 'tools']

  private readonly owner: Context
  private readonly catalog = new TheaterCatalog()
  private readonly live = new Map<SessionIdType, PerformanceRuntime>()

  constructor(ctx: Context) {
    super(ctx, 'theater')
    this.owner = ctx
    ctx.effect(registerTheaterSessionEventTypes, 'theater.sessionEventTypes()')
  }

  registerCharacter(character: TheaterCharacterContribution): () => void {
    return this.catalog.registerCharacter(this.ctx, character)
  }

  registerTitle(title: string): () => void {
    return this.catalog.registerTitle(this.ctx, title)
  }

  registerToolFactory(factory: TheaterToolFactory): () => void {
    return this.catalog.registerToolFactory(this.ctx, factory)
  }

  registerDirector(director: Director): () => void {
    return this.catalog.registerDirector(this.ctx, director)
  }

  async create(input: CreatePerformanceInput): Promise<PerformanceRead> {
    const performanceId = SessionId(nonEmpty(String(input.performanceId), 'Performance Session ID'))
    this.assertAvailable(performanceId)
    const presetId = nonEmpty(input.presetId, 'Agent Preset ID')
    if (typeof input.cwd !== 'string' || input.cwd.trim() === '') {
      throw new Error('Performance cwd must be non-empty')
    }
    const contributions = await this.catalog.resolveContributions(this.owner, presetId, input.director !== undefined)
    const director = this.catalog.resolveEffectiveDirector(presetId, contributions.director, input)
    const configured = resolvedConfiguration(presetId, contributions)
    const scope = createScope(this.owner, { performanceId })
    let pendingHandle: { close(): Promise<void> } | undefined
    try {
      const session = scope.ctx.sessions.prepare(performanceId, { meta: { cwd: input.cwd } })
      const persistence = this.owner.get('sessionPersistence')
      if (persistence !== undefined) {
        pendingHandle = await persistence.create(session.header, {
          inheritedEventCount: session.inheritedEventCount,
        })
      }
      scope.ctx.effect(function* () {
        yield scope.ctx.sessions.enter(session)
        scope.ctx.sessions.announce(session)
      }, `theater.performance(${performanceId})`)
      pendingHandle = undefined
      ensureSessionTitle(session, contributions.title)
      const titles = new Map(contributions.characters.map(character => [character.id, character.title]))
      const runtime = new PerformanceRuntime(this.owner, this.catalog, scope, session, configured, titles, director)
      runtime.registerCleanup(() => { this.live.delete(performanceId) })
      await runtime.openConfiguredStages()
      await runtime.createCharacters()
      await runtime.flushAll()
      session.append('theater/configured', configured)
      await scope.ctx.sessions.flush(session)
      this.live.set(performanceId, runtime)
      runtime.startMainLoop()
      return runtime.read()
    } catch (error) {
      this.live.delete(performanceId)
      await pendingHandle?.close().catch(() => {})
      await scope.dispose()
      throw error
    }
  }

  async resume(input: ResumePerformanceInput): Promise<PerformanceRead> {
    const performanceId = SessionId(nonEmpty(String(input.performanceId), 'Performance Session ID'))
    this.assertAvailable(performanceId)
    const persistence = this.owner.get('sessionPersistence')
    if (persistence === undefined) throw new Error('cannot resume Performance: session persistence is not configured')
    const scope = createScope(this.owner, { performanceId })
    let pendingHandle: { close(): Promise<void> } | undefined
    try {
      const handle = await persistence.open(performanceId, 'write')
      pendingHandle = handle
      const coldRead = await handle.read()
      const session = scope.ctx.sessions.prepare(performanceId, {
        seed: [...coldRead.events],
        meta: structuredClone(handle.header),
        inheritedEventCount: handle.inheritedEventCount,
        eventState: coldRead.eventState,
      })
      if (session.header.cwd === undefined) {
        throw new Error('cannot resume Performance: Session header has no cwd')
      }
      const unstoredSuffix = session.snapshotEvents(SessionLogOffset(coldRead.events.length))
      if (unstoredSuffix.length > 0) await handle.append(unstoredSuffix)
      scope.ctx.effect(function* () {
        yield scope.ctx.sessions.enter(session)
        scope.ctx.sessions.announce(session)
      }, `theater.performance(${performanceId})`)
      pendingHandle = undefined
      const analysis = analyze(session.snapshotEvents())
      const durable = analysis.configured
      const compatibility = await this.catalog.checkCompatibility(this.owner, durable, input)
      const runtime = new PerformanceRuntime(
        this.owner,
        this.catalog,
        scope,
        session,
        durable,
        compatibility.characterTitles,
        compatibility.director,
      )
      runtime.registerCleanup(() => { this.live.delete(performanceId) })
      await runtime.openCompatibleStages()
      this.live.set(performanceId, runtime)
      if (compatibility.error !== undefined || compatibility.director === undefined) {
        runtime.markIncompatible(compatibility.error ?? new Error('current Theater contributions are incompatible'))
        return runtime.read()
      }
      await runtime.resumeCharacters()
      ensureSessionTitle(session, compatibility.title)
      await runtime.flushAll()
      if (analysis.stack.length > 0) {
        runtime.markFailed(new Error(
          `Performance stopped with an unclosed Character Segment (${JSON.stringify(analysis.stack.at(-1))}); fork from the last Director Point to recover`,
        ))
        return runtime.read()
      }
      if (analysis.latestTopLevelTurn !== undefined && analysis.latestTopLevelTurn.outcome !== 'completed') {
        runtime.markFailed(new Error(
          analysis.latestTopLevelTurn.error?.message
            ?? `Character ${JSON.stringify(analysis.latestTopLevelTurn.characterId)} Turn ended with ${analysis.latestTopLevelTurn.outcome}; fork from the last Director Point to recover`,
        ))
        return runtime.read()
      }
      runtime.startMainLoop()
      return runtime.read()
    } catch (error) {
      this.live.delete(performanceId)
      await pendingHandle?.close().catch(() => {})
      await scope.dispose()
      throw error
    }
  }

  async fork(input: ForkPerformanceInput): Promise<PerformanceRead> {
    const sourceId = SessionId(nonEmpty(String(input.sourcePerformanceId), 'Source Performance Session ID'))
    const childId = SessionId(nonEmpty(String(input.childPerformanceId), 'Child Performance Session ID'))
    this.assertAvailable(childId)
    const source = this.requireRuntime(sourceId)
    if (source.phase === 'incompatible') throw source.error
    const sourceEvents = source.session.snapshotEvents()
    if (!Number.isSafeInteger(input.cursor) || input.cursor < 1 || input.cursor > sourceEvents.length) {
      throw new Error(`Performance fork cursor must be an exclusive sequence between 1 and ${sourceEvents.length}`)
    }
    const sourceAnalysis = analyze(sourceEvents)
    if (!sourceAnalysis.forkablePositions.includes(input.cursor)) {
      throw new Error(`Performance fork cursor ${input.cursor} is not a Director Point`)
    }
    const prefix = sourceEvents.slice(0, input.cursor)
    const selected = analyze(prefix)
    const compatibility = await this.catalog.checkCompatibility(this.owner, selected.configured, input)
    if (compatibility.error !== undefined || compatibility.director === undefined) {
      throw compatibility.error ?? new Error('current Theater contributions are incompatible with durable Performance configuration')
    }
    const seeds = selected.configured.characters.map((character) => {
      const parentId = characterSessionId(sourceId, character.id)
      const parent = this.owner.sessions.get(parentId)
      if (parent === undefined) throw new Error(`source Character Session is not live: ${parentId}`)
      const parentEvents = parent.snapshotEvents()
      const watermark = selected.watermarks.get(character.id) ?? 0
      if (!Number.isSafeInteger(watermark) || watermark < 0 || watermark > parentEvents.length) {
        throw new Error(`invalid Character Session watermark ${watermark} for ${JSON.stringify(character.id)}`)
      }
      return { character, parent, watermark, seed: parentEvents.slice(0, watermark) }
    })
    const scope = createScope(this.owner, { performanceId: childId })
    try {
      const session = scope.ctx.sessions.fork(source.session, SessionSeq(input.cursor - 1), childId)
      const persistence = this.owner.get('sessionPersistence')
      if (persistence !== undefined) {
        const handle = await persistence.create(session.header, {
          inheritedEventCount: session.inheritedEventCount,
        })
        const seedEvents = session.snapshotEvents()
        if (seedEvents.length > 0) await handle.append(seedEvents)
      }
      const runtime = new PerformanceRuntime(
        this.owner,
        this.catalog,
        scope,
        session,
        selected.configured,
        compatibility.characterTitles,
        compatibility.director,
      )
      runtime.registerCleanup(() => { this.live.delete(childId) })
      await runtime.openConfiguredStages()
      await runtime.createCharacters(seeds)
      await runtime.flushAll()
      this.live.set(childId, runtime)
      runtime.startMainLoop()
      return runtime.read()
    } catch (error) {
      this.live.delete(childId)
      await scope.dispose()
      throw error
    }
  }

  /** Wait until the Theater Main Loop finishes (`activity === 'idle'`). */
  async whenIdle(performanceId: SessionIdType): Promise<void> {
    await this.requireRuntime(performanceId).whenIdle()
  }

  /** Wait until the Performance is settled at a Director Point (`awaiting-director` or `idle`). */
  async whenAtDirectorPoint(performanceId: SessionIdType): Promise<PerformanceRead> {
    return await this.requireRuntime(performanceId).whenAtDirectorPoint()
  }

  /**
   * Cancel the active Main Loop for `performanceId` and wait for it to stop.
   * Stopping while `awaiting-director` leaves `phase: 'active'` and
   * `activity: 'idle'`; stopping while `executing-turn` aborts the active Turn
   * and settles into `phase: 'failed'` per ADR-0007.
   */
  async stop(performanceId: SessionIdType): Promise<PerformanceRead> {
    return await this.requireRuntime(performanceId).stop()
  }

  read(performanceId: SessionIdType): PerformanceRead {
    return this.requireRuntime(performanceId).read()
  }

  private assertAvailable(performanceId: SessionIdType): void {
    if (this.live.has(performanceId) || this.owner.sessions.get(performanceId) !== undefined) {
      throw new Error(`Performance ${JSON.stringify(performanceId)} is already live`)
    }
  }

  private requireRuntime(performanceId: SessionIdType): PerformanceRuntime {
    const runtime = this.live.get(performanceId)
    if (runtime === undefined) throw new Error(`Performance ${JSON.stringify(performanceId)} is not live`)
    return runtime
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    theater: TheaterService
  }
}

export default TheaterService
