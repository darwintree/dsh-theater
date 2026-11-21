import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import * as AgentInstructions from '@deepseek-ai/dsh-agent-instructions'
import { createUserMessage, type ContentBlock } from '@deepseek-ai/dsh-llm'
import {
  SessionLogOffset,
  type Session,
  type SessionEvent,
  type SessionId as SessionIdType,
} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-title'
import { PERSONA_PREFIX_SECTION } from '@deepseek-ai/dsh-system-prompt'
import type { Scope } from '@deepseek-ai/dsh-scope'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { stageServiceOf, type TheaterCatalog } from './catalog.js'
import { characterSessionId, failure } from './configuration.js'
import { analyze, settlement } from './events.js'
import { extractTurnContent, sliceActiveTurnEvents, sliceSettledTurnEvents } from './turns.js'
import type {
  ActiveCharacterTurnRead,
  CharacterTurnRead,
  Director,
  PerformanceActivity,
  PerformancePhase,
  PerformanceRead,
  TheaterConfigured,
  TheaterConfiguredCharacter,
  TheaterSegmentEnded,
  TheaterToolContext,
} from './types.js'

export interface CharacterSeed {
  readonly character: TheaterConfiguredCharacter
  readonly parent: Session
  readonly watermark: number
  readonly seed: readonly SessionEvent[]
}

interface ActiveTurnFrame {
  readonly characterId: string
  readonly agent: Agent
  abortReason?: string
}

interface TurnExecution {
  readonly read: CharacterTurnRead
  readonly error?: TheaterSegmentEnded['error']
}

export function ensureSessionTitle(session: Session, title: string): void {
  if (session.snapshotEvents().some(event => event.type === 'session/title')) return
  session.append('session/title', {
    title,
    messageSeqs: [],
    source: { kind: 'user' },
  })
}

/**
 * Live runtime state and Main Loop driver for one Performance Session.
 * Owns Stage opening, Character assembly, serial/nested Turn settlement,
 * cancellation, and read projections for that Performance.
 */
export class PerformanceRuntime {
  readonly characters = new Map<string, Agent>()
  readonly liveStages = new Set<string>()
  phase: PerformancePhase = 'active'
  activity: PerformanceActivity = 'idle'
  error?: Error

  private readonly activeTurns: ActiveTurnFrame[] = []
  private readonly activityWaiters = new Set<() => void>()
  private stopping = false
  private loopAbort: AbortController | undefined
  private mainLoop: Promise<void> = Promise.resolve()

  constructor(
    private readonly owner: Context,
    private readonly catalog: TheaterCatalog,
    readonly scope: Scope,
    readonly session: Session,
    readonly configured: TheaterConfigured,
    private readonly characterTitles: ReadonlyMap<string, string>,
    private readonly director?: Director,
  ) {}

  registerCleanup(onDispose: () => void): void {
    this.scope.ctx.effect(() => () => {
      this.stopping = true
      this.loopAbort?.abort()
      for (let index = this.activeTurns.length - 1; index >= 0; index -= 1) {
        this.activeTurns[index]!.agent.cancel({ kind: 'parent' })
      }
      onDispose()
    }, `theater.cleanup(${this.session.id})`)
  }

  markFailed(error: Error): void {
    this.phase = 'failed'
    this.error = error
  }

  markIncompatible(error: Error): void {
    this.phase = 'incompatible'
    this.error = error
  }

  async openConfiguredStages(): Promise<void> {
    if (this.configured.stages.length === 0) return
    const stagesService = stageServiceOf(this.owner)
    if (stagesService === undefined) {
      throw new Error('Stage service (@darwintree/dsh-stage) is required for Performances that declare Stages')
    }
    for (const stage of this.configured.stages) {
      const factory = stagesService.getFactory(stage.machine)
      if (factory === undefined || factory.version !== stage.version) {
        throw new Error(`State Machine factory ${JSON.stringify(stage.machine)}@${stage.version} is unavailable`)
      }
      await stagesService.ensure(this.session, stage.stageId, {
        factory,
        config: stage.config,
      })
      this.liveStages.add(stage.stageId)
    }
  }

