/// <reference types="node" />

import { Service, type Context } from '@deepseek-ai/cordis'
import type { Agent, ModelSelection } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { suppressAgentInstructions } from '@deepseek-ai/dsh-agent-instructions'
import type {} from '@deepseek-ai/dsh-agent-presets'
import { createUserMessage, type ContentBlock } from '@deepseek-ai/dsh-llm'
import {
  SessionId,
  snapshotJsonValue,
  type JsonValue,
  type Session,
  type SessionEvent,
  type SessionId as SessionIdType,
} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-session-title'
import { PERSONA_ORDER, PERSONA_SECTION } from '@deepseek-ai/dsh-system-prompt'
import {
  AnonymousEntries,
  ScopedLayers,
  createScope,
  scopeOf,
  type Scope,
  type ScopeKey,
  type ScopeLayer,
} from '@deepseek-ai/dsh-scope'
import type { StateMachineFactory } from '@darwintree/dsh-stage'
import {
  characterSessionId,
  compatible,
  failure,
  nonEmpty,
  resolvedConfiguration,
} from './configuration.js'
import { analyze, registerTheaterSessionEventTypes, settlement } from './events.js'
import type {
  CharacterTurnRead,
  CreatePerformanceInput,
  Director,
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
  readonly autoAdvance: AnonymousEntries<boolean>
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
  readonly autoAdvance: boolean
  readonly characters: readonly ResolvedCharacter[]
  readonly stages: readonly {
    readonly stageId: string
    readonly factory: StateMachineFactory
    readonly config: JsonValue
  }[]
  readonly director: Director
}

interface PerformanceRuntime {
  readonly scope: Scope
  readonly session: Session
  readonly configured: TheaterConfigured
  readonly contributions?: TheaterContributions
  readonly characters: Map<string, Agent>
  readonly liveStages: Set<string>
  phase: PerformancePhase
  activity: PerformanceActivity
  autoAdvance: boolean
  error?: Error
  mainLoop: Promise<void>
}

interface TurnExecution {
  readonly read: CharacterTurnRead
  readonly error?: TheaterSegmentEnded['error']
}

/** `ctx.theater`: preset-composed Performance creation, driving, reading, resume, and fork. */
export class TheaterService extends Service {
  static inject = ['sessions', 'agents', 'agentPresets', 'agentDefaultModel', 'systemPrompt', 'stages', 'tools']

  private readonly layers = new ScopedLayers<ContributionLayer>(
    () => ({
      titles: new AnonymousEntries<string>(),
      autoAdvance: new AnonymousEntries<boolean>(),
      characters: new AnonymousEntries<TheaterCharacterContribution>(),
      directors: new AnonymousEntries<Director>(),
      isEmpty() {
        return this.titles.isEmpty() && this.autoAdvance.isEmpty()
          && this.characters.isEmpty() && this.directors.isEmpty()
      },
    }),
    () => undefined,
  )
  private readonly toolFactories = new Map<string, TheaterToolFactory>()
  private readonly live = new Map<SessionIdType, PerformanceRuntime>()

  constructor(ctx: Context) {
    super(ctx, 'theater')
    ctx.effect(registerTheaterSessionEventTypes, 'theater.sessionEventTypes()')
  }

  registerCharacter(character: TheaterCharacterContribution): () => void {
    return this.registerContribution(character, layer => layer.characters, 'registerCharacter')
  }

  registerTitle(title: string): () => void {
    return this.registerContribution(nonEmpty(title, 'Performance title'), layer => layer.titles, 'registerTitle')
  }

  registerAutoAdvance(autoAdvance: boolean): () => void {
    if (typeof autoAdvance !== 'boolean') throw new Error('theater.registerAutoAdvance() requires a boolean')
    return this.registerContribution(autoAdvance, layer => layer.autoAdvance, 'registerAutoAdvance')
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
    const contributions = await this.resolveContributions(presetId)
    const configured = resolvedConfiguration(presetId, contributions)
    const scope = createScope(this.ctx, { performanceId })
    try {
      const session = scope.ctx.sessions.create(performanceId, { meta: { cwd: input.cwd } })
      this.ensureSessionTitle(session, contributions.title)
      const runtime = this.runtime(scope, session, configured, contributions)
      await this.openStages(runtime)
      await this.createCharacters(runtime)
      await Promise.all([
        ...[...runtime.characters.values()].map(agent => scope.ctx.sessions.flush(agent.session)),
        scope.ctx.sessions.flush(session),
      ])
      session.append('theater/configured', configured)
      await scope.ctx.sessions.flush(session)
      this.live.set(performanceId, runtime)
      this.startMainLoop(runtime)
      if (!runtime.autoAdvance) await runtime.mainLoop
      return this.read(performanceId)
    } catch (error) {
      this.live.delete(performanceId)
      await scope.dispose()
      throw error
    }
  }

