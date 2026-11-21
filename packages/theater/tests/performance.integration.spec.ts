import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { LlmError } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { describe, expect, it } from 'vitest'
import { MockLlmAdapter, type Behaviour, type MockResponse } from '@darwintree/dsh-llm-mock'
import * as Gomoku from '@darwintree/dsh-theater-gomoku'
import * as GomokuTheater from '@darwintree/dsh-theater-gomoku/theater'
import {
  characterSessionId,
  createHumanDirector,
  createStepDirector,
  createTurnLimitDirector,
  type ActiveCharacterTurnRead,
  type CharacterTurnRead,
  type TheaterToolFactory,
} from '@darwintree/dsh-theater'
import { createDshTestContext, extractSystemPrompt } from '../../../tests/harness.ts'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

type MovePlan = (sessionId: string) => readonly (readonly [number, number])[]

const defaultPlan: MovePlan = sessionId => sessionId.endsWith('/characters/black')
  ? [[0, 0], [1, 0], [2, 0]]
  : [[0, 1], [1, 1]]

function moveScript(sessionId: string, assistantCount: number, plan: MovePlan): MockResponse {
  const moves = plan(sessionId)
  if (sessionId.endsWith('/characters/white')) {
    const move = moves[assistantCount]
    if (move === undefined) throw new Error(`unexpected model call for ${sessionId}`)
    return {
      content: [{
        type: 'tool-call',
        id: `${sessionId}-move-${assistantCount}`,
        name: 'place_stone',
        arguments: JSON.stringify({ x: move[0], y: move[1] }),
      }],
    }
  }
  const move = moves[Math.floor(assistantCount / 2)]
  if (move === undefined) throw new Error(`unexpected model call for ${sessionId}`)
  return assistantCount % 2 === 0
    ? {
        content: [{
          type: 'tool-call',
          id: `${sessionId}-read-${assistantCount}`,
          name: 'read_board',
          arguments: '{}',
        }],
      }
    : {
        content: [{
          type: 'tool-call',
          id: `${sessionId}-move-${assistantCount}`,
          name: 'place_stone',
          arguments: JSON.stringify({ x: move[0], y: move[1] }),
        }],
      }
}

async function setup(
  plan: MovePlan = defaultPlan,
  behaviour?: Behaviour,
  options: {
    persistenceRoot?: string
    presetRoot?: string
    defaultPreset?: string
    mountTheater?: boolean
    mountStage?: boolean
  } = {},
): Promise<Context> {
  const mountStage = options.mountStage ?? true
  const ctx = await createDshTestContext({
    baseDir: FIXTURES,
    ...options.persistenceRoot === undefined ? {} : { persistenceRoot: options.persistenceRoot },
    personaPrefix: 'Host default persona.',
    maxParallelToolCalls: 1,
    presets: {
      default: options.defaultPreset ?? 'two-character-gomoku',
      dirs: [options.presetRoot ?? join(FIXTURES, 'presets')],
    },
    mountTheater: options.mountTheater ?? true,
    mountStage,
  })
  if (mountStage) {
    await ctx.plugin(Gomoku)
  }
  ctx.llm.registerAdapter(['mock'], new MockLlmAdapter(behaviour ?? (options =>
    moveScript(
      String(options.sessionId),
      options.messages.filter(message => message.role === 'assistant').length,
      plan,
    ))))
  if (options.mountTheater !== false) {
    await ctx.plugin(GomokuTheater)
  }
  return ctx
}

async function writeCompatibilityPresets(
  root: string,
  config: {
    director?: 'complete' | 'gomoku'
    characters: readonly {
      id: string
      systemPrompt: string
      color: 'black' | 'white'
      read: boolean
    }[]
    boardSize: number
    stages?: readonly { id: string; machine: string; boardSize: number }[]
  },
): Promise<void> {
  const director = config.director === 'gomoku'
    ? '@darwintree/dsh-theater-gomoku/director'
    : join(FIXTURES, 'plugins', 'complete-director.js')
  const rows = config.characters.flatMap(character => [
    `      ${character.id}:`,
    `        systemPrompt: ${JSON.stringify(character.systemPrompt)}`,
    '        tools:',
    ...character.read ? [
      '          - factory: gomoku-read-board',
      '            params: { stage: board1 }',
    ] : [],
    '          - factory: gomoku-place-stone',
    `            params: { stage: board1, color: ${character.color} }`,
  ]).join('\n')
  const stageRows = (config.stages ?? [{ id: 'board1', machine: 'gomoku', boardSize: config.boardSize }])
    .flatMap(stage => [
      `      ${stage.id}:`,
      `        machine: ${stage.machine}`,
      `        params: { boardSize: ${stage.boardSize}, winLength: 3 }`,
    ]).join('\n')
  await mkdir(join(root, 'compat'), { recursive: true })
  await writeFile(join(root, 'compat', 'agent.cordis.yml'), [
    '- id: stages',
    "  name: '@darwintree/dsh-stage/preset'",
    '  config:',
    '    stages:',
    stageRows,
    '- id: performance',
    "  name: '@darwintree/dsh-theater/preset'",
    '  config:',
    '    characters:',
    rows,
    '- id: director',
    `  name: ${JSON.stringify(director)}`,
    ...config.director === 'gomoku' ? [
      '  config:',
      '    stage: board1',
      '    instruction: Make exactly one legal generated-preset move.',
    ] : [],
    '',
  ].join('\n'))
}

