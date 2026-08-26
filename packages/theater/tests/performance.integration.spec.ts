import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentDefaultModel from '@deepseek-ai/dsh-agent-default-model'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import AgentPresets from '@deepseek-ai/dsh-agent-presets'
import LlmRuntime, { LlmError } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import { describe, expect, it } from 'vitest'
import { MockLlmAdapter, type Behaviour, type MockResponse } from '@darwintree/dsh-llm-mock'
import StageService from '@darwintree/dsh-stage'
import * as Gomoku from '../../theater-gomoku/src/index.ts'
import * as GomokuTheater from '../../theater-gomoku/src/theater.ts'
import TheaterService, { characterSessionId } from '../src/index.ts'

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
  } = {},
): Promise<Context> {
  const ctx = new Context()
  ctx.baseUrl = pathToFileURL(FIXTURES).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  if (options.persistenceRoot !== undefined) {
    await ctx.plugin(JsonlSessionPersistence, {
      root: options.persistenceRoot,
      compression: 'none',
    })
  }
  await ctx.plugin(StageService)
  await ctx.plugin(Gomoku)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [], maxParallelToolCalls: 1 })
  await ctx.plugin(AgentDefaultModel, { provider: 'mock', model: 'scripted' })
  await ctx.plugin(AgentPresets, {
    default: options.defaultPreset ?? 'two-character-gomoku',
    roots: [{ path: options.presetRoot ?? join(FIXTURES, 'presets'), trust: 'system' }],
    includeUserRoot: false,
  })
  ctx.llm.registerAdapter(['mock'], new MockLlmAdapter(behaviour ?? (options =>
    moveScript(
      String(options.sessionId),
      options.messages.filter(message => message.role === 'assistant').length,
      plan,
    ))))
  if (options.mountTheater !== false) {
    await ctx.plugin(TheaterService)
    await ctx.plugin(GomokuTheater)
  }
  return ctx
}

async function writeCompatibilityPresets(
  root: string,
  config: {
    characters: readonly { id: string; color: 'black' | 'white'; read: boolean }[]
    boardSize: number
  },
): Promise<void> {
  const stagePreset = join(FIXTURES, '..', '..', '..', 'stage', 'dist', 'preset.js')
  const theaterPreset = join(FIXTURES, '..', '..', 'dist', 'preset.js')
  const director = join(FIXTURES, 'plugins', 'complete-director.js')
  const rows = config.characters.flatMap(character => [
    `      ${character.id}:`,
    '        tools:',
    ...character.read ? [
      '          - factory: gomoku-read-board',
      '            params: { stage: board1 }',
    ] : [],
    '          - factory: gomoku-place-stone',
    `            params: { stage: board1, color: ${character.color} }`,
  ]).join('\n')
  await mkdir(join(root, 'compat'), { recursive: true })
  await writeFile(join(root, 'compat', 'agent.cordis.yml'), [
    '- id: stages',
    `  name: ${JSON.stringify(stagePreset)}`,
    '  config:',
    '    stages:',
    '      board1:',
    '        machine: gomoku',
    `        params: { boardSize: ${config.boardSize}, winLength: 3 }`,
    '- id: performance',
    `  name: ${JSON.stringify(theaterPreset)}`,
    '  config:',
    '    characters:',
    rows,
    '- id: director',
    `  name: ${JSON.stringify(director)}`,
    '',
  ].join('\n'))
}