  async resume(input: ResumePerformanceInput): Promise<PerformanceRead> {
    const performanceId = SessionId(nonEmpty(String(input.performanceId), 'Performance Session ID'))
    this.assertAvailable(performanceId)
    const persistence = this.ctx.get('sessionPersistence')
    if (persistence === undefined) throw new Error('cannot resume Performance: session persistence is not configured')
    const scope = createScope(this.ctx, { performanceId })
    const preparation = await persistence.prepare(performanceId)
    try {
      const session = preparation.session
      if (session.header.cwd === undefined) {
        throw new Error('cannot resume Performance: Session header has no cwd')
      }
      scope.ctx.effect(function* () {
        yield scope.ctx.sessions.enter(session)
        scope.ctx.sessions.announce(session)
      }, `theater.performance(${performanceId})`)
      const durable = analyze(session.events).configured
      let contributions: TheaterContributions | undefined
      let current: TheaterConfigured | undefined
      let incompatibility: Error | undefined
      try {
        contributions = await this.resolveContributions(durable.presetId)
        current = resolvedConfiguration(durable.presetId, contributions)
        if (!compatible(current, durable)) {
          incompatibility = new Error('current Theater contributions are incompatible with durable Performance configuration')
        }
      } catch (error) {
        incompatibility = new Error(`current Theater contributions are unavailable: ${failure(error).message}`)
      }
      const runtime = this.runtime(scope, session, durable, contributions)
      if (contributions !== undefined) await this.openCompatibleStages(runtime)
      this.live.set(performanceId, runtime)
      if (incompatibility !== undefined || contributions === undefined || current === undefined) {
        runtime.phase = 'incompatible'
        runtime.error = incompatibility ?? new Error('current Theater contributions are incompatible')
        return this.read(performanceId)
      }
      await this.resumeCharacters(runtime)
      this.ensureSessionTitle(session, contributions.title)
      await Promise.all([
        ...[...runtime.characters.values()].map(agent => scope.ctx.sessions.flush(agent.session)),
        scope.ctx.sessions.flush(session),
      ])
      this.startMainLoop(runtime)
      if (!runtime.autoAdvance) await runtime.mainLoop
      return this.read(performanceId)
    } catch (error) {
      this.live.delete(performanceId)
      await scope.dispose()
      throw error
    } finally {
      preparation[Symbol.dispose]()
    }
  }

  async fork(input: ForkPerformanceInput): Promise<PerformanceRead> {
    const sourceId = SessionId(nonEmpty(String(input.sourcePerformanceId), 'Source Performance Session ID'))
    const childId = SessionId(nonEmpty(String(input.childPerformanceId), 'Child Performance Session ID'))
    this.assertAvailable(childId)
    const source = this.requireRuntime(sourceId)
    if (source.phase === 'incompatible') throw source.error
    if (!Number.isSafeInteger(input.cursor) || input.cursor < 1 || input.cursor > source.session.events.length) {
      throw new Error(`Performance fork cursor must be an exclusive sequence between 1 and ${source.session.events.length}`)
    }
    const prefix = source.session.events.slice(0, input.cursor)
    const selected = analyze(prefix)
    if (selected.stack.length !== 0) throw new Error(`Performance fork cursor ${input.cursor} is not a Director Point`)
    const contributions = await this.resolveContributions(selected.configured.presetId)
    const current = resolvedConfiguration(selected.configured.presetId, contributions)
    if (!compatible(current, selected.configured)) {
      throw new Error('current Theater contributions are incompatible with durable Performance configuration')
    }
    const seeds = selected.configured.characters.map((character) => {
      const parentId = characterSessionId(sourceId, character.id)
      const parent = this.ctx.sessions.get(parentId)
      if (parent === undefined) throw new Error(`source Character Session is not live: ${parentId}`)
      const watermark = selected.watermarks.get(character.id) ?? 0
      if (!Number.isSafeInteger(watermark) || watermark < 0 || watermark > parent.events.length) {
        throw new Error(`invalid Character Session watermark ${watermark} for ${JSON.stringify(character.id)}`)
      }
      return { character, parent, watermark, seed: parent.events.slice(0, watermark) }
    })
    const scope = createScope(this.ctx, { performanceId: childId })
    try {
      const session = scope.ctx.sessions.fork(source.session, input.cursor - 1, childId)
      const runtime = this.runtime(scope, session, selected.configured, contributions)
      await this.openStages(runtime)
      await this.createCharacters(runtime, seeds)
      await Promise.all([
        ...[...runtime.characters.values()].map(agent => scope.ctx.sessions.flush(agent.session)),
        scope.ctx.sessions.flush(session),
      ])
      this.live.set(childId, runtime)
      this.startMainLoop(runtime)
      if (!runtime.autoAdvance) await runtime.mainLoop
      return this.read(childId)
    } catch (error) {
      await scope.dispose()
      throw error
    }
  }

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

