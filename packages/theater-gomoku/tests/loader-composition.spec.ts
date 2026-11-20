import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Include, { entryListSchema, type PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { CallId } from '@deepseek-ai/dsh-llm'
import { createScope } from '@deepseek-ai/dsh-scope'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import yaml from 'js-yaml'
import { afterEach, describe, expect, it } from 'vitest'
import * as TheaterPlugin from '@darwintree/dsh-theater'
import * as GomokuPlugin from '../src/index.js'
import { foldGomokuState, gomokuScenario, type GomokuConfig } from '../src/index.js'

const theaterPatchPath = fileURLToPath(new URL('../../theater/cordis.patch.yml', import.meta.url))
const gomokuPatchPath = fileURLToPath(new URL('../cordis.patch.yml', import.meta.url))

async function loadPatchFile(path: string): Promise<PatchOptions[]> {
  const raw = await readFile(path, 'utf8')
  const parsed = yaml.load(raw, { schema: entryListSchema })
  if (!Array.isArray(parsed)) throw new Error(`expected YAML patch array in ${path}`)
  return parsed as PatchOptions[]
}

let tempDir: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (tempDir !== undefined) await rm(tempDir, { recursive: true, force: true })
  tempDir = undefined
})

async function bootComposition(patches: PatchOptions[]) {
  tempDir = await mkdtemp(join(tmpdir(), 'dsh-theater-gomoku-loader-'))
  const configPath = join(tempDir, 'cordis.yml')
  await writeFile(configPath, [
    "- id: session",
    "  name: '@deepseek-ai/dsh-session'",
    "- id: system-prompt",
    "  name: '@deepseek-ai/dsh-system-prompt'",
    "- id: tools",
    "  name: '@deepseek-ai/dsh-tools'",
    '',
  ].join('\n'))

  context = new Context()
  context.baseUrl = `${pathToFileURL(tempDir).href}/`
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-session', SessionStore],
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['@darwintree/dsh-theater', TheaterPlugin],
    ['@darwintree/dsh-theater-gomoku', GomokuPlugin],
  ])
  context.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof context.loader.internal>

  const includeId = await context.loader.create({
    name: 'cordis:include',
    config: {
      path: pathToFileURL(configPath).href,
      patches,
    },
  })
  await context.loader.await()
  const includeEntry = [...context.loader.entries()].find(entry => entry.id === includeId)
  if (includeEntry === undefined) throw new Error(`missing include entry: ${includeId}`)
  return { ctx: context, configPath, includeEntry }
}

