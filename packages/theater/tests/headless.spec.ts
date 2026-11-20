import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentDefaultModel from '@deepseek-ai/dsh-agent-default-model'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import AgentPresets from '@deepseek-ai/dsh-agent-presets'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjections from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it } from 'vitest'
import { MockLlmAdapter } from '@darwintree/dsh-llm-mock'
import StageService from '@darwintree/dsh-stage'
import * as Gomoku from '../../theater-gomoku/src/index.ts'
import * as GomokuTheater from '../../theater-gomoku/src/theater.ts'
import TheaterService from '../src/index.ts'
import { apply as applyHeadless, parseHeadlessOptions, runHeadless } from '../src/headless.ts'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

let ctx: Context | undefined

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
})

async function setupHeadlessContext(): Promise<Context> {
  const local = new Context()
  local.baseUrl = `${pathToFileURL(FIXTURES).href}/`
  await local.plugin(Loader)
  local.loader.builtins.include = Include
  await local.plugin(LlmRuntime)
  await local.plugin(SessionStore)
  await local.plugin(SessionProjections)
  await local.plugin(StageService)
  await local.plugin(Gomoku)
  await local.plugin(SystemPrompt)
  await local.plugin(ToolRuntime)
  await local.plugin(AgentRegistry)
  await local.plugin(AgentLoop, { agents: [], maxParallelToolCalls: 1 })
  await local.plugin(AgentDefaultModel, { provider: 'mock', model: 'scripted' })
  await local.plugin(AgentPresets, {
    default: 'two-character-gomoku',
    roots: [{ path: join(FIXTURES, 'presets'), trust: 'system' }],
    includeUserRoot: false,
  })
  local.llm.registerAdapter(['mock'], new MockLlmAdapter((options) => {
    const sessionId = String(options.sessionId)
    const count = options.messages.filter(message => message.role === 'assistant').length
    const blackMoves = [[0, 0], [1, 0], [2, 0]] as const
    const whiteMoves = [[0, 1], [1, 1]] as const
    if (sessionId.endsWith('/characters/white')) {
      const move = whiteMoves[count]!
      return {
        content: [{
          type: 'tool-call',
          id: `${sessionId}-move-${count}`,
          name: 'place_stone',
          arguments: JSON.stringify({ x: move[0], y: move[1] }),
        }],
      }
    }
    const move = blackMoves[Math.floor(count / 2)]!
    return count % 2 === 0
      ? { content: [{ type: 'tool-call', id: `${sessionId}-read-${count}`, name: 'read_board', arguments: '{}' }] }
      : { content: [{ type: 'tool-call', id: `${sessionId}-move-${count}`, name: 'place_stone', arguments: JSON.stringify({ x: move[0], y: move[1] }) }] }
  }))
  await local.plugin(TheaterService)
  await local.plugin(GomokuTheater)
  ctx = local
  return local
}

describe('Theater headless runner', () => {
  it('merges config defaults with cmdlineArgs flags and validates inputs', () => {
    const fromFlags = parseHeadlessOptions(
      { presetId: 'fallback', maxSegments: 2 },
      ['--', '--preset', 'role-play-v3', '--max-segments=5', '--cwd', '/tmp/work', '--performance-id', 'perf-1'],
      '/default',
    )
    expect(fromFlags).toEqual({
      presetId: 'role-play-v3',
      maxSegments: 5,
      cwd: '/tmp/work',
      performanceId: 'perf-1',
    })

    const unlimited = parseHeadlessOptions({ presetId: 'two-character-gomoku' }, ['--max-segments', 'all'], '/default')
    expect(unlimited.maxSegments).toBeNull()
    expect(unlimited.cwd).toBe('/default')

    expect(() => parseHeadlessOptions({}, [])).toThrow('presetId must be non-empty')
    expect(() => parseHeadlessOptions({ presetId: 'p', maxSegments: 0 }, [])).toThrow('maxSegments')
    expect(() => parseHeadlessOptions({ presetId: 'p' }, ['--unknown'])).toThrow('unknown theater headless flag')
  })

  it('stops after maxSegments when configured and runs to completion when maxSegments is null', async () => {
    const runtimeCtx = await setupHeadlessContext()

    let boundedStdout = ''
    let boundedExit: number | undefined
    await runHeadless(runtimeCtx, {
      presetId: 'two-character-gomoku',
      maxSegments: 2,
      cwd: FIXTURES,
      performanceId: 'headless-bounded',
    }, {
      stdout: chunk => { boundedStdout += chunk },
      exit: code => { boundedExit = code },
    })
    expect(boundedExit).toBe(0)
    const boundedRead = JSON.parse(boundedStdout) as { phase: string; stages: { board1: { state: { moveNumber: number } } } }
    expect(boundedRead.phase).toBe('active')
    expect(boundedRead.stages.board1.state.moveNumber).toBe(2)

    let completeStdout = ''
    let completeExit: number | undefined
    await runHeadless(runtimeCtx, {
      presetId: 'two-character-gomoku',
      maxSegments: null,
      cwd: FIXTURES,
      performanceId: 'headless-complete',
    }, {
      stdout: chunk => { completeStdout += chunk },
      exit: code => { completeExit = code },
    })
    expect(completeExit).toBe(0)
    const completeRead = JSON.parse(completeStdout) as { phase: string; stages: { board1: { state: { winner: string; moveNumber: number } } } }
    expect(completeRead.phase).toBe('completed')
    expect(completeRead.stages.board1.state).toMatchObject({ winner: 'black', moveNumber: 5 })
  })

  it('reads DSH cmdlineArgs and exits with code 1 when execution fails', async () => {
    const runtimeCtx = await setupHeadlessContext()
    let stderr = ''
    let exitCode: number | undefined
    await runHeadless(runtimeCtx, {
      presetId: 'missing-preset',
      maxSegments: 1,
      cwd: FIXTURES,
      performanceId: 'headless-missing',
    }, {
      stderr: chunk => { stderr += chunk },
      exit: code => { exitCode = code },
    })
    expect(exitCode).toBe(1)
    expect(stderr).toContain('missing-preset')

    const exited = Promise.withResolvers<number>()
    runtimeCtx.provide('appExit' as never, ((code: number) => exited.resolve(code)) as never)
    runtimeCtx.provide('cmdlineArgs' as never, {
      get: () => ['--preset', 'two-character-gomoku', '--max-segments', '1', '--cwd', FIXTURES, '--performance-id', 'headless-via-apply'],
    } as never)
    applyHeadless(runtimeCtx, {})
    expect(await exited.promise).toBe(0)
    expect(runtimeCtx.theater.read(SessionId('headless-via-apply')).stages.board1?.state).toMatchObject({ moveNumber: 1 })
  })
})