  async advance(performanceId: SessionIdType): Promise<PerformanceRead> {
    const runtime = this.requireActiveRuntime(performanceId)
    if (runtime.autoAdvance) throw new Error('cannot manually advance a Performance while autoAdvance is enabled')
    if (runtime.activity === 'running') throw new Error('cannot manually advance a running Performance')
    this.startMainLoop(runtime, true)
    await this.whenIdle(performanceId)
    return this.read(performanceId)
  }

  setAutoAdvance(performanceId: SessionIdType, autoAdvance: boolean): PerformanceRead {
    if (typeof autoAdvance !== 'boolean') throw new Error('Performance autoAdvance must be boolean')
    const runtime = this.requireActiveRuntime(performanceId)
    runtime.autoAdvance = autoAdvance
    if (autoAdvance && runtime.activity === 'idle') this.startMainLoop(runtime)
    return this.read(performanceId)
  }

  read(performanceId: SessionIdType): PerformanceRead {
    const runtime = this.requireRuntime(performanceId)
    const cwd = runtime.session.header.cwd
    if (cwd === undefined) throw new Error('Performance Session header has no cwd')
    const analysis = analyze(runtime.session.events)
    const characters = Object.fromEntries(runtime.configured.characters.map(character => [
      character.id,
      characterSessionId(runtime.session.id, character.id),
    ])) as Record<string, SessionIdType>
    const stages = Object.fromEntries(runtime.configured.stages.map((configuration) => {
      if (!runtime.liveStages.has(configuration.stageId)) return [configuration.stageId, { configuration }]
      return [configuration.stageId, {
        configuration,
        state: this.ctx.stages.read(runtime.session, configuration.stageId),
        completed: this.ctx.stages.completed(runtime.session, configuration.stageId),
      }]
    }))
    return {
      performanceId: runtime.session.id,
      presetId: runtime.configured.presetId,
      cwd,
      phase: runtime.phase,
      activity: runtime.activity,
      autoAdvance: runtime.autoAdvance,
      ...runtime.error === undefined ? {} : { error: runtime.error.message },
      characters,
      stages,
      forkablePositions: analysis.forkablePositions,
      lineage: {
        ...runtime.session.header.parentSession === undefined ? {} : { parentSession: runtime.session.header.parentSession },
        ...runtime.session.header.seedLength === undefined ? {} : { seedLength: runtime.session.header.seedLength },
      },
    }
  }

  private runtime(
    scope: Scope,
    session: Session,
    configured: TheaterConfigured,
    contributions?: TheaterContributions,
  ): PerformanceRuntime {
    return {
      scope,
      session,
      configured,
      ...contributions === undefined ? {} : { contributions },
      characters: new Map(),
      liveStages: new Set(),
      phase: 'active',
      activity: 'idle',
      autoAdvance: configured.autoAdvance,
      mainLoop: Promise.resolve(),
    }
  }