describe('Performance Theater', () => {
  it('owns the Main Loop and repeatedly evaluates a single-step Director until terminal Stage state', async () => {
    const ctx = await setup()
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
        lastType: session.events.at(-1)?.type,
        blackSeq: ctx.sessions.get(characterSessionId(performanceId, 'black'))?.seq,
        whiteSeq: ctx.sessions.get(characterSessionId(performanceId, 'white'))?.seq,
      })
    })

    await ctx.theater.create({ performanceId, presetId: 'two-character-gomoku' })
    await ctx.theater.whenIdle(performanceId)

    const performance = ctx.theater.read(performanceId)
    expect(performance.status).toBe('completed')
    expect(performance.stages.board1).toMatchObject({
      state: { moveNumber: 5, winner: 'black', isFinished: true },
    })
    expect(performance.characters).toEqual({
      black: characterSessionId(performanceId, 'black'),
      white: characterSessionId(performanceId, 'white'),
    })

    const session = ctx.sessions.get(performanceId)!
    expect(session.header.agentPreset).toBeUndefined()
    expect(session.events.find(event => event.type === 'theater/configured')).toMatchObject({
      data: { presetId: 'two-character-gomoku' },
    })
    expect(session.events.filter(event => event.type === 'stage/op')).toHaveLength(5)
    expect(session.events.some(event => event.type === 'user/message')).toBe(false)
    expect(session.events.some(event => event.type === 'assistant/message')).toBe(false)
    expect(session.events.some(event => event.type === 'tool/call')).toBe(false)
    expect(session.events.some(event => event.type === 'tool/result')).toBe(false)
    expect(session.events.filter(event => event.type === 'theater/segment-started')).toHaveLength(5)
    expect(session.events.filter(event => event.type === 'theater/segment-ended')).toHaveLength(5)
    expect(performance.forkablePositions).toHaveLength(6)

    const firstStartFlush = flushes.find(flush =>
      flush.sessionId === performanceId && flush.lastType === 'theater/segment-started')
    expect(firstStartFlush).toMatchObject({ blackSeq: 1, whiteSeq: 1 })
    for (const end of session.events.filter(event => event.type === 'theater/segment-ended')) {
      const checkpoint = flushes.find(flush =>
        flush.sessionId === performanceId
        && flush.lastType === 'theater/segment-ended'
        && flush[end.data.characterId === 'black' ? 'blackSeq' : 'whiteSeq'] === end.data.characterSessionSeq)
      expect(checkpoint).toBeDefined()
    }
    const boundaries = session.events
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
      expect(characterSession.header.agentPreset).toBeUndefined()
      expect(characterSession.events.some(event => event.type === 'agent-preset/selected')).toBe(false)
      expect(characterSession.events.some(event => event.type === 'user/message')).toBe(true)
      expect(characterSession.events.some(event => event.type === 'tool/call')).toBe(true)
      expect(characterSession.events.some(event => event.type === 'stage/op')).toBe(false)
      expect(JSON.stringify(characterSession.events)).not.toContain('stage/op')
    }
    const black = ctx.agents.get(characterSessionId(performanceId, 'black'))!
    const white = ctx.agents.get(characterSessionId(performanceId, 'white'))!
    expect(ctx.tools.schemas(black).map(tool => tool.name)).toEqual(['read_board', 'place_stone'])
    expect(ctx.tools.schemas(white).map(tool => tool.name)).toEqual(['place_stone'])
  })

  it('forks initial and settled Director Points with Character watermarks and rejects an open Segment cursor atomically', async () => {
    const childPlan: MovePlan = sessionId => sessionId.startsWith('performance-fork-child/')
      ? sessionId.endsWith('/characters/black')
        ? [[0, 2], [1, 2], [2, 2]]
        : [[0, 1], [1, 1]]
      : defaultPlan(sessionId)
    const ctx = await setup(childPlan)
    const sourceId = SessionId('performance-fork-source')
    await ctx.theater.create({ performanceId: sourceId, presetId: 'two-character-gomoku' })
    await ctx.theater.whenIdle(sourceId)
    const source = ctx.theater.read(sourceId)
    const sourceSession = ctx.sessions.get(sourceId)!

    const open = sourceSession.events.find(event => event.type === 'theater/segment-started')!
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
    expect(ctx.sessions.get(characterSessionId(initialId, 'black'))?.header).toMatchObject({
      parentSession: characterSessionId(sourceId, 'black'),
      seedLength: 0,
    })

    const laterCursor = source.forkablePositions[2]!
    const laterId = SessionId('performance-fork-later')
    await ctx.theater.fork({
      sourcePerformanceId: sourceId,
      cursor: laterCursor,
      childPerformanceId: laterId,
    })
    const later = ctx.theater.read(laterId)
    expect(later.lineage).toEqual({ parentSession: sourceId, seedLength: laterCursor })
    const prefixEnds = sourceSession.events.slice(0, laterCursor)
      .filter(event => event.type === 'theater/segment-ended')
    for (const character of ['black', 'white'] as const) {
      const watermark = prefixEnds
        .filter(event => event.data.characterId === character)
        .at(-1)?.data.characterSessionSeq ?? 0
      expect(ctx.sessions.get(characterSessionId(laterId, character))?.header).toMatchObject({
        parentSession: characterSessionId(sourceId, character),
        seedLength: watermark,
      })
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

    await ctx.theater.create({ performanceId, presetId: 'two-character-gomoku' })
    await ctx.theater.whenIdle(performanceId)

    const performance = ctx.theater.read(performanceId)
    const session = ctx.sessions.get(performanceId)!
    const starts = session.events.filter(event => event.type === 'theater/segment-started')
    expect(starts.slice(0, 2).map(event => event.data.characterId)).toEqual(['black', 'black'])
    expect(starts).toHaveLength(6)
    expect(session.events.filter(event => event.type === 'stage/op')).toHaveLength(5)
    const black = ctx.sessions.get(characterSessionId(performanceId, 'black'))!
    const results = black.events.filter(event => event.type === 'tool/result')
    expect(results.some(event => JSON.stringify(event.data).includes('coordinate is outside the board'))).toBe(true)
    expect(performance.stages.board1?.state).toMatchObject({ winner: 'black', moveNumber: 5 })
  })

  it('durably ends a failed Segment, stops the Theater Main Loop, and recovers from a fork', async () => {
    const ctx = await setup(defaultPlan, (options) => {
      const sessionId = String(options.sessionId)
      if (sessionId.startsWith('performance-failure/') && sessionId.endsWith('/characters/black')) {
        throw new LlmError('scripted Character failure', 'SCRIPTED_FAILURE')
      }
      return moveScript(
        sessionId,
        options.messages.filter(message => message.role === 'assistant').length,
        defaultPlan,
      )
    })
    const sourceId = SessionId('performance-failure')

    await ctx.theater.create({ performanceId: sourceId, presetId: 'two-character-gomoku' })
    await expect(ctx.theater.whenIdle(sourceId)).rejects.toThrow('scripted Character failure')

    const failed = ctx.theater.read(sourceId)
    const session = ctx.sessions.get(sourceId)!
    expect(failed.status).toBe('failed')
    expect(session.events.at(-1)).toMatchObject({
      type: 'theater/segment-ended',
      data: { characterId: 'black', outcome: 'error' },
    })
    expect(failed.forkablePositions.at(-1)).toBe(session.events.length)
    expect(failed.stages.board1?.state).toMatchObject({ moveNumber: 0 })

    const childId = SessionId('performance-recovered')
    await ctx.theater.fork({
      sourcePerformanceId: sourceId,
      cursor: failed.forkablePositions.at(-1)!,
      childPerformanceId: childId,
    })
    await ctx.theater.whenIdle(childId)
    expect(ctx.theater.read(childId)).toMatchObject({
      status: 'completed',
      stages: { board1: { state: { winner: 'black', moveNumber: 5 } } },
    })
  })

  it('cold-resumes the Theater Main Loop from durable state without replaying a call stack', async () => {
    const persistenceRoot = await mkdtemp(join(tmpdir(), 'dsh-theater-resume-'))
    try {
      const performanceId = SessionId('performance-cold-resume')
      const writer = await setup(defaultPlan, (options) => {
        const sessionId = String(options.sessionId)
        if (sessionId.endsWith('/characters/black')) {
          throw new LlmError('writer stopped', 'WRITER_STOPPED')
        }
        return moveScript(
          sessionId,
          options.messages.filter(message => message.role === 'assistant').length,
          defaultPlan,
        )
      }, { persistenceRoot })
      await writer.theater.create({ performanceId, presetId: 'two-character-gomoku' })
      await expect(writer.theater.whenIdle(performanceId)).rejects.toThrow('writer stopped')
      await writer.fiber.dispose()

      const reader = await setup(defaultPlan, undefined, { persistenceRoot })
      await reader.theater.resume({ performanceId })
      await reader.theater.whenIdle(performanceId)

      const resumed = reader.theater.read(performanceId)
      expect(resumed).toMatchObject({
        status: 'completed',
        stages: { board1: { state: { winner: 'black', moveNumber: 5 } } },
      })
      const performance = reader.sessions.get(performanceId)!
      expect(performance.events.filter(event => event.type === 'theater/segment-ended')[0]).toMatchObject({
        data: { outcome: 'error' },
      })
      expect(performance.events.filter(event => event.type === 'theater/segment-ended').at(-1)).toMatchObject({
        data: { outcome: 'completed' },
      })
      await reader.fiber.dispose()
    } finally {
      await rm(persistenceRoot, { recursive: true, force: true })
    }
  })

  it('keeps historical reads available while refusing incompatible roster, Character Tool plan, or Stage config', async () => {
    const original = {
      characters: [
        { id: 'black', color: 'black' as const, read: true },
        { id: 'white', color: 'white' as const, read: false },
      ],
      boardSize: 3,
    }
    const cases = [
      {
        name: 'roster',
        current: { characters: [original.characters[0]!], boardSize: 3 },
      },
      {
        name: 'Character Tool plan',
        current: {
          characters: [
            { ...original.characters[0]!, read: false },
            original.characters[1]!,
          ],
          boardSize: 3,
        },
      },
      {
        name: 'Stage config',
        current: { characters: original.characters, boardSize: 4 },
      },
    ] as const

    for (const scenario of cases) {
      const root = await mkdtemp(join(tmpdir(), 'dsh-theater-incompatible-'))
      const persistenceRoot = join(root, 'sessions')
      const presetRoot = join(root, 'presets')
      try {
        await writeCompatibilityPresets(presetRoot, original)
        const performanceId = SessionId(`performance-incompatible-${scenario.name}`)
        const writer = await setup(defaultPlan, undefined, {
          persistenceRoot,
          presetRoot,
          defaultPreset: 'compat',
        })
        await writer.theater.create({ performanceId, presetId: 'compat' })
        await writer.theater.whenIdle(performanceId)
        expect(writer.theater.read(performanceId).status).toBe('completed')
        await writer.fiber.dispose()

        await writeCompatibilityPresets(presetRoot, scenario.current)
        const reader = await setup(defaultPlan, undefined, {
          persistenceRoot,
          presetRoot,
          defaultPreset: 'compat',
        })
        const historical = await reader.theater.resume({ performanceId })

        expect(historical.status, scenario.name).toBe('incompatible')
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

  it('requires exactly one Director and makes a Theater preset unavailable without Theater support', async () => {
    const unsupported = await setup(defaultPlan, undefined, { mountTheater: false })
    await expect(unsupported.agentPresets.standingKeyFor('two-character-gomoku'))
      .rejects.toThrow(/waiting for theater/)

    const ctx = await setup()
    await expect(ctx.theater.create({
      performanceId: SessionId('performance-not-theater'),
      presetId: 'not-theater',
    })).rejects.toThrow('exactly one Theater Director; found 0')
    await expect(ctx.theater.create({
      performanceId: SessionId('performance-duplicate-theater'),
      presetId: 'duplicate-theater',
    })).rejects.toThrow('exactly one Theater Director; found 2')

    const completedId = SessionId('performance-director-complete')
    await ctx.theater.create({ performanceId: completedId, presetId: 'complete-theater' })
    await ctx.theater.whenIdle(completedId)
    expect(ctx.theater.read(completedId)).toMatchObject({
      status: 'completed',
      stages: { board1: { completed: false, state: { isFinished: false } } },
    })
    expect(ctx.sessions.get(completedId)?.events.some(event =>
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

    await ctx.theater.create({ performanceId: firstId, presetId: 'two-character-gomoku' })
    await ctx.theater.whenIdle(firstId)
    await ctx.theater.create({ performanceId: secondId, presetId: 'two-character-gomoku' })
    await ctx.theater.whenIdle(secondId)

    expect(ctx.theater.read(firstId).stages.board1?.state).toMatchObject({
      lastMove: { x: 2, y: 0 },
      winner: 'black',
    })
    expect(ctx.theater.read(secondId).stages.board1?.state).toMatchObject({
      lastMove: { x: 0, y: 2 },
      winner: 'black',
    })
    expect(ctx.sessions.get(firstId)?.events.filter(event => event.type === 'stage/op')).toHaveLength(5)
    expect(ctx.sessions.get(secondId)?.events.filter(event => event.type === 'stage/op')).toHaveLength(5)
  })
})
