/// <reference types="node" />

import { Service, type Context } from '@deepseek-ai/cordis'
import type { Agent, ModelSelection } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import * as AgentInstructions from '@deepseek-ai/dsh-agent-instructions'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import { createUserMessage, type ContentBlock } from '@deepseek-ai/dsh-llm'
import {
  SessionId,
  SessionLogOffset,
  SessionSeq,
  type Session,
  type SessionEvent,
  type SessionId as SessionIdType,
} from '@deepseek-ai/dsh-session'
import { snapshotJsonValue, type JsonValue } from '@deepseek-ai/dsh-util-values'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-session-title'
import { PERSONA_PREFIX_SECTION } from '@deepseek-ai/dsh-system-prompt'
import {
  AnonymousEntries,
  ScopedLayers,
  createScope,
  scopeOf,
  type Scope,
  type ScopeKey,
  type ScopeLayer,
} from '@deepseek-ai/dsh-scope'
import type { StageService, StateMachineFactory } from '@darwintree/dsh-stage'
import {
  characterSessionId,
  failure,
  nonEmpty,
  resolvedConfiguration,
  structuralIncompatibility,
} from './configuration.js'
import { analyze, registerTheaterSessionEventTypes, settlement } from './events.js'
import { extractTurnContent, sliceActiveTurnEvents, sliceSettledTurnEvents } from './turns.js'
import type {
  ActiveCharacterTurnRead,
  CharacterTurnRead,
  CreatePerformanceInput,
  Director,
  DirectorOverrideOptions,
  ForkPerformanceInput,
  PerformanceActivity,
  PerformancePhase,
  PerformanceRead,
  ResumePerformanceInput,
  TheaterCharacterContribution,
  TheaterConfigured,
  TheaterConfiguredCharacter,
  TheaterSegmentEnded,
  TheaterToolContext,
  TheaterToolFactory,
} from './types.js'

interface ContributionLayer extends ScopeLayer {
  readonly titles: AnonymousEntries<string>
  readonly characters: AnonymousEntries<TheaterCharacterContribution>
  readonly directors: AnonymousEntries<Director>
}

interface ResolvedCharacter {
  readonly id: string
  readonly title: string
  readonly model?: ModelSelection
  readonly systemPrompt: string
  readonly tools: readonly { readonly factory: TheaterToolFactory; readonly config: JsonValue }[]
}

interface TheaterContributions {
  readonly title: string
  readonly characters: readonly ResolvedCharacter[]
  readonly stages: readonly {
    readonly stageId: string
    readonly factory: StateMachineFactory
    readonly config: JsonValue
  }[]
  readonly director?: Director
}

interface PresetStructure {
  readonly title: string
  readonly characterTitles: ReadonlyMap<string, string>
  readonly characterIds: readonly string[]
  readonly stages: readonly { readonly stageId: string; readonly machine: string; readonly version: string }[]
  readonly director?: Director
}

interface ActiveTurnFrame {
  readonly characterId: string
  readonly agent: Agent
  abortReason?: string
}

interface PerformanceRuntime {
  readonly scope: Scope
  readonly session: Session
  readonly configured: TheaterConfigured
  readonly characterTitles: ReadonlyMap<string, string>
  readonly characters: Map<string, Agent>
  readonly liveStages: Set<string>
  readonly activeTurns: ActiveTurnFrame[]
  readonly activityWaiters: Set<() => void>
  director?: Director
  phase: PerformancePhase
  activity: PerformanceActivity
  error?: Error
  stopping: boolean
  loopAbort: AbortController | undefined
  mainLoop: Promise<void>
}

interface TurnExecution {
  readonly read: CharacterTurnRead
  readonly error?: TheaterSegmentEnded['error']
}

/** `ctx.theater`: preset-composed Performance creation, driving, reading, resume, and fork. */
export class TheaterService extends Service {
  static inject = ['sessions', 'agents', 'agentPresets', 'agentDefaultModel', 'systemPrompt', 'tools']

  private readonly layers = new ScopedLayers<ContributionLayer>(
    () => ({
      titles: new AnonymousEntries<string>(),
      characters: new AnonymousEntries<TheaterCharacterContribution>(),
      directors: new AnonymousEntries<Director>(),
      isEmpty() {
        return this.titles.isEmpty() && this.characters.isEmpty() && this.directors.isEmpty()
      },
    }),
    () => undefined,
  )
  private readonly owner: Context
  private readonly toolFactories = new Map<string, TheaterToolFactory>()
  private readonly live = new Map<SessionIdType, PerformanceRuntime>()