describe('Performance Theater', () => {
  it('owns the Main Loop and repeatedly evaluates a single-step Director until terminal Stage state', async () => {
    const systems = new Map<string, string | undefined>()
    const ctx = await setup(defaultPlan, (options) => {
      const sessionId = String(options.sessionId)
      systems.set(sessionId, extractSystemPrompt(options))
      return moveScript(
        sessionId,
        options.messages.filter(message => message.role === 'assistant').length,
        defaultPlan,
      )
    })
    ctx.tools.register(defineTool({
      name: 'host_tool',
      description: 'A host Tool that must not leak into Character Tool lists.',
      parameters: {},
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      async execute() { return 'host' },
    }))
    const performanceId = SessionId('performance-create')
    const flushes: Array<{
      sessionId: string
      lastType?: string
      blackSeq?: number
      whiteSeq?: number
    }> = []
    ctx.on('session/flush', (session) => {
      flushes.push({
        sessionId: String(session.id),
        lastType: session.snapshotEvents().at(-1)?.type,
        blackSeq: ctx.sessions.get(characterSessionId(performanceId, 'black'))?.seq,
        whiteSeq: ctx.sessions.get(characterSessionId(performanceId, 'white'))?.seq,
      })
    })

    await ctx.theater.create({ performanceId, presetId: 'two-character-gomoku', cwd: FIXTURES })
    await ctx.theater.whenIdle(performanceId)

    const performance = ctx.theater.read(performanceId)
    expect(performance).toMatchObject({ phase: 'completed', activity: 'idle' })
    expect(performance.stages.board1).toMatchObject({
      state: { moveNumber: 5, winner: 'black', isFinished: true },
    })
    expect(performance.characters).toEqual({
      black: characterSessionId(performanceId, 'black'),
      white: characterSessionId(performanceId, 'white'),
    })

    const session = ctx.sessions.get(performanceId)!
    expect(performance.cwd).toBe(FIXTURES)
    expect(session.header.cwd).toBe(FIXTURES)
    expect(session.header.agentPreset).toBeUndefined()
    const configuredEvent = session.snapshotEvents().find(event => event.type === 'theater/configured')
    expect(configuredEvent).toMatchObject({
      data: {
        presetId: 'two-character-gomoku',
        characters: [
          { id: 'black', systemPrompt: 'You are the black Gomoku test Character.' },
          { id: 'white', systemPrompt: 'You are the white Gomoku test Character.' },
        ],
      },
    })
    expect('autoAdvance' in (configuredEvent?.data ?? {})).toBe(false)
    expect(session.snapshotEvents().filter(event => event.type === 'stage/op')).toHaveLength(5)
    expect(session.snapshotEvents().some(event => event.type === 'user/message')).toBe(false)
    expect(session.snapshotEvents().some(event => event.type === 'assistant/message')).toBe(false)
    expect(session.snapshotEvents().some(event => event.type === 'tool/call')).toBe(false)
    expect(session.snapshotEvents().some(event => event.type === 'tool/result')).toBe(false)
    expect(session.snapshotEvents().filter(event => event.type === 'theater/segment-started')).toHaveLength(5)
    expect(session.snapshotEvents().filter(event => event.type === 'theater/segment-ended')).toHaveLength(5)
    expect(performance.forkablePositions).toHaveLength(6)

    const firstStartFlush = flushes.find(flush =>
      flush.sessionId === performanceId && flush.lastType === 'theater/segment-started')
    expect(firstStartFlush).toMatchObject({ blackSeq: 2, whiteSeq: 2 })
    for (const end of session.snapshotEvents().filter(event => event.type === 'theater/segment-ended')) {
      const checkpoint = flushes.find(flush =>
        flush.sessionId === performanceId
        && flush.lastType === 'theater/segment-ended'
        && flush[end.data.characterId === 'black' ? 'blackSeq' : 'whiteSeq'] === end.data.characterSessionSeq)
      expect(checkpoint).toBeDefined()
    }
    const boundaries = session.snapshotEvents()
      .filter(event => event.type === 'theater/segment-started' || event.type === 'theater/segment-ended')
      .map(event => [event.type, event.data.characterId])
    expect(boundaries).toEqual([
      ['theater/segment-started', 'black'], ['theater/segment-ended', 'black'],
      ['theater/segment-started', 'white'], ['theater/segment-ended', 'white'],
      ['theater/segment-started', 'black'], ['theater/segment-ended', 'black'],
      ['theater/segment-started', 'white'], ['theater/segment-ended', 'white'],
      ['theater/segment-started', 'black'], ['theater/segment-ended', 'black'],
    ])

    for (const character of ['black', 'white'] as const) {
      const characterSession = ctx.sessions.get(characterSessionId(performanceId, character))!
      expect(characterSession.snapshotEvents().slice(0, 2).map(event => String(event.type))).toEqual([
        'session/title',
        'theater/character-configured',
      ])
      expect(characterSession.header.cwd).toBe(FIXTURES)
      expect(characterSession.header.agentPreset).toBeUndefined()
      expect(systems.get(String(characterSession.id))).toContain(`You are the ${character} Gomoku test Character.`)
      expect(systems.get(String(characterSession.id))).not.toContain('Host default persona.')
      expect(characterSession.snapshotEvents().some(event => event.type === 'agent-preset/selected')).toBe(false)
      expect(characterSession.snapshotEvents().some(event => event.type === 'user/message')).toBe(true)
      const instructions = characterSession.snapshotEvents()
        .flatMap(event => event.type === 'user/message' ? event.data.content : [])
        .flatMap(block => block.type === 'text' ? [block.text] : [])
      expect(instructions[0]).toContain('Previous action:')
      expect(instructions[0]).toContain('Make exactly one legal test move.')
      expect(characterSession.snapshotEvents().some(event => event.type === 'tool/call')).toBe(true)
      expect(characterSession.snapshotEvents().some(event => event.type === 'stage/op')).toBe(false)
      expect(JSON.stringify(characterSession.snapshotEvents())).not.toContain('stage/op')
    }
    const black = ctx.agents.get(characterSessionId(performanceId, 'black'))!
    const white = ctx.agents.get(characterSessionId(performanceId, 'white'))!
    expect(ctx.tools.schemas(black).map(tool => tool.name)).toEqual(['read_board', 'place_stone'])
    expect(ctx.tools.schemas(white).map(tool => tool.name)).toEqual(['place_stone'])
  })

  it('delegates step-gating and continuous switching to createStepDirector without discarding act decisions (ADR-0008)', async () => {
    let ctx: Context | undefined
    try {
      ctx = await setup(defaultPlan)
      const performanceId = SessionId('performance-step-director')
      const stepper = createStepDirector()
      let innerCalls = 0

      await ctx.theater.create({
        performanceId,
        presetId: 'two-character-gomoku',
        cwd: FIXTURES,
        wrapDirector: base => stepper.wrap(async (context) => {
          innerCalls += 1
          return await base(context)
        }),
      })

      await stepper.whenWaiting()
      expect(innerCalls).toBe(0)
      expect(ctx.theater.read(performanceId)).toMatchObject({
        phase: 'active',
        activity: 'awaiting-director',
        stages: { board1: { state: { moveNumber: 0 } } },
      })

      await stepper.step()
      expect(innerCalls).toBe(1)
      expect(ctx.theater.read(performanceId)).toMatchObject({
        phase: 'active',
        activity: 'awaiting-director',
        stages: { board1: { state: { moveNumber: 1 } } },
      })

      await stepper.step()
      expect(innerCalls).toBe(2)
      expect(ctx.theater.read(performanceId)).toMatchObject({
        phase: 'active',
        activity: 'awaiting-director',
        stages: { board1: { state: { moveNumber: 2 } } },
      })

      expect(() => stepper.setContinuous('yes' as never)).toThrow('continuous mode must be boolean')

      stepper.setContinuous(true)
      await ctx.theater.whenIdle(performanceId)
      expect(ctx.theater.read(performanceId)).toMatchObject({
        phase: 'completed',
        activity: 'idle',
        stages: { board1: { state: { winner: 'black', moveNumber: 5 } } },
      })
      // 5 acts + 1 complete = 6 exact calls, never discarding an act decision.
      expect(innerCalls).toBe(6)
    } finally {
      await ctx?.fiber.dispose()
    }
  })

  it('supports a pluggable Human-driven Director, fork while awaiting-director, and clean cancellation via stop() (ADR-0008)', async () => {
    const ctx = await setup(defaultPlan)
    try {
      const performanceId = SessionId('performance-human-director')
      const human = createHumanDirector()
      await ctx.theater.create({
        performanceId,
        presetId: 'two-character-gomoku',
        cwd: FIXTURES,
        director: human.director,
      })

      const first = await human.nextRequest()
      expect(first.context.signal.aborted).toBe(false)
      expect(ctx.theater.read(performanceId)).toMatchObject({
        phase: 'active',
        activity: 'awaiting-director',
      })
      first.act('black', [{ type: 'text', text: 'Human instructs black to open.' }])

      const second = await human.nextRequest()
      expect(second.context.readSettledTurns()).toHaveLength(1)
      expect(second.context.readSettledTurns()[0]).toMatchObject({
        characterId: 'black',
        outcome: 'completed',
      })
      expect(ctx.theater.read(performanceId)).toMatchObject({
        phase: 'active',
        activity: 'awaiting-director',
        stages: { board1: { state: { moveNumber: 1 } } },
      })

      // Fork while the source Performance is parked awaiting-director, switching the child to the default automatic Director.
      const forkedId = SessionId('performance-human-to-auto-fork')
      await ctx.theater.fork({
        sourcePerformanceId: performanceId,
        cursor: ctx.theater.read(performanceId).forkablePositions.at(-1)!,
        childPerformanceId: forkedId,
      })
      await ctx.theater.whenIdle(forkedId)
      expect(ctx.theater.read(forkedId)).toMatchObject({
        phase: 'completed',
        stages: { board1: { state: { winner: 'black', moveNumber: 5 } } },
      })

      // Stopping while awaiting-director aborts DirectorContext.signal cleanly and keeps phase: 'active'.
      const stopped = await ctx.theater.stop(performanceId)
      expect(second.context.signal.aborted).toBe(true)
      expect(stopped).toMatchObject({
        phase: 'active',
        activity: 'idle',
        stages: { board1: { state: { moveNumber: 1 } } },
      })

      // Also verify Human-driven completion.
      const completeId = SessionId('performance-human-complete')
      const human2 = createHumanDirector()
      await ctx.theater.create({
        performanceId: completeId,
        presetId: 'two-character-gomoku',
        cwd: FIXTURES,
        director: human2.director,
      })
      const req = await human2.nextRequest()
      req.complete()
      await ctx.theater.whenIdle(completeId)
      expect(ctx.theater.read(completeId)).toMatchObject({ phase: 'completed', activity: 'idle' })
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('forks initial and settled Director Points with Character watermarks and rejects an open Segment cursor atomically', async () => {
    const childPlan: MovePlan = sessionId => sessionId.startsWith('performance-fork-child/')
      ? sessionId.endsWith('/characters/black')
        ? [[0, 2], [1, 2], [2, 2]]
        : [[0, 1], [1, 1]]
      : defaultPlan(sessionId)
    const ctx = await setup(childPlan)
    const sourceId = SessionId('performance-fork-source')
    await ctx.theater.create({ performanceId: sourceId, presetId: 'two-character-gomoku', cwd: FIXTURES })
    await ctx.theater.whenIdle(sourceId)
    const source = ctx.theater.read(sourceId)
    const sourceSession = ctx.sessions.get(sourceId)!

    const open = sourceSession.snapshotEvents().find(event => event.type === 'theater/segment-started')!
    const rejectedId = SessionId('performance-fork-rejected')
    await expect(ctx.theater.fork({
      sourcePerformanceId: sourceId,
      cursor: open.seq + 1,
      childPerformanceId: rejectedId,
    })).rejects.toThrow('not a Director Point')
    expect(ctx.sessions.get(rejectedId)).toBeUndefined()
    expect(ctx.sessions.get(characterSessionId(rejectedId, 'black'))).toBeUndefined()

    const initialId = SessionId('performance-fork-initial')
    await ctx.theater.fork({
      sourcePerformanceId: sourceId,
      cursor: source.forkablePositions[0]!,
      childPerformanceId: initialId,
    })
    expect(ctx.sessions.get(initialId)?.header.cwd).toBe(FIXTURES)
    const initialBlack = ctx.sessions.get(characterSessionId(initialId, 'black'))
    expect(initialBlack?.header).toMatchObject({
      cwd: FIXTURES,
      parentSession: characterSessionId(sourceId, 'black'),
      isSeeded: true,
    })
    expect(initialBlack?.inheritedEventCount).toBe(0)

    const laterCursor = source.forkablePositions[2]!
    const laterId = SessionId('performance-fork-later')
    await ctx.theater.fork({
      sourcePerformanceId: sourceId,
      cursor: laterCursor,
      childPerformanceId: laterId,
    })
    const later = ctx.theater.read(laterId)
    expect(later.lineage).toEqual({ seedLength: laterCursor })
    const prefixEnds = sourceSession.snapshotEvents().slice(0, laterCursor)
      .filter(event => event.type === 'theater/segment-ended')
    for (const character of ['black', 'white'] as const) {
      const watermark = prefixEnds
        .filter(event => event.data.characterId === character)
        .at(-1)?.data.characterSessionSeq ?? 0
      const childCharacter = ctx.sessions.get(characterSessionId(laterId, character))
      expect(childCharacter?.header).toMatchObject({
        cwd: FIXTURES,
        parentSession: characterSessionId(sourceId, character),
        isSeeded: true,
      })
      expect(childCharacter?.inheritedEventCount).toBe(watermark)
    }

    const divergentId = SessionId('performance-fork-child')
    await ctx.theater.fork({
      sourcePerformanceId: sourceId,
      cursor: source.forkablePositions[0]!,
      childPerformanceId: divergentId,
    })
    await Promise.all([
      ctx.theater.whenIdle(initialId),
      ctx.theater.whenIdle(laterId),
      ctx.theater.whenIdle(divergentId),
    ])
    const divergent = ctx.theater.read(divergentId)
    expect(divergent.stages.board1?.state).toMatchObject({
      winner: 'black',
      lastMove: { x: 2, y: 2 },
    })
    expect(source.stages.board1?.state).toMatchObject({ lastMove: { x: 2, y: 0 } })
  })

  it('keeps an illegal move in the same Segment and reconsiders a normal no-move Segment from unchanged Stage state', async () => {
    const ctx = await setup(defaultPlan, (options) => {
      const sessionId = String(options.sessionId)
      const count = options.messages.filter(message => message.role === 'assistant').length
      const call = (name: string, arguments_: object): MockResponse => ({
        content: [{
          type: 'tool-call',
          id: `${sessionId}-${name}-${count}`,
          name,
          arguments: JSON.stringify(arguments_),
        }],
      })
      if (sessionId.startsWith('performance-retry/') && sessionId.endsWith('/characters/black')) {
        if (count === 0) return { content: [{ type: 'text', text: 'I need another action before moving.' }] }
        if (count === 1 || count === 4 || count === 6) return call('read_board', {})
        if (count === 2) return call('place_stone', { x: 9, y: 9 })
        if (count === 3) return call('place_stone', { x: 0, y: 0 })
        if (count === 5) return call('place_stone', { x: 1, y: 0 })
        if (count === 7) return call('place_stone', { x: 2, y: 0 })
      }
      return moveScript(sessionId, count, defaultPlan)
    })
    const performanceId = SessionId('performance-retry')

    await ctx.theater.create({ performanceId, presetId: 'two-character-gomoku', cwd: FIXTURES })
    await ctx.theater.whenIdle(performanceId)

    const performance = ctx.theater.read(performanceId)
    const session = ctx.sessions.get(performanceId)!
    const starts = session.snapshotEvents().filter(event => event.type === 'theater/segment-started')
    expect(starts.slice(0, 2).map(event => event.data.characterId)).toEqual(['black', 'black'])
    expect(starts).toHaveLength(6)
    expect(session.snapshotEvents().filter(event => event.type === 'stage/op')).toHaveLength(5)
    const black = ctx.sessions.get(characterSessionId(performanceId, 'black'))!
    const results = black.snapshotEvents().filter(event => event.type === 'tool/result')
    expect(results.some(event => JSON.stringify(event.data).includes('coordinate is outside the board'))).toBe(true)
    expect(performance.stages.board1?.state).toMatchObject({ winner: 'black', moveNumber: 5 })
  })

  it('does not create a Director Point on a failed Turn and recovers by forking from the previous Director Point (ADR-0007)', async () => {
    const ctx = await setup(defaultPlan, (options) => {
      const sessionId = String(options.sessionId)
      if (sessionId.startsWith('performance-failure/') && sessionId.endsWith('/characters/black')) {
        throw LlmError.fromFailure({ message: 'scripted Character failure', code: 'SCRIPTED_FAILURE' })
      }
      return moveScript(
        sessionId,
        options.messages.filter(message => message.role === 'assistant').length,
        defaultPlan,
      )
    })
    const sourceId = SessionId('performance-failure')

    await ctx.theater.create({ performanceId: sourceId, presetId: 'two-character-gomoku', cwd: FIXTURES })
    await expect(ctx.theater.whenIdle(sourceId)).rejects.toThrow('scripted Character failure')

    const failed = ctx.theater.read(sourceId)
    const session = ctx.sessions.get(sourceId)!
    expect(failed).toMatchObject({ phase: 'failed', activity: 'idle' })
    expect(session.snapshotEvents().at(-1)).toMatchObject({
      type: 'theater/segment-ended',
      data: { characterId: 'black', outcome: 'error' },
    })
    // Failed Turn does not produce a new Director Point; only the initial Director Point before it is forkable.
    expect(failed.forkablePositions).toHaveLength(1)
    expect(failed.forkablePositions[0]).toBeLessThan(session.snapshotEvents().length)
    await expect(ctx.theater.fork({
      sourcePerformanceId: sourceId,
      cursor: session.snapshotEvents().length,
      childPerformanceId: SessionId('performance-fork-after-error'),
    })).rejects.toThrow('not a Director Point')
    expect(failed.stages.board1?.state).toMatchObject({ moveNumber: 0 })

    const childId = SessionId('performance-recovered')
    await ctx.theater.fork({
      sourcePerformanceId: sourceId,
      cursor: failed.forkablePositions.at(-1)!,
      childPerformanceId: childId,
    })
    await ctx.theater.whenIdle(childId)
    expect(ctx.theater.read(childId)).toMatchObject({
      phase: 'completed',
      stages: { board1: { state: { winner: 'black', moveNumber: 5 } } },
    })
  })

  it('cold-resumes from a settled completed Director Point and supports replacing Director on resume (ADR-0006, ADR-0008)', async () => {
    const persistenceRoot = await mkdtemp(join(tmpdir(), 'dsh-theater-resume-'))
    try {
      const performanceId = SessionId('performance-cold-resume')
      const writer = await setup(defaultPlan, undefined, { persistenceRoot })
      const limiter = createTurnLimitDirector(2)
      await writer.theater.create({
        performanceId,
        presetId: 'two-character-gomoku',
        cwd: FIXTURES,
        wrapDirector: base => limiter.wrap(base),
      })
      await limiter.whenReached()
      await writer.theater.stop(performanceId)
      expect(writer.theater.read(performanceId)).toMatchObject({
        phase: 'active',
        activity: 'idle',
        stages: { board1: { state: { moveNumber: 2 } } },
      })
      await writer.fiber.dispose()

      // Resume with a replacement Human-driven Director to finish or take over.
      const reader = await setup(defaultPlan, undefined, { persistenceRoot })
      const human = createHumanDirector()
      await reader.theater.resume({ performanceId, director: human.director })
      const req = await human.nextRequest()
      expect(req.context.readSettledTurns()).toHaveLength(2)
      req.act('black', [{ type: 'text', text: 'Human takes over move 3.' }])
      const nextReq = await human.nextRequest()
      expect(reader.theater.read(performanceId).stages.board1?.state).toMatchObject({ moveNumber: 3 })
      nextReq.complete()
      await reader.theater.whenIdle(performanceId)

      expect(reader.theater.read(performanceId)).toMatchObject({
        phase: 'completed',
        stages: { board1: { state: { moveNumber: 3 } } },
      })
      await reader.fiber.dispose()
    } finally {
      await rm(persistenceRoot, { recursive: true, force: true })
    }
  })

  it('keeps resumed failed Turns and unclosed Segments halted in failed phase until recovered via fork (ADR-0007)', async () => {
    const persistenceRoot = await mkdtemp(join(tmpdir(), 'dsh-theater-recovery-'))
    try {
      // Case 1: Persisted failed top-level Turn must not silently resume into active.
      const failedId = SessionId('performance-failed-resume')
      const writer = await setup(defaultPlan, (options) => {
        const sessionId = String(options.sessionId)
        if (sessionId.startsWith('performance-failed-resume/') && sessionId.endsWith('/characters/white')) {
          throw LlmError.fromFailure({ message: 'white exploded', code: 'WHITE_EXPLODED' })
        }
        return moveScript(
          sessionId,
          options.messages.filter(message => message.role === 'assistant').length,
          defaultPlan,
        )
      }, { persistenceRoot })
      await writer.theater.create({ performanceId: failedId, presetId: 'two-character-gomoku', cwd: FIXTURES })
      await expect(writer.theater.whenIdle(failedId)).rejects.toThrow('white exploded')
      await writer.fiber.dispose()

      let directorInvoked = false
      const reader = await setup(defaultPlan, undefined, { persistenceRoot })
      const resumedFailed = await reader.theater.resume({
        performanceId: failedId,
        wrapDirector: base => async (context) => {
          directorInvoked = true
          return await base(context)
        },
      })
      expect(resumedFailed).toMatchObject({
        phase: 'failed',
        activity: 'idle',
        error: 'white exploded',
        stages: { board1: { state: { moveNumber: 1 } } },
      })
      expect(directorInvoked).toBe(false)
      await expect(reader.theater.whenIdle(failedId)).rejects.toThrow('white exploded')

      // Recover via fork from the last completed Director Point (after black's move 1).
      const recoveredId = SessionId('performance-failed-recovered')
      await reader.theater.fork({
        sourcePerformanceId: failedId,
        cursor: resumedFailed.forkablePositions.at(-1)!,
        childPerformanceId: recoveredId,
      })
      await reader.theater.whenIdle(recoveredId)
      expect(reader.theater.read(recoveredId)).toMatchObject({
        phase: 'completed',
        stages: { board1: { state: { winner: 'black', moveNumber: 5 } } },
      })
      await reader.fiber.dispose()

      // Case 2: Unclosed Segment (simulated process crash mid-Turn / mid-nested-Turn) stays failed on resume.
      const crashedId = SessionId('performance-crashed-resume')
      const crashWriter = await setup(defaultPlan, undefined, { persistenceRoot })
      const limiter = createTurnLimitDirector(1)
      await crashWriter.theater.create({
        performanceId: crashedId,
        presetId: 'two-character-gomoku',
        cwd: FIXTURES,
        wrapDirector: base => limiter.wrap(base),
      })
      await limiter.whenReached()
      await crashWriter.theater.stop(crashedId)
      const crashSession = crashWriter.sessions.get(crashedId)!
      crashSession.append('theater/segment-started', { characterId: 'white' })
      crashSession.append('theater/segment-started', { characterId: 'black' })
      await crashWriter.sessions.flush(crashSession)
      await crashWriter.fiber.dispose()

      let crashDirectorInvoked = false
      const crashReader = await setup(defaultPlan, undefined, { persistenceRoot })
      const resumedCrash = await crashReader.theater.resume({
        performanceId: crashedId,
        wrapDirector: base => async (context) => {
          crashDirectorInvoked = true
          return await base(context)
        },
      })
      expect(resumedCrash.phase).toBe('failed')
      expect(resumedCrash.activity).toBe('idle')
      expect(resumedCrash.error).toContain('unclosed Character Segment')
      expect(crashDirectorInvoked).toBe(false)

      const crashRecoveredId = SessionId('performance-crashed-recovered')
      await crashReader.theater.fork({
        sourcePerformanceId: crashedId,
        cursor: resumedCrash.forkablePositions.at(-1)!,
        childPerformanceId: crashRecoveredId,
      })
      await crashReader.theater.whenIdle(crashRecoveredId)
      expect(crashReader.theater.read(crashRecoveredId)).toMatchObject({
        phase: 'completed',
        stages: { board1: { state: { winner: 'black', moveNumber: 5 } } },
      })
      await crashReader.fiber.dispose()
    } finally {
      await rm(persistenceRoot, { recursive: true, force: true })
    }
  })

  it('treats persisted configuration as authoritative on resume/fork while rejecting structural incompatibility (ADR-0006)', async () => {
    const original = {
      director: 'gomoku' as const,
      characters: [
        { id: 'black', systemPrompt: 'Original authoritative black prompt.', color: 'black' as const, read: true },
        { id: 'white', systemPrompt: 'Original authoritative white prompt.', color: 'white' as const, read: false },
      ],
      boardSize: 3,
    }

    // 1. Non-structural preset edits (systemPrompt, tools plan, stage params) stay compatible and persisted config remains authoritative.
    const evolveRoot = await mkdtemp(join(tmpdir(), 'dsh-theater-authoritative-'))
    try {
      const persistenceRoot = join(evolveRoot, 'sessions')
      const presetRoot = join(evolveRoot, 'presets')
      await writeCompatibilityPresets(presetRoot, original)
      const performanceId = SessionId('performance-authoritative')
      const writer = await setup(defaultPlan, undefined, {
        persistenceRoot,
        presetRoot,
        defaultPreset: 'compat',
      })
      const limiter = createTurnLimitDirector(1)
      await writer.theater.create({
        performanceId,
        presetId: 'compat',
        cwd: FIXTURES,
        wrapDirector: base => limiter.wrap(base),
      })
      await limiter.whenReached()
      await writer.theater.stop(performanceId)
      await writer.fiber.dispose()

      // Edit preset systemPrompt, remove read_board from black's tools, and change boardSize from 3 to 5.
      await writeCompatibilityPresets(presetRoot, {
        director: 'gomoku',
        characters: [
          { id: 'black', systemPrompt: 'Mutated black prompt that must NOT overwrite persisted snapshot.', color: 'black', read: false },
          { id: 'white', systemPrompt: 'Mutated white prompt that must NOT overwrite persisted snapshot.', color: 'white', read: false },
        ],
        boardSize: 5,
      })

      const observedSystems = new Map<string, string | undefined>()
      const reader = await setup(defaultPlan, (options) => {
        const sessionId = String(options.sessionId)
        observedSystems.set(sessionId, extractSystemPrompt(options))
        return moveScript(
          sessionId,
          options.messages.filter(message => message.role === 'assistant').length,
          defaultPlan,
        )
      }, {
        persistenceRoot,
        presetRoot,
        defaultPreset: 'compat',
      })

      const resumed = await reader.theater.resume({ performanceId })
      expect(resumed.phase).toBe('active')
      await reader.theater.whenIdle(performanceId)

      const completed = reader.theater.read(performanceId)
      expect(completed.phase).toBe('completed')
      expect(completed.stages.board1).toMatchObject({
        configuration: { config: { boardSize: 3, winLength: 3 } },
        state: { winner: 'black', moveNumber: 5 },
      })
      // Persisted systemPrompt and tools (including black's read_board!) remained authoritative.
      expect(observedSystems.get(String(characterSessionId(performanceId, 'black'))))
        .toContain('Original authoritative black prompt.')
      expect(observedSystems.get(String(characterSessionId(performanceId, 'white'))))
        .toContain('Original authoritative white prompt.')
      expect(reader.tools.schemas(reader.agents.get(characterSessionId(performanceId, 'black'))!).map(tool => tool.name))
        .toEqual(['read_board', 'place_stone'])

      // Forking also inherits the source's persisted configuration snapshot verbatim.
      const forkedId = SessionId('performance-authoritative-fork')
      await reader.theater.fork({
        sourcePerformanceId: performanceId,
        cursor: completed.forkablePositions[0]!,
        childPerformanceId: forkedId,
      })
      await reader.theater.whenIdle(forkedId)
      expect(observedSystems.get(String(characterSessionId(forkedId, 'black'))))
        .toContain('Original authoritative black prompt.')
      expect(reader.theater.read(forkedId).stages.board1?.configuration.config).toEqual({
        boardSize: 3,
        winLength: 3,
      })
      await reader.fiber.dispose()
    } finally {
      await rm(evolveRoot, { recursive: true, force: true })
    }

    // 2. Structural incompatibilities (roster change, Stage ID change) still fail into incompatible while preserving historical reads.
    const incompatibleCases = [
      {
        name: 'roster',
        current: {
          director: 'complete' as const,
          characters: [original.characters[0]!],
          boardSize: 3,
        },
      },
      {
        name: 'Stage declaration set',
        current: {
          director: 'complete' as const,
          characters: original.characters,
          boardSize: 3,
          stages: [
            { id: 'board1', machine: 'gomoku', boardSize: 3 },
            { id: 'board2', machine: 'gomoku', boardSize: 3 },
          ],
        },
      },
    ] as const

    for (const scenario of incompatibleCases) {
      const root = await mkdtemp(join(tmpdir(), 'dsh-theater-incompatible-'))
      const persistenceRoot = join(root, 'sessions')
      const presetRoot = join(root, 'presets')
      try {
        await writeCompatibilityPresets(presetRoot, { ...original, director: 'complete' })
        const performanceId = SessionId(`performance-incompatible-${scenario.name}`)
        const writer = await setup(defaultPlan, undefined, {
          persistenceRoot,
          presetRoot,
          defaultPreset: 'compat',
        })
        await writer.theater.create({ performanceId, presetId: 'compat', cwd: FIXTURES })
        await writer.theater.whenIdle(performanceId)
        expect(writer.theater.read(performanceId).phase).toBe('completed')
        await writer.fiber.dispose()

        await writeCompatibilityPresets(presetRoot, scenario.current)
        const reader = await setup(defaultPlan, undefined, {
          persistenceRoot,
          presetRoot,
          defaultPreset: 'compat',
        })
        const historical = await reader.theater.resume({ performanceId })

        expect(historical.phase, scenario.name).toBe('incompatible')
        expect(historical.characters, scenario.name).toEqual({
          black: characterSessionId(performanceId, 'black'),
          white: characterSessionId(performanceId, 'white'),
        })
        expect(historical.stages.board1?.state, scenario.name).toMatchObject({ moveNumber: 0 })
        await expect(reader.theater.whenIdle(performanceId)).rejects.toThrow('incompatible')
        await reader.fiber.dispose()
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    }
  })

  it('runs Stage-free zero-tool Characters without mounting dsh-stage and exposes structured Turn reads and abortTurn to Tools (ADR-0009)', async () => {
    const presetRoot = await mkdtemp(join(tmpdir(), 'dsh-theater-stagefree-'))
    let ctx: Context | undefined
    try {
      await mkdir(join(presetRoot, 'stagefree'), { recursive: true })
      await writeFile(join(presetRoot, 'stagefree', 'agent.cordis.yml'), [
        '- id: performance',
        "  name: '@darwintree/dsh-theater/preset'",
        '  config:',
        '    characters:',
        '      narrator:',
        '        systemPrompt: You speak without tools.',
        '        tools: []',
        '      inspector:',
        '        systemPrompt: You inspect structured Turn reads.',
        '        tools:',
        '          - factory: inspect-turn',
        '          - factory: abort-turn',
        '- id: director',
        `  name: ${JSON.stringify(join(FIXTURES, 'plugins', 'complete-director.js'))}`,
        '',
      ].join('\n'))

      let capturedCurrent: ActiveCharacterTurnRead | undefined
      let capturedSettled: readonly CharacterTurnRead[] | undefined

      const inspectFactory: TheaterToolFactory = {
        kind: 'inspect-turn',
        resolveConfig: () => ({}),
        create(_config, context) {
          return defineTool({
            name: 'inspect_turn',
            description: 'Inspect structured current and settled Turn views.',
            parameters: { note: { type: 'string', required: true } },
            output: {
              schema: { type: 'string' },
              render: (_args, value) => [{ type: 'text', text: value }],
            },
            async execute() {
              capturedCurrent = context.readCurrentTurn()
              capturedSettled = context.readSettledTurns()
              return 'inspected'
            },
          })
        },
      }
      const abortFactory: TheaterToolFactory = {
        kind: 'abort-turn',
        resolveConfig: () => ({}),
        create(_config, context) {
          return defineTool({
            name: 'abort_turn',
            description: 'Abort the current Turn with a domain reason.',
            parameters: { reason: { type: 'string', required: true } },
            output: { schema: { type: 'null' }, render: () => [] },
            async execute(args) {
              return context.abortTurn(args.reason)
            },
          })
        },
      }

      ctx = await setup(defaultPlan, (options) => {
        const sessionId = String(options.sessionId)
        const count = options.messages.filter(message => message.role === 'assistant').length
        if (sessionId.endsWith('/characters/narrator')) {
          return { content: [{ type: 'text', text: 'Opening narration.' }] }
        }
        if (sessionId.startsWith('stagefree-ok/') && sessionId.endsWith('/characters/inspector')) {
          if (count === 0) {
            return {
              content: [
                { type: 'text', text: 'Checking context.' },
                { type: 'tool-call', id: 'inspect-1', name: 'inspect_turn', arguments: JSON.stringify({ note: 'hi' }) },
              ],
            }
          }
          return { content: [{ type: 'text', text: 'Done inspecting.' }] }
        }
        if (sessionId.startsWith('stagefree-abort/') && sessionId.endsWith('/characters/inspector')) {
          return {
            content: [
              { type: 'tool-call', id: 'abort-1', name: 'abort_turn', arguments: JSON.stringify({ reason: 'fatal protocol abort' }) },
            ],
          }
        }
        throw new Error(`unexpected request for ${sessionId}`)
      }, {
        presetRoot,
        defaultPreset: 'stagefree',
        mountStage: false,
      })

      expect(ctx.get('stages' as never)).toBeUndefined()
      ctx.theater.registerToolFactory(inspectFactory)
      ctx.theater.registerToolFactory(abortFactory)

      const okId = SessionId('stagefree-ok')
      await ctx.theater.create({
        performanceId: okId,
        presetId: 'stagefree',
        cwd: FIXTURES,
        director: async (context) => {
          const turns = context.readSettledTurns()
          if (turns.length === 0) return { kind: 'act', characterId: 'narrator', instruction: [{ type: 'text', text: 'Speak.' }] }
          if (turns.length === 1) return { kind: 'act', characterId: 'inspector', instruction: [{ type: 'text', text: 'Inspect.' }] }
          return { kind: 'complete' }
        },
      })
      await ctx.theater.whenIdle(okId)

      expect(ctx.theater.read(okId)).toMatchObject({ phase: 'completed', stages: {} })
      expect(ctx.tools.schemas(ctx.agents.get(characterSessionId(okId, 'narrator'))!)).toEqual([])
      expect(capturedSettled).toHaveLength(1)
      expect(capturedSettled![0]).toEqual({
        characterId: 'narrator',
        outcome: 'completed',
        entries: [{ kind: 'text', text: 'Opening narration.' }],
        toolCalls: [],
      })
      expect(capturedCurrent).toMatchObject({
        characterId: 'inspector',
        entries: [
          { kind: 'text', text: 'Checking context.' },
          { kind: 'tool-call', callId: 'inspect-1', name: 'inspect_turn', arguments: { note: 'hi' } },
        ],
      })

      // Explicit abortTurn propagates its domain reason cleanly and halts the Performance.
      const abortId = SessionId('stagefree-abort')
      await ctx.theater.create({
        performanceId: abortId,
        presetId: 'stagefree',
        cwd: FIXTURES,
        director: async () => ({
          kind: 'act',
          characterId: 'inspector',
          instruction: [{ type: 'text', text: 'Abort now.' }],
        }),
      })
      await expect(ctx.theater.whenIdle(abortId)).rejects.toThrow('fatal protocol abort')
      const aborted = ctx.theater.read(abortId)
      expect(aborted).toMatchObject({ phase: 'failed', activity: 'idle', error: 'fatal protocol abort' })
      expect(aborted.forkablePositions).toHaveLength(1)
    } finally {
      await ctx?.fiber.dispose()
      await rm(presetRoot, { recursive: true, force: true })
    }
  })

  it('requires exactly one Director and makes a Theater preset unavailable without Theater support', async () => {
    const unsupported = await setup(defaultPlan, undefined, { mountTheater: false })
    await expect(unsupported.agentPresets.acquireScope('two-character-gomoku'))
      .rejects.toThrow(/waiting for theater/)

    const ctx = await setup()
    await expect(ctx.agentPresets.acquireScope('missing-system-prompt'))
      .rejects.toThrow('must declare a non-empty System Prompt')
    await expect(ctx.theater.create({
      performanceId: SessionId('performance-not-theater'),
      presetId: 'not-theater',
      cwd: FIXTURES,
    })).rejects.toThrow('exactly one Theater Director; found 0')
    await expect(ctx.theater.create({
      performanceId: SessionId('performance-duplicate-theater'),
      presetId: 'duplicate-theater',
      cwd: FIXTURES,
    })).rejects.toThrow('exactly one Theater Director; found 2')

    await expect(ctx.theater.create({
      performanceId: SessionId('performance-empty-cwd'),
      presetId: 'complete-theater',
      cwd: '',
    })).rejects.toThrow('Performance cwd must be non-empty')

    const completedId = SessionId('performance-director-complete')
    await ctx.theater.create({ performanceId: completedId, presetId: 'complete-theater', cwd: FIXTURES })
    await ctx.theater.whenIdle(completedId)
    expect(ctx.theater.read(completedId)).toMatchObject({
      phase: 'completed',
      stages: { board1: { completed: false, state: { isFinished: false } } },
    })
    expect(ctx.sessions.get(completedId)?.snapshotEvents().some(event =>
      event.type === 'theater/segment-started')).toBe(false)
  })

  it('routes the same Stage ID independently for two Performance Sessions', async () => {
    const plan: MovePlan = sessionId => sessionId.startsWith('performance-stage-second/')
      ? sessionId.endsWith('/characters/black')
        ? [[0, 0], [0, 1], [0, 2]]
        : [[1, 0], [1, 1]]
      : defaultPlan(sessionId)
    const ctx = await setup(plan)
    const firstId = SessionId('performance-stage-first')
    const secondId = SessionId('performance-stage-second')

    await ctx.theater.create({ performanceId: firstId, presetId: 'two-character-gomoku', cwd: FIXTURES })
    await ctx.theater.whenIdle(firstId)
    await ctx.theater.create({ performanceId: secondId, presetId: 'two-character-gomoku', cwd: FIXTURES })
    await ctx.theater.whenIdle(secondId)

    expect(ctx.theater.read(firstId).stages.board1?.state).toMatchObject({
      lastMove: { x: 2, y: 0 },
      winner: 'black',
    })
    expect(ctx.theater.read(secondId).stages.board1?.state).toMatchObject({
      lastMove: { x: 0, y: 2 },
      winner: 'black',
    })
    expect(ctx.sessions.get(firstId)?.snapshotEvents().filter(event => event.type === 'stage/op')).toHaveLength(5)
    expect(ctx.sessions.get(secondId)?.snapshotEvents().filter(event => event.type === 'stage/op')).toHaveLength(5)
  })

  it('distinguishes executing-turn activity and aborts an in-flight Turn into failed phase on stop() (ADR-0007, ADR-0008)', async () => {
    const presetRoot = await mkdtemp(join(tmpdir(), 'dsh-theater-midturn-stop-'))
    let ctx: Context | undefined
    try {
      await mkdir(join(presetRoot, 'midturn'), { recursive: true })
      await writeFile(join(presetRoot, 'midturn', 'agent.cordis.yml'), [
        '- id: performance',
        "  name: '@darwintree/dsh-theater/preset'",
        '  config:',
        '    characters:',
        '      worker:',
        '        systemPrompt: You run a blocking tool.',
        '        tools:',
        '          - factory: slow-tool',
        '- id: director',
        `  name: ${JSON.stringify(join(FIXTURES, 'plugins', 'complete-director.js'))}`,
        '',
      ].join('\n'))

      const toolEntered = Promise.withResolvers<void>()
      let observedActivityDuringTool: string | undefined
      const slowFactory: TheaterToolFactory = {
        kind: 'slow-tool',
        resolveConfig: () => ({}),
        create() {
          return defineTool({
            name: 'slow_tool',
            description: 'Wait until aborted.',
            parameters: {},
            output: { schema: { type: 'null' }, render: () => [] },
            async execute(_args, exec) {
              observedActivityDuringTool = ctx!.theater.read(SessionId('performance-midturn-stop')).activity
              toolEntered.resolve()
              await new Promise<void>((_, reject) => {
                if (exec.signal.aborted) {
                  reject(new Error('aborted'))
                  return
                }
                exec.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
              })
              return null
            },
          })
        },
      }

      ctx = await setup(defaultPlan, () => ({
        content: [{ type: 'tool-call', id: 'slow-1', name: 'slow_tool', arguments: '{}' }],
      }), {
        presetRoot,
        defaultPreset: 'midturn',
        mountStage: false,
      })
      ctx.theater.registerToolFactory(slowFactory)

      const performanceId = SessionId('performance-midturn-stop')
      await ctx.theater.create({
        performanceId,
        presetId: 'midturn',
        cwd: FIXTURES,
        director: async () => ({
          kind: 'act',
          characterId: 'worker',
          instruction: [{ type: 'text', text: 'Run slow tool.' }],
        }),
      })
      await toolEntered.promise
      expect(observedActivityDuringTool).toBe('executing-turn')

      const stopped = await ctx.theater.stop(performanceId)
      expect(stopped).toMatchObject({ phase: 'failed', activity: 'idle' })
      expect(stopped.forkablePositions).toHaveLength(1)
    } finally {
      await ctx?.fiber.dispose()
      await rm(presetRoot, { recursive: true, force: true })
    }
  })

  it('marks resume incompatible when a required persisted ToolFactory is missing (ADR-0006)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-theater-missing-tool-'))
    const persistenceRoot = join(root, 'sessions')
    try {
      const performanceId = SessionId('performance-missing-tool-factory')
      const writer = await setup(defaultPlan, undefined, { persistenceRoot })
      const limiter = createTurnLimitDirector(1)
      await writer.theater.create({
        performanceId,
        presetId: 'two-character-gomoku',
        cwd: FIXTURES,
        wrapDirector: base => limiter.wrap(base),
      })
      await limiter.whenReached()
      await writer.theater.stop(performanceId)
      await writer.fiber.dispose()

      // Mount Theater and Stage, but omit GomokuTheater (which registers gomoku-read-board / gomoku-place-stone).
      const reader = await createDshTestContext({
        baseDir: FIXTURES,
        persistenceRoot,
        presets: {
          default: 'two-character-gomoku',
          dirs: [join(FIXTURES, 'presets')],
        },
      })
      await reader.plugin(Gomoku)
      const resumed = await reader.theater.resume({ performanceId })
      expect(resumed.phase).toBe('incompatible')
      expect(resumed.error).toContain('missing "gomoku-read-board"')
      expect(resumed.stages.board1?.state).toMatchObject({ moveNumber: 1 })
      await reader.fiber.dispose()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