  private startMainLoop(runtime: PerformanceRuntime, advanceOnce = false): void {
    if (runtime.phase !== 'active') return
    if (runtime.activity !== 'idle') throw new Error('Performance Main Loop is already running')
    const contributions = runtime.contributions
    if (contributions === undefined) throw new Error('cannot drive Performance without Theater contributions')
    runtime.activity = 'running'
    runtime.mainLoop = (async () => {
      try {
        const directorContext = {
          readStage: (stageId: string) => this.ctx.stages.read(runtime.session, stageId),
          readSettledTurns: () => this.readSettledTurns(runtime),
        }
        while (true) {
          const decision = await contributions.director(directorContext)
          switch (decision.kind) {
            case 'act':
              if (!runtime.autoAdvance && !advanceOnce) return
              advanceOnce = false
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
        runtime.phase = 'failed'
        runtime.error = error instanceof Error ? error : new Error(String(error))
      } finally {
        runtime.activity = 'idle'
      }
    })()
  }

  private async act(
    runtime: PerformanceRuntime,
    characterId: string,
    instruction: readonly ContentBlock[],
  ): Promise<void> {
    const open = analyze(runtime.session.events)
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
    let ended: Pick<TheaterSegmentEnded, 'outcome' | 'error'>
    let actionError: Error | undefined
    try {
      character.followup(createUserMessage({
        content: [...instruction],
        source: { kind: 'plugin', plugin: '@darwintree/dsh-theater', form: 'instructions' },
      }))
      await character.whenIdle()
      const turnEnd = character.session.events.slice(before).reverse()
        .find((event): event is SessionEvent<'turn/end'> => event.type === 'turn/end')
      if (turnEnd === undefined) throw new Error(`Character ${JSON.stringify(characterId)} produced no completed turn`)
      ended = settlement(turnEnd.data.reason)
      if (ended.outcome !== 'completed') {
        actionError = new Error(ended.error?.message ?? `Character ${JSON.stringify(characterId)} failed`)
      }
    } catch (error) {
      const detail = failure(error)
      ended = { outcome: 'error', error: detail }
      actionError = error instanceof Error ? error : new Error(detail.message)
    }
    await runtime.scope.ctx.sessions.flush(character.session)
    await runtime.scope.ctx.sessions.flush(runtime.session)
    const characterSessionSeq = character.session.seq
    const top = analyze(runtime.session.events).stack.at(-1)
    if (top !== characterId) throw new Error(`Character Segment end for ${JSON.stringify(characterId)} violates LIFO order`)
    runtime.session.append('theater/segment-ended', {
      characterId,
      characterSessionSeq,
      ...ended,
    })
    await runtime.scope.ctx.sessions.flush(runtime.session)
    const events = this.turnEvents(character.session.events.slice(before, characterSessionSeq))
    if (actionError !== undefined && events.length === 0) throw actionError
    const read = { characterId, outcome: ended.outcome, events }
    return ended.error === undefined ? { read } : { read, error: ended.error }
  }

  private turnEvents(events: readonly SessionEvent[]): readonly SessionEvent[] {
    const start = events.findIndex(event => event.type === 'turn/start')
    return start < 0 ? [] : events.slice(start)
  }

  private readSettledTurns(runtime: PerformanceRuntime): readonly CharacterTurnRead[] {
    const reads: CharacterTurnRead[] = []
    const stack: string[] = []
    const watermarks = new Map<string, number>()
    for (const event of runtime.session.events) {
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
      const events = this.turnEvents(session.events.slice(before, after))
      watermarks.set(characterId, after)
      if (stack.length === 0) {
        reads.push({ characterId, outcome: event.data.outcome, events })
      }
    }
    return reads
  }

  private async resolveContributions(presetId: string): Promise<TheaterContributions> {
    const key: ScopeKey = await this.ctx.agentPresets.standingKeyFor(presetId)
    const layer = this.layers.peek(key)
    const titles = layer === undefined ? [] : [...layer.titles.values()]
    if (titles.length > 1) {
      throw new Error(`Agent Preset ${JSON.stringify(presetId)} must contribute at most one Theater title; found ${titles.length}`)
    }
    const autoAdvanceValues = layer === undefined ? [] : [...layer.autoAdvance.values()]
    if (autoAdvanceValues.length > 1) {
      throw new Error(`Agent Preset ${JSON.stringify(presetId)} must contribute at most one Theater autoAdvance value; found ${autoAdvanceValues.length}`)
    }
    const directors = layer === undefined ? [] : [...layer.directors.values()]
    if (directors.length !== 1) {
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
    const stages = [...this.ctx.stages.resolveDeclarations(key)].map(([stageId, declaration]) => ({
      stageId,
      ...declaration,
    }))
    return {
      title: nonEmpty(titles[0] ?? presetId, 'Performance title'),
      autoAdvance: autoAdvanceValues[0] ?? true,
      characters,
      stages,
      director: directors[0]!,
    }
  }

  private async openStages(runtime: PerformanceRuntime): Promise<void> {
    const contributions = runtime.contributions
    if (contributions === undefined) return
    for (const stage of contributions.stages) {
      await runtime.scope.ctx.stages.ensure(runtime.session, stage.stageId, {
        factory: stage.factory,
        config: stage.config,
      })
      runtime.liveStages.add(stage.stageId)
    }
  }

  private async openCompatibleStages(runtime: PerformanceRuntime): Promise<void> {
    const contributions = runtime.contributions
    if (contributions === undefined) return
    for (const durable of runtime.configured.stages) {
      const current = contributions.stages.find(stage =>
        stage.stageId === durable.stageId
        && stage.factory.kind === durable.machine
        && stage.factory.version === durable.version)
      if (current === undefined) continue
      await runtime.scope.ctx.stages.ensure(runtime.session, durable.stageId, { factory: current.factory })
      runtime.liveStages.add(durable.stageId)
    }
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
        ...seed === undefined ? {} : { seed: seed.seed },
        meta: {
          cwd,
          ...seed === undefined ? {} : {
            parentSession: seed.parent.id,
            seedLength: seed.watermark,
          },
        },
        agentOptions: character.model ?? runtime.scope.ctx.agentDefaultModel.currentSelection(),
        setup: agentCtx => this.setupCharacter(runtime, character.id, agentCtx),
      })
      const title = runtime.contributions?.characters.find(candidate => candidate.id === character.id)?.title
        ?? character.id
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
        setup: agentCtx => this.setupCharacter(runtime, character.id, agentCtx),
      })
      const marker = handle.agent.session.events.find(event => event.type === 'theater/character-configured')
      if (marker?.type !== 'theater/character-configured' || marker.data.characterId !== character.id) {
        await handle.dispose()
        throw new Error(`Character ${JSON.stringify(character.id)} is missing its durable Theater configuration`)
      }
      const title = runtime.contributions?.characters.find(candidate => candidate.id === character.id)?.title
        ?? character.id
      this.ensureSessionTitle(handle.agent.session, title)
      runtime.characters.set(character.id, handle.agent)
    }
  }

  private ensureSessionTitle(session: Session, title: string): void {
    if (session.events.some(event => event.type === 'session/title')) return
    session.append('session/title', {
      title,
      messageSeqs: [],
      source: { kind: 'user' },
    })
  }

  private setupCharacter(runtime: PerformanceRuntime, characterId: string, agentCtx: Context): void {
    const contributions = runtime.contributions
    if (contributions === undefined) throw new Error('cannot compose Character without Theater contributions')
    const character = contributions.characters.find(candidate => candidate.id === characterId)
    if (character === undefined) throw new Error(`missing current Character contribution ${JSON.stringify(characterId)}`)
    suppressAgentInstructions(agentCtx)
    agentCtx.systemPrompt.suppressRuntimeContext()
    agentCtx.systemPrompt.section({
      name: PERSONA_SECTION,
      order: PERSONA_ORDER,
      text: character.systemPrompt,
      complete: true,
    })
    const stages = new Set(contributions.stages.map(stage => stage.stageId))
    const resolveStage = (stageId: string) => {
      if (!stages.has(stageId)) throw new Error(`Stage ${JSON.stringify(stageId)} is not declared by this Performance preset`)
      return {
        read: () => runtime.scope.ctx.stages.read(runtime.session, stageId),
        interact: (op: unknown) => runtime.scope.ctx.stages.interact(runtime.session, stageId, op),
      }
    }
    const currentTurnKind = (): 'top-level' | 'nested' => {
      const stack = analyze(runtime.session.events).stack
      if (stack.at(-1) !== characterId) {
        throw new Error(`Character ${JSON.stringify(characterId)} has no active Segment`)
      }
      return stack.length === 1 ? 'top-level' : 'nested'
    }
    agentCtx.tools.restrict({ allow: [] })
    const toolContext: TheaterToolContext = {
      characterId,
      characterIds: runtime.configured.characters.map(character => character.id),
      stage: resolveStage,
      currentTurnKind,
      runNestedTurn: async (targetId, instruction) => {
        currentTurnKind()
        return (await this.runTurn(runtime, targetId, instruction)).read
      },
    }
    for (const tool of character.tools) {
      agentCtx.tools.register(tool.factory.create(tool.config, toolContext))
    }
  }

  private ensureCharacterMarker(session: Session, characterId: string): void {
    const marker = session.events.find(event => event.type === 'theater/character-configured')
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
    if (this.live.has(performanceId) || this.ctx.sessions.get(performanceId) !== undefined) {
      throw new Error(`Performance ${JSON.stringify(performanceId)} is already live`)
    }
  }

  private requireRuntime(performanceId: SessionIdType): PerformanceRuntime {
    const runtime = this.live.get(performanceId)
    if (runtime === undefined) throw new Error(`Performance ${JSON.stringify(performanceId)} is not live`)
    return runtime
  }

  private requireActiveRuntime(performanceId: SessionIdType): PerformanceRuntime {
    const runtime = this.requireRuntime(performanceId)
    if (runtime.phase !== 'active') {
      throw new Error(`Performance ${JSON.stringify(performanceId)} is not active: ${runtime.phase}`)
    }
    return runtime
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    theater: TheaterService
  }
}

export default TheaterService