  async openCompatibleStages(): Promise<void> {
    if (this.configured.stages.length === 0) return
    const stagesService = stageServiceOf(this.owner)
    if (stagesService === undefined) return
    for (const durable of this.configured.stages) {
      const factory = stagesService.getFactory(durable.machine)
      if (factory === undefined || factory.version !== durable.version) continue
      await stagesService.ensure(this.session, durable.stageId, { factory })
      this.liveStages.add(durable.stageId)
    }
  }

  async createCharacters(seeds: readonly CharacterSeed[] = []): Promise<void> {
    const cwd = this.session.header.cwd
    if (cwd === undefined) throw new Error('Performance Session header has no cwd')
    const byId = new Map(seeds.map(seed => [seed.character.id, seed]))
    for (const character of this.configured.characters) {
      const seed = byId.get(character.id)
      const handle = await this.scope.ctx.agents.create({
        sessionId: characterSessionId(this.session.id, character.id),
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
        agentOptions: character.model ?? this.scope.ctx.agentDefaultModel.currentSelection(),
        setup: agentCtx => this.setupCharacter(character, agentCtx),
      })
      const title = this.characterTitles.get(character.id) ?? character.id
      ensureSessionTitle(handle.agent.session, title)
      this.ensureCharacterMarker(handle.agent.session, character.id)
      this.characters.set(character.id, handle.agent)
    }
  }

  async resumeCharacters(): Promise<void> {
    for (const character of this.configured.characters) {
      const handle = await this.scope.ctx.agents.resume({
        resumeSessionId: characterSessionId(this.session.id, character.id),
        agentOptions: character.model ?? this.scope.ctx.agentDefaultModel.currentSelection(),
        setup: agentCtx => this.setupCharacter(character, agentCtx),
      })
      const marker = handle.agent.session.snapshotEvents().find(event => event.type === 'theater/character-configured')
      if (marker?.type !== 'theater/character-configured' || marker.data.characterId !== character.id) {
        await handle.dispose()
        throw new Error(`Character ${JSON.stringify(character.id)} is missing its durable Theater configuration`)
      }
      const title = this.characterTitles.get(character.id) ?? character.id
      ensureSessionTitle(handle.agent.session, title)
      this.characters.set(character.id, handle.agent)
    }
  }

  async flushAll(): Promise<void> {
    await Promise.all([
      ...[...this.characters.values()].map(agent => this.scope.ctx.sessions.flush(agent.session)),
      this.scope.ctx.sessions.flush(this.session),
    ])
  }

  startMainLoop(): void {
    if (this.phase !== 'active') return
    if (this.activity !== 'idle') throw new Error('Performance Main Loop is already running')
    const director = this.director
    if (director === undefined) throw new Error('cannot drive Performance without a Theater Director')
    const abort = new AbortController()
    this.loopAbort = abort
    this.stopping = false
    this.setActivity('awaiting-director')
    this.mainLoop = (async () => {
      try {
        const directorContext = {
          signal: abort.signal,
          readStage: (stageId: string) => this.readStage(stageId),
          readSettledTurns: () => this.readSettledTurns(),
        }
        while (true) {
          this.setActivity('awaiting-director')
          if (abort.signal.aborted) return
          const decision = await director(directorContext)
          if (abort.signal.aborted) return
          switch (decision.kind) {
            case 'act':
              this.setActivity('executing-turn')
              await this.act(decision.characterId, decision.instruction)
              continue
            case 'complete':
              this.phase = 'completed'
              return
            default:
              throw new Error(`Director returned an unknown decision: ${JSON.stringify(decision)}`)
          }
        }
      } catch (error) {
        if (this.stopping && abort.signal.aborted && this.activity === 'awaiting-director') {
          return
        }
        this.phase = 'failed'
        this.error = error instanceof Error ? error : new Error(String(error))
      } finally {
        if (this.loopAbort === abort) this.loopAbort = undefined
        abort.abort()
        this.setActivity('idle')
      }
    })()
  }