  constructor(ctx: Context) {
    super(ctx, 'theater')
    this.owner = ctx
    ctx.effect(registerTheaterSessionEventTypes, 'theater.sessionEventTypes()')
  }

  registerCharacter(character: TheaterCharacterContribution): () => void {
    return this.registerContribution(character, layer => layer.characters, 'registerCharacter')
  }

  registerTitle(title: string): () => void {
    return this.registerContribution(nonEmpty(title, 'Performance title'), layer => layer.titles, 'registerTitle')
  }

  registerToolFactory(factory: TheaterToolFactory): () => void {
    const kind = nonEmpty(factory.kind, 'Theater Tool factory kind')
    if (scopeOf(this.ctx) !== undefined) {
      throw new Error('theater.registerToolFactory() requires the host scope')
    }
    return this.ctx.effect(() => {
      if (this.toolFactories.has(kind)) {
        throw new Error(`duplicate Theater Tool factory kind ${JSON.stringify(kind)}`)
      }
      this.toolFactories.set(kind, factory)
      return () => {
        if (this.toolFactories.get(kind) === factory) this.toolFactories.delete(kind)
      }
    }, `theater.registerToolFactory(${kind})`)
  }

  registerDirector(director: Director): () => void {
    return this.registerContribution(director, layer => layer.directors, 'registerDirector')
  }

  private registerContribution<T>(
    contribution: T,
    entries: (layer: ContributionLayer) => AnonymousEntries<T>,
    method: string,
  ): () => void {
    const ctx = this.ctx
    if (scopeOf(ctx) === undefined) {
      throw new Error(`theater.${method}() requires an Agent Preset standing scope`)
    }
    return this.layers.effect(
      ctx,
      layer => entries(layer).append(contribution),
      { label: `theater.${method}()`, notify: false },
    )
  }