describe('Gomoku Cordis Loader composition & tool pipeline', () => {
  it('exports a Loader-safe named plugin without a default export', () => {
    expect('default' in GomokuPlugin).toBe(false)
    expect(GomokuPlugin.inject).toEqual(['theater'])
    expect(typeof GomokuPlugin.apply).toBe('function')
  })

  it('mounts optional Gomoku bundle in any patch order and supports disabling it independently', async () => {
    const theaterPatches = await loadPatchFile(theaterPatchPath)
    const gomokuPatches = await loadPatchFile(gomokuPatchPath)

    // Apply gomoku BEFORE theater to verify service-availability activation regardless of order.
    const { ctx, configPath, includeEntry } = await bootComposition([
      ...gomokuPatches,
      ...theaterPatches,
    ])

    const pending = [...ctx.loader.entries()].filter(entry => entry.fiber === undefined && !entry.disabled)
    expect(pending).toEqual([])
    expect(ctx.get('sessions')).toBeDefined()
    expect(ctx.get('tools')).toBeDefined()
    expect(ctx.get('theater')).toBeDefined()
    expect(ctx.theater.listScenarios()).toEqual(['gomoku'])

    // Disabling the optional Gomoku row removes only Gomoku while leaving Theater ready.
    await includeEntry.update({
      config: {
        path: pathToFileURL(configPath).href,
        patches: [...gomokuPatches, ...theaterPatches, { id: 'theater-gomoku', disabled: true }],
      },
    })
    await ctx.loader.await()
    expect(ctx.theater.listScenarios()).toEqual([])
  })

  it('runs place_stone through real ToolRuntime, scoped character contexts, and SessionStore flush', async () => {
    const theaterPatches = await loadPatchFile(theaterPatchPath)
    const gomokuPatches = await loadPatchFile(gomokuPatchPath)
    const { ctx } = await bootComposition([...theaterPatches, ...gomokuPatches])

    let flushes = 0
    ctx.on('session/flush', () => {
      flushes += 1
    })

    const blackSession = ctx.sessions.create(SessionId('agent:black'))
    const whiteSession = ctx.sessions.create(SessionId('agent:white'))

    const performance = await ctx.theater.create<GomokuConfig>({
      performanceId: 'gomoku-1',
      scenarioId: 'gomoku',
      config: { boardSize: 9, winLength: 5 },
      characterSessions: {
        black: blackSession.id,
        white: whiteSession.id,
      },
    })
    expect(flushes).toBe(1)

    // Mint two real DSH agent scopes from a tools-injected fiber (just like DSH AgentFactory does)
    // so black and white register isolated `place_stone` tools without leaking into the global layer.
    const blackAgent = { session: blackSession } as unknown as Parameters<typeof ctx.tools.execute>[0]['agent'] & object
    const whiteAgent = { session: whiteSession } as unknown as Parameters<typeof ctx.tools.execute>[0]['agent'] & object
    const toolsCtx = await new Promise<Context>(resolve => {
      ctx.inject(['tools'], injected => resolve(injected))
    })
    const blackScope = createScope(toolsCtx, blackAgent)
    const whiteScope = createScope(toolsCtx, whiteAgent)

    try {
      await gomokuScenario.setupCharacter?.({
        character: 'black',
        agentCtx: blackScope.ctx,
        performance,
        config: performance.config,
      })
      await gomokuScenario.setupCharacter?.({
        character: 'white',
        agentCtx: whiteScope.ctx,
        performance,
        config: performance.config,
      })

      // Unscoped global layer does not leak character-bound tools.
      expect(ctx.tools.get('place_stone')).toBeUndefined()
      expect(ctx.tools.get('place_stone', blackAgent)).toBeDefined()
      expect(ctx.tools.get('place_stone', whiteAgent)).toBeDefined()

      const controller = new AbortController()

      // Black commits a legal move: durable flush happens before returning, and turn concludes.
      const firstMove = await ctx.tools.execute({
        callId: CallId('call-black-1'),
        name: 'place_stone',
        arguments: { x: 4, y: 4 },
        agent: blackAgent,
        signal: controller.signal,
      })
      expect(firstMove.isError).toBe(false)
      if (firstMove.isError) return
      expect(firstMove.concludesTurn).toBe(true)
      expect(firstMove.value).toEqual({
        accepted: true,
        x: 4,
        y: 4,
        isDraw: false,
      })
      expect(flushes).toBe(2)

      // Replaying the exact same callId is idempotent and does not append a duplicate move.
      const replayed = await ctx.tools.execute({
        callId: CallId('call-black-1'),
        name: 'place_stone',
        arguments: { x: 4, y: 4 },
        agent: blackAgent,
        signal: controller.signal,
      })
      expect(replayed.isError).toBe(false)
      if (replayed.isError) return
      expect(replayed.concludesTurn).toBe(true)
      expect(replayed.value).toEqual({
        accepted: true,
        replayed: true,
        x: 4,
        y: 4,
      })
      expect(flushes).toBe(2)
      expect(performance.eventLog().filter(e => e.type === 'gomoku/move')).toHaveLength(1)

      // White attempting an occupied square is rejected without flushing or concluding the turn.
      const rejected = await ctx.tools.execute({
        callId: CallId('call-white-bad'),
        name: 'place_stone',
        arguments: { x: 4, y: 4 },
        agent: whiteAgent,
        signal: controller.signal,
      })
      expect(rejected.isError).toBe(false)
      if (rejected.isError) return
      expect(rejected.concludesTurn).toBeUndefined()
      expect(rejected.value).toEqual({
        accepted: false,
        reason: 'coordinate is occupied',
      })
      expect(flushes).toBe(2)

      // White plays a legal move and advances the game back to black.
      const secondMove = await ctx.tools.execute({
        callId: CallId('call-white-1'),
        name: 'place_stone',
        arguments: { x: 4, y: 5 },
        agent: whiteAgent,
        signal: controller.signal,
      })
      expect(secondMove.isError).toBe(false)
      if (secondMove.isError) return
      expect(secondMove.concludesTurn).toBe(true)
      expect(flushes).toBe(3)

      const state = foldGomokuState(performance.session.events, performance.config)
      expect(state.board[4]?.[4]).toBe('black')
      expect(state.board[5]?.[4]).toBe('white')
      expect(state.currentPlayer).toBe('black')
      expect(performance.recommendNextTurn()?.character).toBe('black')
    } finally {
      await blackScope.dispose()
      await whiteScope.dispose()
      await performance.dispose()
    }
  })
})