  async whenIdle(): Promise<void> {
    while (true) {
      const mainLoop = this.mainLoop
      await mainLoop
      if (mainLoop === this.mainLoop && this.activity === 'idle') break
    }
    if (this.phase === 'failed' || this.phase === 'incompatible') {
      throw this.error ?? new Error(`Performance ${JSON.stringify(this.session.id)} cannot advance`)
    }
  }

  async whenAtDirectorPoint(): Promise<PerformanceRead> {
    while (this.activity === 'executing-turn') {
      await new Promise<void>((resolve) => {
        this.activityWaiters.add(resolve)
      })
    }
    if (this.phase === 'failed' || this.phase === 'incompatible') {
      throw this.error ?? new Error(`Performance ${JSON.stringify(this.session.id)} cannot advance`)
    }
    return this.read()
  }

  async stop(): Promise<PerformanceRead> {
    if (this.activity === 'idle') return this.read()
    this.stopping = true
    this.loopAbort?.abort()
    for (let index = this.activeTurns.length - 1; index >= 0; index -= 1) {
      this.activeTurns[index]!.agent.cancel({ kind: 'parent' })
    }
    while (true) {
      const mainLoop = this.mainLoop
      await mainLoop
      if (mainLoop === this.mainLoop && (this.activity as PerformanceActivity) === 'idle') break
    }
    return this.read()
  }

  read(): PerformanceRead {
    const cwd = this.session.header.cwd
    if (cwd === undefined) throw new Error('Performance Session header has no cwd')
    const analysis = analyze(this.session.snapshotEvents())
    const characters = Object.fromEntries(this.configured.characters.map(character => [
      character.id,
      characterSessionId(this.session.id, character.id),
    ])) as Record<string, SessionIdType>
    const stagesService = stageServiceOf(this.owner)
    const stages = Object.fromEntries(this.configured.stages.map((configuration) => {
      if (stagesService === undefined || !this.liveStages.has(configuration.stageId)) {
        return [configuration.stageId, { configuration }]
      }
      return [configuration.stageId, {
        configuration,
        state: stagesService.read(this.session, configuration.stageId),
        completed: stagesService.completed(this.session, configuration.stageId),
      }]
    }))
    return {
      performanceId: this.session.id,
      presetId: this.configured.presetId,
      cwd,
      phase: this.phase,
      activity: this.activity,
      ...this.error === undefined ? {} : { error: this.error.message },
      characters,
      stages,
      forkablePositions: analysis.forkablePositions,
      lineage: {
        ...this.session.header.parentSession === undefined ? {} : { parentSession: this.session.header.parentSession },
        ...this.session.header.isSeeded ? { seedLength: this.session.inheritedEventCount } : {},
      },
    }
  }

  private setActivity(activity: PerformanceActivity): void {
    this.activity = activity
    for (const notify of this.activityWaiters) notify()
    this.activityWaiters.clear()
  }

  private readStage(stageId: string): JsonValue {
    const stagesService = stageServiceOf(this.owner)
    if (stagesService === undefined || !this.liveStages.has(stageId)) {
      throw new Error(`Stage ${JSON.stringify(stageId)} is not declared by this Performance`)
    }
    return stagesService.read(this.session, stageId)
  }

  private async act(characterId: string, instruction: readonly ContentBlock[]): Promise<void> {
    const open = analyze(this.session.snapshotEvents())
    if (open.stack.length !== 0) throw new Error('cannot start a Character Segment while another Segment is open')
    const { read, error } = await this.runTurn(characterId, instruction)
    if (read.outcome !== 'completed') {
      throw Object.assign(
        new Error(error?.message ?? `Character ${JSON.stringify(characterId)} failed`),
        { code: error?.code ?? 'CHARACTER_FAILED' },
      )
    }
  }