  async create(input: CreatePerformanceInput): Promise<PerformanceRead> {
    const performanceId = SessionId(nonEmpty(String(input.performanceId), 'Performance Session ID'))
    this.assertAvailable(performanceId)
    const presetId = nonEmpty(input.presetId, 'Agent Preset ID')
    if (typeof input.cwd !== 'string' || input.cwd.trim() === '') {
      throw new Error('Performance cwd must be non-empty')
    }
    const contributions = await this.resolveContributions(presetId, input.director !== undefined)
    const director = this.resolveEffectiveDirector(presetId, contributions.director, input)
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
      this.ensureSessionTitle(session, contributions.title)
      const titles = new Map(contributions.characters.map(character => [character.id, character.title]))
      const runtime = this.runtime(scope, session, configured, titles, director)
      this.registerScopeCleanup(runtime)
      await this.openConfiguredStages(runtime)
      await this.createCharacters(runtime)
      await Promise.all([
        ...[...runtime.characters.values()].map(agent => scope.ctx.sessions.flush(agent.session)),
        scope.ctx.sessions.flush(session),
      ])
      session.append('theater/configured', configured)
      await scope.ctx.sessions.flush(session)
      this.live.set(performanceId, runtime)
      this.startMainLoop(runtime)
      return this.read(performanceId)
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
      const compatibility = await this.checkRuntimeCompatibility(durable, input)
      const runtime = this.runtime(
        scope,
        session,
        durable,
        compatibility.characterTitles,
        compatibility.director,
      )
      this.registerScopeCleanup(runtime)
      await this.openCompatibleStages(runtime)
      this.live.set(performanceId, runtime)
      if (compatibility.error !== undefined || compatibility.director === undefined) {
        runtime.phase = 'incompatible'
        runtime.error = compatibility.error ?? new Error('current Theater contributions are incompatible')
        return this.read(performanceId)
      }
      await this.resumeCharacters(runtime)
      this.ensureSessionTitle(session, compatibility.title)
      await Promise.all([
        ...[...runtime.characters.values()].map(agent => scope.ctx.sessions.flush(agent.session)),
        scope.ctx.sessions.flush(session),
      ])
      if (analysis.stack.length > 0) {
        runtime.phase = 'failed'
        runtime.error = new Error(
          `Performance stopped with an unclosed Character Segment (${JSON.stringify(analysis.stack.at(-1))}); fork from the last Director Point to recover`,
        )
        return this.read(performanceId)
      }
      if (analysis.latestTopLevelTurn !== undefined && analysis.latestTopLevelTurn.outcome !== 'completed') {
        runtime.phase = 'failed'
        runtime.error = new Error(
          analysis.latestTopLevelTurn.error?.message
            ?? `Character ${JSON.stringify(analysis.latestTopLevelTurn.characterId)} Turn ended with ${analysis.latestTopLevelTurn.outcome}; fork from the last Director Point to recover`,
        )
        return this.read(performanceId)
      }
      this.startMainLoop(runtime)
      return this.read(performanceId)
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
    const compatibility = await this.checkRuntimeCompatibility(selected.configured, input)
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
      const runtime = this.runtime(
        scope,
        session,
        selected.configured,
        compatibility.characterTitles,
        compatibility.director,
      )
      this.registerScopeCleanup(runtime)
      await this.openConfiguredStages(runtime)
      await this.createCharacters(runtime, seeds)
      await Promise.all([
        ...[...runtime.characters.values()].map(agent => scope.ctx.sessions.flush(agent.session)),
        scope.ctx.sessions.flush(session),
      ])
      this.live.set(childId, runtime)
      this.startMainLoop(runtime)
      return this.read(childId)
    } catch (error) {
      this.live.delete(childId)
      await scope.dispose()
      throw error
    }
  }

  /** Wait until the Theater Main Loop finishes (`activity === 'idle'`). */
  async whenIdle(performanceId: SessionIdType): Promise<void> {
    const runtime = this.requireRuntime(performanceId)
    while (true) {
      const mainLoop = runtime.mainLoop
      await mainLoop
      if (mainLoop === runtime.mainLoop && runtime.activity === 'idle') break
    }
    if (runtime.phase === 'failed' || runtime.phase === 'incompatible') {
      throw runtime.error ?? new Error(`Performance ${JSON.stringify(performanceId)} cannot advance`)
    }
  }

  /** Wait until the Performance is settled at a Director Point (`awaiting-director` or `idle`). */
  async whenAtDirectorPoint(performanceId: SessionIdType): Promise<PerformanceRead> {
    const runtime = this.requireRuntime(performanceId)
    while (runtime.activity === 'executing-turn') {
      await new Promise<void>((resolve) => {
        runtime.activityWaiters.add(resolve)
      })
    }
    if (runtime.phase === 'failed' || runtime.phase === 'incompatible') {
      throw runtime.error ?? new Error(`Performance ${JSON.stringify(performanceId)} cannot advance`)
    }
    return this.read(performanceId)
  }

  /**
   * Cancel the active Main Loop for `performanceId` and wait for it to stop.
   * Stopping while `awaiting-director` leaves `phase: 'active'` and
   * `activity: 'idle'`; stopping while `executing-turn` aborts the active Turn
   * and settles into `phase: 'failed'` per ADR-0007.
   */
  async stop(performanceId: SessionIdType): Promise<PerformanceRead> {
    const runtime = this.requireRuntime(performanceId)
    if (runtime.activity === 'idle') return this.read(performanceId)
    runtime.stopping = true
    runtime.loopAbort?.abort()
    for (let index = runtime.activeTurns.length - 1; index >= 0; index -= 1) {
      runtime.activeTurns[index]!.agent.cancel({ kind: 'parent' })
    }
    while (true) {
      const mainLoop = runtime.mainLoop
      await mainLoop
      if (mainLoop === runtime.mainLoop && (runtime.activity as PerformanceActivity) === 'idle') break
    }
    return this.read(performanceId)
  }

  read(performanceId: SessionIdType): PerformanceRead {
    const runtime = this.requireRuntime(performanceId)
    const cwd = runtime.session.header.cwd
    if (cwd === undefined) throw new Error('Performance Session header has no cwd')
    const analysis = analyze(runtime.session.snapshotEvents())
    const characters = Object.fromEntries(runtime.configured.characters.map(character => [
      character.id,
      characterSessionId(runtime.session.id, character.id),
    ])) as Record<string, SessionIdType>
    const stagesService = this.stageService()
    const stages = Object.fromEntries(runtime.configured.stages.map((configuration) => {
      if (stagesService === undefined || !runtime.liveStages.has(configuration.stageId)) {
        return [configuration.stageId, { configuration }]
      }
      return [configuration.stageId, {
        configuration,
        state: stagesService.read(runtime.session, configuration.stageId),
        completed: stagesService.completed(runtime.session, configuration.stageId),
      }]
    }))
    return {
      performanceId: runtime.session.id,
      presetId: runtime.configured.presetId,
      cwd,
      phase: runtime.phase,
      activity: runtime.activity,
      ...runtime.error === undefined ? {} : { error: runtime.error.message },
      characters,
      stages,
      forkablePositions: analysis.forkablePositions,
      lineage: {
        ...runtime.session.header.parentSession === undefined ? {} : { parentSession: runtime.session.header.parentSession },
        ...runtime.session.header.isSeeded ? { seedLength: runtime.session.inheritedEventCount } : {},
      },
    }
  }

  private stageService(): StageService | undefined {
    return this.owner.get('stages' as never) as StageService | undefined
  }

  private runtime(
    scope: Scope,
    session: Session,
    configured: TheaterConfigured,
    characterTitles: ReadonlyMap<string, string>,
    director?: Director,
  ): PerformanceRuntime {
    return {
      scope,
      session,
      configured,
      characterTitles,
      characters: new Map(),
      liveStages: new Set(),
      activeTurns: [],
      activityWaiters: new Set(),
      ...director === undefined ? {} : { director },
      phase: 'active',
      activity: 'idle',
      stopping: false,
      loopAbort: undefined,
      mainLoop: Promise.resolve(),
    }
  }

  private registerScopeCleanup(runtime: PerformanceRuntime): void {
    runtime.scope.ctx.effect(() => () => {
      runtime.stopping = true
      runtime.loopAbort?.abort()
      for (let index = runtime.activeTurns.length - 1; index >= 0; index -= 1) {
        runtime.activeTurns[index]!.agent.cancel({ kind: 'parent' })
      }
      this.live.delete(runtime.session.id)
    }, `theater.cleanup(${runtime.session.id})`)
  }

  private setActivity(runtime: PerformanceRuntime, activity: PerformanceActivity): void {
    runtime.activity = activity
    for (const notify of runtime.activityWaiters) notify()
    runtime.activityWaiters.clear()
  }

  private startMainLoop(runtime: PerformanceRuntime): void {
    if (runtime.phase !== 'active') return
    if (runtime.activity !== 'idle') throw new Error('Performance Main Loop is already running')
    const director = runtime.director
    if (director === undefined) throw new Error('cannot drive Performance without a Theater Director')
    const abort = new AbortController()
    runtime.loopAbort = abort
    runtime.stopping = false
    this.setActivity(runtime, 'awaiting-director')
    runtime.mainLoop = (async () => {
      try {
        const directorContext = {
          signal: abort.signal,
          readStage: (stageId: string) => this.readStageFor(runtime, stageId),
          readSettledTurns: () => this.readSettledTurns(runtime),
        }
        while (true) {
          this.setActivity(runtime, 'awaiting-director')
          if (abort.signal.aborted) return
          const decision = await director(directorContext)
          if (abort.signal.aborted) return
          switch (decision.kind) {
            case 'act':
              this.setActivity(runtime, 'executing-turn')
              await this.act(runtime, decision.characterId, decision.instruction)
              continue
            case 'complete':
              runtime.phase = 'completed'
              return
            default:
              throw new Error(`Director returned an unknown decision: ${JSON.stringify(decision)}`)
          }
        }
      } catch (error) {
        if (runtime.stopping && abort.signal.aborted && runtime.activity === 'awaiting-director') {
          return
        }
        runtime.phase = 'failed'
        runtime.error = error instanceof Error ? error : new Error(String(error))
      } finally {
        if (runtime.loopAbort === abort) runtime.loopAbort = undefined
        abort.abort()
        this.setActivity(runtime, 'idle')
      }
    })()
  }

  private async act(
    runtime: PerformanceRuntime,
    characterId: string,
    instruction: readonly ContentBlock[],
  ): Promise<void> {
    const open = analyze(runtime.session.snapshotEvents())
    if (open.stack.length !== 0) throw new Error('cannot start a Character Segment while another Segment is open')
    const { read, error } = await this.runTurn(runtime, characterId, instruction)
    if (read.outcome !== 'completed') {
      throw Object.assign(
        new Error(error?.message ?? `Character ${JSON.stringify(characterId)} failed`),
        { code: error?.code ?? 'CHARACTER_FAILED' },
      )
    }
  }

  private async runTurn(
    runtime: PerformanceRuntime,
    characterId: string,
    instruction: readonly ContentBlock[],
  ): Promise<TurnExecution> {
    const character = this.requireCharacter(runtime, characterId)
    if (character.status !== 'idle') throw new Error(`Character ${JSON.stringify(characterId)} is already active`)
    const before = character.session.seq
    runtime.session.append('theater/segment-started', { characterId })
    await runtime.scope.ctx.sessions.flush(runtime.session)
    const frame: ActiveTurnFrame = { characterId, agent: character }
    runtime.activeTurns.push(frame)
    let ended: Pick<TheaterSegmentEnded, 'outcome' | 'error'>
    let actionError: Error | undefined
    try {
      character.followup(createUserMessage({
        content: [...instruction],
        source: { kind: 'theater', form: 'instructions' },
      }))
      await character.whenIdle()
      const turnEnd = character.session.snapshotEvents().slice(before).reverse()
        .find((event): event is SessionEvent<'turn/end'> => event.type === 'turn/end')
      if (turnEnd === undefined) throw new Error(`Character ${JSON.stringify(characterId)} produced no completed turn`)
      ended = settlement(turnEnd.data.reason, frame.abortReason)
      if (ended.outcome !== 'completed') {
        actionError = new Error(ended.error?.message ?? `Character ${JSON.stringify(characterId)} failed`)
      }
    } catch (error) {
      const detail = failure(error)
      ended = { outcome: 'error', error: detail }
      actionError = error instanceof Error ? error : new Error(detail.message)
    } finally {
      const popped = runtime.activeTurns.pop()
      if (popped !== frame) {
        const index = runtime.activeTurns.lastIndexOf(frame)
        if (index >= 0) runtime.activeTurns.splice(index, 1)
      }
    }
    await runtime.scope.ctx.sessions.flush(character.session)
    await runtime.scope.ctx.sessions.flush(runtime.session)
    const characterSessionSeq = character.session.seq
    const top = analyze(runtime.session.snapshotEvents()).stack.at(-1)
    if (top !== characterId) throw new Error(`Character Segment end for ${JSON.stringify(characterId)} violates LIFO order`)
    runtime.session.append('theater/segment-ended', {
      characterId,
      characterSessionSeq,
      ...ended,
    })
    await runtime.scope.ctx.sessions.flush(runtime.session)
    const events = sliceSettledTurnEvents(character.session.snapshotEvents().slice(before, characterSessionSeq))
    if (actionError !== undefined && events.length === 0) throw actionError
    const read: CharacterTurnRead = {
      characterId,
      outcome: ended.outcome,
      ...extractTurnContent(events),
    }
    return ended.error === undefined ? { read } : { read, error: ended.error }
  }

  private readSettledTurns(runtime: PerformanceRuntime): readonly CharacterTurnRead[] {
    const reads: CharacterTurnRead[] = []
    const stack: string[] = []
    const watermarks = new Map<string, number>()
    for (const event of runtime.session.snapshotEvents()) {
      if (event.type === 'theater/segment-started') {
        stack.push(event.data.characterId)
        continue
      }
      if (event.type !== 'theater/segment-ended') continue
      const characterId = stack.pop()
      if (characterId !== event.data.characterId) {
        throw new Error(`Character Segment end for ${JSON.stringify(event.data.characterId)} violates LIFO order`)
      }
      const session = this.requireCharacter(runtime, characterId).session
      const before = watermarks.get(characterId) ?? 0
      const after = event.data.characterSessionSeq
      const events = sliceSettledTurnEvents(session.snapshotEvents().slice(before, after))
      watermarks.set(characterId, after)
      if (stack.length === 0) {
        reads.push({
          characterId,
          outcome: event.data.outcome,
          ...extractTurnContent(events),
        })
      }
    }
    return reads
  }

  private readActiveTurn(runtime: PerformanceRuntime, characterId: string): ActiveCharacterTurnRead {
    const character = this.requireCharacter(runtime, characterId)
    const events = sliceActiveTurnEvents(character.session.snapshotEvents())
    return {
      characterId,
      ...extractTurnContent(events),
    }
  }

  private resolveEffectiveDirector(
    presetId: string,
    presetDirector: Director | undefined,
    options: DirectorOverrideOptions,
  ): Director {
    const base = options.director ?? presetDirector
    if (base === undefined) {
      throw new Error(`Agent Preset ${JSON.stringify(presetId)} must contribute exactly one Theater Director; found 0`)
    }
    return options.wrapDirector === undefined ? base : options.wrapDirector(base)
  }

  private async resolveContributions(
    presetId: string,
    allowMissingDirector = false,
  ): Promise<TheaterContributions> {
    const lease = await this.owner.agentPresets.acquireScope(presetId)
    try {
      const key: ScopeKey = lease.key
      const layer = this.layers.peek(key)
      const titles = layer === undefined ? [] : [...layer.titles.values()]
      if (titles.length > 1) {
        throw new Error(`Agent Preset ${JSON.stringify(presetId)} must contribute at most one Theater title; found ${titles.length}`)
      }
      const directors = layer === undefined ? [] : [...layer.directors.values()]
      if (directors.length > 1 || (!allowMissingDirector && directors.length !== 1)) {
        throw new Error(`Agent Preset ${JSON.stringify(presetId)} must contribute exactly one Theater Director; found ${directors.length}`)
      }
      const registeredCharacters = layer === undefined ? [] : [...layer.characters.values()]
      const characters = registeredCharacters.map((character) => ({
        id: character.id,
        title: nonEmpty(character.title ?? character.id, `Title for Character ${JSON.stringify(character.id)}`),
        ...character.model === undefined ? {} : { model: character.model },
        systemPrompt: character.systemPrompt,
        tools: character.tools.map((declaration) => {
          const kind = nonEmpty(declaration.factory, `Tool factory for Character ${JSON.stringify(character.id)}`)
          const factory = this.toolFactories.get(kind)
          if (factory === undefined) {
            throw new Error(`no Theater Tool factory registered for kind ${JSON.stringify(kind)}`)
          }
          const config = snapshotJsonValue(factory.resolveConfig(declaration.params ?? {}))
          if (config === undefined) {
            throw new Error(`Theater Tool factory ${JSON.stringify(kind)} returned non-JSON configuration`)
          }
          return { factory, config }
        }),
      }))
      const stagesService = this.stageService()
      const stages = stagesService === undefined
        ? []
        : [...stagesService.resolveDeclarations(key)].map(([stageId, declaration]) => ({
            stageId,
            ...declaration,
          }))
      return {
        title: nonEmpty(titles[0] ?? presetId, 'Performance title'),
        characters,
        stages,
        ...directors[0] === undefined ? {} : { director: directors[0] },
      }
    } finally {
      await lease[Symbol.asyncDispose]()
    }
  }

  private async resolvePresetStructure(
    presetId: string,
    allowMissingDirector: boolean,
  ): Promise<PresetStructure> {
    const lease = await this.owner.agentPresets.acquireScope(presetId)
    try {
      const key: ScopeKey = lease.key
      const layer = this.layers.peek(key)
      const titles = layer === undefined ? [] : [...layer.titles.values()]
      if (titles.length > 1) {
        throw new Error(`Agent Preset ${JSON.stringify(presetId)} must contribute at most one Theater title; found ${titles.length}`)
      }
      const directors = layer === undefined ? [] : [...layer.directors.values()]
      if (directors.length > 1 || (!allowMissingDirector && directors.length !== 1)) {
        throw new Error(`Agent Preset ${JSON.stringify(presetId)} must contribute exactly one Theater Director; found ${directors.length}`)
      }
      const registeredCharacters = layer === undefined ? [] : [...layer.characters.values()]
      const characterTitles = new Map<string, string>()
      const characterIds: string[] = []
      for (const character of registeredCharacters) {
        const id = nonEmpty(character.id, 'Character ID')
        if (characterTitles.has(id)) throw new Error(`duplicate Character ID ${JSON.stringify(id)}`)
        characterIds.push(id)
        characterTitles.set(id, nonEmpty(character.title ?? id, `Title for Character ${JSON.stringify(id)}`))
      }
      const stagesService = this.stageService()
      const stages = stagesService === undefined
        ? []
        : [...stagesService.resolveDeclarations(key)].map(([stageId, declaration]) => ({
            stageId,
            machine: declaration.factory.kind,
            version: declaration.factory.version,
          }))
      return {
        title: nonEmpty(titles[0] ?? presetId, 'Performance title'),
        characterTitles,
        characterIds,
        stages,
        ...directors[0] === undefined ? {} : { director: directors[0] },
      }
    } finally {
      await lease[Symbol.asyncDispose]()
    }
  }

  private async checkRuntimeCompatibility(
    durable: TheaterConfigured,
    options: DirectorOverrideOptions,
  ): Promise<{
    readonly title: string
    readonly characterTitles: ReadonlyMap<string, string>
    readonly director?: Director
    readonly error?: Error
  }> {
    let title = durable.presetId
    let characterTitles: ReadonlyMap<string, string> = new Map(
      durable.characters.map(character => [character.id, character.id]),
    )
    const stagesService = this.stageService()
    if (durable.stages.length > 0 && stagesService === undefined) {
      return {
        title,
        characterTitles,
        error: new Error('Stage service (@darwintree/dsh-stage) is required for durable Stages'),
      }
    }
    for (const durableStage of durable.stages) {
      const factory = stagesService!.getFactory(durableStage.machine)
      if (factory === undefined) {
        return {
          title,
          characterTitles,
          error: new Error(`incompatible State Machine factory: missing ${JSON.stringify(durableStage.machine)}`),
        }
      }
      if (factory.version !== durableStage.version) {
        return {
          title,
          characterTitles,
          error: new Error(`incompatible Stage ${JSON.stringify(durableStage.stageId)} version`),
        }
      }
    }
    for (const character of durable.characters) {
      for (const tool of character.tools) {
        if (!this.toolFactories.has(tool.factory)) {
          return {
            title,
            characterTitles,
            error: new Error(`incompatible Theater Tool factory: missing ${JSON.stringify(tool.factory)}`),
          }
        }
      }
    }

    let presetDirector: Director | undefined
    try {
      const structure = await this.resolvePresetStructure(durable.presetId, options.director !== undefined)
      title = structure.title
      characterTitles = structure.characterTitles
      presetDirector = structure.director
      const mismatch = structuralIncompatibility(structure, durable)
      if (mismatch !== undefined) {
        return { title, characterTitles, error: new Error(mismatch) }
      }
    } catch (error) {
      if (options.director === undefined) {
        return {
          title,
          characterTitles,
          error: new Error(`current Theater contributions are unavailable: ${failure(error).message}`),
        }
      }
    }

    try {
      const director = this.resolveEffectiveDirector(durable.presetId, presetDirector, options)
      return { title, characterTitles, director }
    } catch (error) {
      return {
        title,
        characterTitles,
        error: error instanceof Error ? error : new Error(String(error)),
      }
    }
  }

  private async openConfiguredStages(runtime: PerformanceRuntime): Promise<void> {
    if (runtime.configured.stages.length === 0) return
    const stagesService = this.stageService()
    if (stagesService === undefined) {
      throw new Error('Stage service (@darwintree/dsh-stage) is required for Performances that declare Stages')
    }
    for (const stage of runtime.configured.stages) {
      const factory = stagesService.getFactory(stage.machine)
      if (factory === undefined || factory.version !== stage.version) {
        throw new Error(`State Machine factory ${JSON.stringify(stage.machine)}@${stage.version} is unavailable`)
      }
      await stagesService.ensure(runtime.session, stage.stageId, {
        factory,
        config: stage.config,
      })
      runtime.liveStages.add(stage.stageId)
    }
  }

  private async openCompatibleStages(runtime: PerformanceRuntime): Promise<void> {
    if (runtime.configured.stages.length === 0) return
    const stagesService = this.stageService()
    if (stagesService === undefined) return
    for (const durable of runtime.configured.stages) {
      const factory = stagesService.getFactory(durable.machine)
      if (factory === undefined || factory.version !== durable.version) continue
      await stagesService.ensure(runtime.session, durable.stageId, { factory })
      runtime.liveStages.add(durable.stageId)
    }
  }

  private readStageFor(runtime: PerformanceRuntime, stageId: string): JsonValue {
    const stagesService = this.stageService()
    if (stagesService === undefined || !runtime.liveStages.has(stageId)) {
      throw new Error(`Stage ${JSON.stringify(stageId)} is not declared by this Performance`)
    }
    return stagesService.read(runtime.session, stageId)
  }

  private async createCharacters(
    runtime: PerformanceRuntime,
    seeds: readonly {
      character: TheaterConfiguredCharacter
      parent: Session
      watermark: number
      seed: readonly SessionEvent[]
    }[] = [],
  ): Promise<void> {
    const cwd = runtime.session.header.cwd
    if (cwd === undefined) throw new Error('Performance Session header has no cwd')
    const byId = new Map(seeds.map(seed => [seed.character.id, seed]))
    for (const character of runtime.configured.characters) {
      const seed = byId.get(character.id)
      const handle = await runtime.scope.ctx.agents.create({
        sessionId: characterSessionId(runtime.session.id, character.id),
        ...seed === undefined ? {} : {
          seed: seed.seed,
          inheritedEventCount: SessionLogOffset(seed.watermark),
        },
        meta: {
          cwd,
          ...seed === undefined ? {} : {
            parentSession: seed.parent.id,
            isSeeded: true,
          },
        },
        agentOptions: character.model ?? runtime.scope.ctx.agentDefaultModel.currentSelection(),
        setup: agentCtx => this.setupCharacter(runtime, character, agentCtx),
      })
      const title = runtime.characterTitles.get(character.id) ?? character.id
      this.ensureSessionTitle(handle.agent.session, title)
      this.ensureCharacterMarker(handle.agent.session, character.id)
      runtime.characters.set(character.id, handle.agent)
    }
  }

  private async resumeCharacters(runtime: PerformanceRuntime): Promise<void> {
    for (const character of runtime.configured.characters) {
      const handle = await runtime.scope.ctx.agents.resume({
        resumeSessionId: characterSessionId(runtime.session.id, character.id),
        agentOptions: character.model ?? runtime.scope.ctx.agentDefaultModel.currentSelection(),
        setup: agentCtx => this.setupCharacter(runtime, character, agentCtx),
      })
      const marker = handle.agent.session.snapshotEvents().find(event => event.type === 'theater/character-configured')
      if (marker?.type !== 'theater/character-configured' || marker.data.characterId !== character.id) {
        await handle.dispose()
        throw new Error(`Character ${JSON.stringify(character.id)} is missing its durable Theater configuration`)
      }
      const title = runtime.characterTitles.get(character.id) ?? character.id
      this.ensureSessionTitle(handle.agent.session, title)
      runtime.characters.set(character.id, handle.agent)
    }
  }

  private ensureSessionTitle(session: Session, title: string): void {
    if (session.snapshotEvents().some(event => event.type === 'session/title')) return
    session.append('session/title', {
      title,
      messageSeqs: [],
      source: { kind: 'user' },
    })
  }

  private setupCharacter(
    runtime: PerformanceRuntime,
    character: TheaterConfiguredCharacter,
    agentCtx: Context,
  ): void {
    const characterId = character.id
    const instructionsModule = AgentInstructions as {
      suppressAgentInstructions?: (ctx: Context) => void
    }
    if (typeof instructionsModule.suppressAgentInstructions === 'function') {
      instructionsModule.suppressAgentInstructions(agentCtx)
    } else {
      agentCtx.on('agent/pre-step', async ({ agent }, next) => {
        const decision = await next()
        for (const message of agent.inbox.nextStep) {
          if (message.source.kind === 'agent-instructions') agent.inbox.remove(message.id)
        }
        if (decision.kind === 'reject') return decision
        const filtered = decision.messages.filter(message => message.source.kind !== 'agent-instructions')
        return filtered.length === decision.messages.length ? decision : { ...decision, messages: filtered }
      }, { prepend: true })
    }
    agentCtx.systemPrompt.suppressRuntimeContext()
    agentCtx.systemPrompt.section({
      name: PERSONA_PREFIX_SECTION,
      order: agentCtx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX'),
      text: character.systemPrompt,
      complete: true,
    })
    const declaredStages = new Set(runtime.configured.stages.map(stage => stage.stageId))
    const resolveStage = (stageId: string) => {
      if (!declaredStages.has(stageId)) {
        throw new Error(`Stage ${JSON.stringify(stageId)} is not declared by this Performance preset`)
      }
      const stagesService = this.stageService()
      if (stagesService === undefined) {
        throw new Error('Stage service (@darwintree/dsh-stage) is not available')
      }
      return {
        read: () => stagesService.read(runtime.session, stageId),
        interact: (op: unknown) => stagesService.interact(runtime.session, stageId, op),
      }
    }
    const requireActiveFrame = (): ActiveTurnFrame => {
      const top = runtime.activeTurns.at(-1)
      if (top?.characterId !== characterId) {
        throw new Error(`Character ${JSON.stringify(characterId)} has no active Segment`)
      }
      return top
    }
    const currentTurnKind = (): 'top-level' | 'nested' => {
      requireActiveFrame()
      return runtime.activeTurns.length === 1 ? 'top-level' : 'nested'
    }
    agentCtx.tools.restrict({ allow: [] })
    const toolContext: TheaterToolContext = {
      characterId,
      characterIds: runtime.configured.characters.map(item => item.id),
      stage: resolveStage,
      currentTurnKind,
      readCurrentTurn: () => {
        requireActiveFrame()
        return this.readActiveTurn(runtime, characterId)
      },
      readSettledTurns: () => this.readSettledTurns(runtime),
      runNestedTurn: async (targetId, instruction) => {
        requireActiveFrame()
        return (await this.runTurn(runtime, targetId, instruction)).read
      },
      abortTurn: (reason?: string): never => {
        const frame = requireActiveFrame()
        const message = reason ?? 'Character action aborted'
        frame.abortReason = message
        frame.agent.cancel({ kind: 'parent' })
        throw new Error(message)
      },
    }
    for (const tool of character.tools) {
      const factory = this.toolFactories.get(tool.factory)
      if (factory === undefined) {
        throw new Error(`no Theater Tool factory registered for kind ${JSON.stringify(tool.factory)}`)
      }
      agentCtx.tools.register(factory.create(tool.config, toolContext))
    }
  }

  private ensureCharacterMarker(session: Session, characterId: string): void {
    const marker = session.snapshotEvents().find(event => event.type === 'theater/character-configured')
    if (marker === undefined) {
      session.append('theater/character-configured', { characterId })
      return
    }
    if (marker.data.characterId !== characterId) {
      throw new Error(`Character ${JSON.stringify(characterId)} seed has incompatible Theater configuration`)
    }
  }

  private requireCharacter(runtime: PerformanceRuntime, characterId: string): Agent {
    const character = runtime.characters.get(characterId)
    if (character === undefined) throw new Error(`unknown Character ${JSON.stringify(characterId)}`)
    return character
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
