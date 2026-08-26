/// <reference types="node" />

import { Service, type Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-agent-presets'
import { createUserMessage, type ContentBlock } from '@deepseek-ai/dsh-llm'
import {
  SessionId,
  type Session,
  type SessionEvent,
  type SessionId as SessionIdType,
} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import {
  AnonymousEntries,
  ScopedLayers,
  createScope,
  scopeOf,
  type Scope,
  type ScopeKey,
  type ScopeLayer,
} from '@deepseek-ai/dsh-scope'
import {
  characterSessionId,
  compatible,
  failure,
  nonEmpty,
  resolvedConfiguration,
  selectedAgentPreset,
} from './configuration.js'
import { analyze, registerTheaterSessionEventTypes, settlement } from './events.js'
import type {
  CreatePerformanceInput,
  Director,
  ForkPerformanceInput,
  PerformanceRead,
  PerformanceRuntimeStatus,
  ResumePerformanceInput,
  TheaterCharacterContribution,
  TheaterConfigured,
  TheaterSegmentEnded,
  TheaterStageContribution,
} from './types.js'

interface ContributionLayer extends ScopeLayer {
  readonly characters: AnonymousEntries<TheaterCharacterContribution>
  readonly stages: AnonymousEntries<TheaterStageContribution>
  readonly directors: AnonymousEntries<Director>
}

interface TheaterContributions {
  readonly characters: readonly TheaterCharacterContribution[]
  readonly stages: readonly TheaterStageContribution[]
  readonly director: Director
}

interface PerformanceRuntime {
  readonly scope: Scope
  readonly session: Session
  readonly configured: TheaterConfigured
  readonly contributions?: TheaterContributions
  readonly characters: Map<string, Agent>
  readonly liveStages: Set<string>
  status: PerformanceRuntimeStatus
  error?: Error
  mainLoop: Promise<void>
}

/** `ctx.theater`: preset-composed Performance creation, driving, reading, resume, and fork. */
export class TheaterService extends Service {
  static inject = ['sessions', 'agents', 'agentPresets', 'agentDefaultModel', 'stages']

  private readonly layers = new ScopedLayers<ContributionLayer>(
    () => ({
      characters: new AnonymousEntries<TheaterCharacterContribution>(),
      stages: new AnonymousEntries<TheaterStageContribution>(),
      directors: new AnonymousEntries<Director>(),
      isEmpty() {
        return this.characters.isEmpty() && this.stages.isEmpty() && this.directors.isEmpty()
      },
    }),
    () => undefined,
  )
  private readonly live = new Map<SessionIdType, PerformanceRuntime>()

  constructor(ctx: Context) {
    super(ctx, 'theater')
    ctx.effect(registerTheaterSessionEventTypes, 'theater.sessionEventTypes()')
  }

  registerCharacter(character: TheaterCharacterContribution): () => void {
    return this.registerContribution(character, layer => layer.characters, 'registerCharacter')
  }

  registerStage(stage: TheaterStageContribution): () => void {
    return this.registerContribution(stage, layer => layer.stages, 'registerStage')
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
    const contributions = await this.resolveContributions(presetId)
    const configured = resolvedConfiguration(presetId, contributions)
    const scope = createScope(this.ctx, { performanceId })
    try {
      const session = scope.ctx.sessions.create(performanceId)
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
        runtime.status = 'incompatible'
        runtime.error = incompatibility ?? new Error('current Theater contributions are incompatible')
        return this.read(performanceId)
      }
      await this.resumeCharacters(runtime)
      this.startMainLoop(runtime)
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
    if (source.status === 'incompatible') throw source.error
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
      return this.read(childId)
    } catch (error) {
      await scope.dispose()
      throw error
    }
  }

  async whenIdle(performanceId: SessionIdType): Promise<void> {
    const runtime = this.requireRuntime(performanceId)
    await runtime.mainLoop
    if (runtime.status === 'failed' || runtime.status === 'incompatible') {
      throw runtime.error ?? new Error(`Performance ${JSON.stringify(performanceId)} cannot advance`)
    }
  }

  read(performanceId: SessionIdType): PerformanceRead {
    const runtime = this.requireRuntime(performanceId)
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
      status: runtime.status,
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
      status: 'running',
      mainLoop: Promise.resolve(),
    }
  }

  private startMainLoop(runtime: PerformanceRuntime): void {
    const contributions = runtime.contributions
    if (contributions === undefined) throw new Error('cannot drive Performance without Theater contributions')
    runtime.mainLoop = (async () => {
      try {
        const directorContext = {
          readStage: (stageId: string) => this.ctx.stages.read(runtime.session, stageId),
        }
        while (true) {
          const decision = await contributions.director(directorContext)
          switch (decision.kind) {
            case 'act':
              await this.act(runtime, decision.characterId, decision.instruction)
              continue
            case 'complete':
              runtime.status = 'completed'
              return
            default:
              throw new Error(`Director returned an unknown decision: ${JSON.stringify(decision)}`)
          }
        }
      } catch (error) {
        runtime.status = 'failed'
        runtime.error = error instanceof Error ? error : new Error(String(error))
      }
    })()
  }

  private async act(
    runtime: PerformanceRuntime,
    characterId: string,
    instruction: readonly ContentBlock[],
  ): Promise<void> {
    const character = this.requireCharacter(runtime, characterId)
    const before = character.session.seq
    const open = analyze(runtime.session.events)
    if (open.stack.length !== 0) throw new Error('cannot start a Character Segment while another Segment is open')
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
    if (actionError !== undefined) throw actionError
  }

  private async resolveContributions(presetId: string): Promise<TheaterContributions> {
    const key: ScopeKey = await this.ctx.agentPresets.standingKeyFor(presetId)
    const layer = this.layers.peek(key)
    const directors = layer === undefined ? [] : [...layer.directors.values()]
    if (directors.length !== 1) {
      throw new Error(`Agent Preset ${JSON.stringify(presetId)} must contribute exactly one Theater Director; found ${directors.length}`)
    }
    return {
      characters: layer === undefined ? [] : [...layer.characters.values()],
      stages: layer === undefined ? [] : [...layer.stages.values()],
      director: directors[0]!,
    }
  }

  private async openStages(runtime: PerformanceRuntime): Promise<void> {
    const contributions = runtime.contributions
    if (contributions === undefined) return
    for (const stage of contributions.stages) {
      await runtime.scope.ctx.stages.ensure(runtime.session, stage.stageId, {
        factory: stage.factory,
        config: stage.config ?? {},
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
      character: TheaterCharacterContribution
      parent: Session
      watermark: number
      seed: readonly SessionEvent[]
    }[] = [],
  ): Promise<void> {
    const byId = new Map(seeds.map(seed => [seed.character.id, seed]))
    for (const character of runtime.configured.characters) {
      const seed = byId.get(character.id)
      const meta = seed === undefined
        ? { agentPreset: character.agentPreset }
        : {
            parentSession: seed.parent.id,
            seedLength: seed.watermark,
            agentPreset: character.agentPreset,
          }
      const handle = await runtime.scope.ctx.agents.create({
        sessionId: characterSessionId(runtime.session.id, character.id),
        ...seed === undefined ? {} : { seed: seed.seed },
        meta,
        agentOptions: runtime.scope.ctx.agentDefaultModel.currentSelection(),
        setup: async agentCtx => void await runtime.scope.ctx.agentPresets.mount(agentCtx, character.agentPreset),
      })
      const selected = selectedAgentPreset(handle.agent.session)
      if (selected !== undefined && selected !== character.agentPreset) {
        await handle.dispose()
        throw new Error(`Character ${JSON.stringify(character.id)} seed selected a different Agent Preset`)
      }
      if (selected === undefined) {
        handle.agent.session.append('agent-preset/selected', { agentPreset: character.agentPreset })
      }
      runtime.characters.set(character.id, handle.agent)
    }
  }

  private async resumeCharacters(runtime: PerformanceRuntime): Promise<void> {
    for (const character of runtime.configured.characters) {
      const handle = await runtime.scope.ctx.agents.resume({
        resumeSessionId: characterSessionId(runtime.session.id, character.id),
        agentOptions: runtime.scope.ctx.agentDefaultModel.currentSelection(),
        setup: async agentCtx => void await runtime.scope.ctx.agentPresets.mount(agentCtx, character.agentPreset),
      })
      const selected = selectedAgentPreset(handle.agent.session)
      if (handle.agent.session.header.agentPreset !== character.agentPreset
        || selected !== character.agentPreset) {
        await handle.dispose()
        throw new Error(`Character ${JSON.stringify(character.id)} persisted a different Agent Preset`)
      }
      runtime.characters.set(character.id, handle.agent)
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
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    theater: TheaterService
  }
}

export default TheaterService