  private async runTurn(
    characterId: string,
    instruction: readonly ContentBlock[],
  ): Promise<TurnExecution> {
    const character = this.requireCharacter(characterId)
    if (character.status !== 'idle') throw new Error(`Character ${JSON.stringify(characterId)} is already active`)
    const before = character.session.seq
    this.session.append('theater/segment-started', { characterId })
    await this.scope.ctx.sessions.flush(this.session)
    const frame: ActiveTurnFrame = { characterId, agent: character }
    this.activeTurns.push(frame)
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
      const popped = this.activeTurns.pop()
      if (popped !== frame) {
        const index = this.activeTurns.lastIndexOf(frame)
        if (index >= 0) this.activeTurns.splice(index, 1)
      }
    }
    await this.scope.ctx.sessions.flush(character.session)
    await this.scope.ctx.sessions.flush(this.session)
    const characterSessionSeq = character.session.seq
    const top = analyze(this.session.snapshotEvents()).stack.at(-1)
    if (top !== characterId) throw new Error(`Character Segment end for ${JSON.stringify(characterId)} violates LIFO order`)
    this.session.append('theater/segment-ended', {
      characterId,
      characterSessionSeq,
      ...ended,
    })
    await this.scope.ctx.sessions.flush(this.session)
    const events = sliceSettledTurnEvents(character.session.snapshotEvents().slice(before, characterSessionSeq))
    if (actionError !== undefined && events.length === 0) throw actionError
    const read: CharacterTurnRead = {
      characterId,
      outcome: ended.outcome,
      ...extractTurnContent(events),
    }
    return ended.error === undefined ? { read } : { read, error: ended.error }
  }

  private readSettledTurns(): readonly CharacterTurnRead[] {
    const reads: CharacterTurnRead[] = []
    const stack: string[] = []
    const watermarks = new Map<string, number>()
    for (const event of this.session.snapshotEvents()) {
      if (event.type === 'theater/segment-started') {
        stack.push(event.data.characterId)
        continue
      }
      if (event.type !== 'theater/segment-ended') continue
      const characterId = stack.pop()
      if (characterId !== event.data.characterId) {
        throw new Error(`Character Segment end for ${JSON.stringify(event.data.characterId)} violates LIFO order`)
      }
      const session = this.requireCharacter(characterId).session
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

  private readActiveTurn(characterId: string): ActiveCharacterTurnRead {
    const character = this.requireCharacter(characterId)
    const events = sliceActiveTurnEvents(character.session.snapshotEvents())
    return {
      characterId,
      ...extractTurnContent(events),
    }
  }

  private setupCharacter(character: TheaterConfiguredCharacter, agentCtx: Context): void {
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
    const declaredStages = new Set(this.configured.stages.map(stage => stage.stageId))
    const resolveStage = (stageId: string) => {
      if (!declaredStages.has(stageId)) {
        throw new Error(`Stage ${JSON.stringify(stageId)} is not declared by this Performance preset`)
      }
      const stagesService = stageServiceOf(this.owner)
      if (stagesService === undefined) {
        throw new Error('Stage service (@darwintree/dsh-stage) is not available')
      }
      return {
        read: () => stagesService.read(this.session, stageId),
        interact: (op: unknown) => stagesService.interact(this.session, stageId, op),
      }
    }
    const requireActiveFrame = (): ActiveTurnFrame => {
      const top = this.activeTurns.at(-1)
      if (top?.characterId !== characterId) {
        throw new Error(`Character ${JSON.stringify(characterId)} has no active Segment`)
      }
      return top
    }
    const currentTurnKind = (): 'top-level' | 'nested' => {
      requireActiveFrame()
      return this.activeTurns.length === 1 ? 'top-level' : 'nested'
    }
    agentCtx.tools.restrict({ allow: [] })
    const toolContext: TheaterToolContext = {
      characterId,
      characterIds: this.configured.characters.map(item => item.id),
      stage: resolveStage,
      currentTurnKind,
      readCurrentTurn: () => {
        requireActiveFrame()
        return this.readActiveTurn(characterId)
      },
      readSettledTurns: () => this.readSettledTurns(),
      runNestedTurn: async (targetId, instruction) => {
        requireActiveFrame()
        return (await this.runTurn(targetId, instruction)).read
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
      const factory = this.catalog.getToolFactory(tool.factory)
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

  private requireCharacter(characterId: string): Agent {
    const character = this.characters.get(characterId)
    if (character === undefined) throw new Error(`unknown Character ${JSON.stringify(characterId)}`)
    return character
  }
}
