import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { afterEach, describe, expect, it } from 'vitest'
import { MockLlmAdapter } from '@darwintree/dsh-llm-mock'
import * as Gomoku from '@darwintree/dsh-theater-gomoku'
import * as GomokuTheater from '@darwintree/dsh-theater-gomoku/theater'
import { createDshTestContext } from '../../../tests/harness.ts'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
let ctx: Context | undefined

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
})

describe('Two-Character Gomoku Theater preset', () => {
  it('completes a full 5-in-a-row match using the shipped two-character-gomoku preset', async () => {
    const blackMoves = [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]] as const
    const whiteMoves = [[0, 1], [1, 1], [2, 1], [3, 1]] as const

    ctx = await createDshTestContext({
      baseDir: ROOT,
      maxParallelToolCalls: 1,
      presets: {
        default: 'two-character-gomoku',
        patchFiles: [join(ROOT, 'presets', 'two-character-gomoku.patch.yml')],
      },
    })
    await ctx.plugin(Gomoku)
    await ctx.plugin(GomokuTheater)
    ctx.llm.registerAdapter(['mock'], new MockLlmAdapter((options) => {
      const sessionId = String(options.sessionId)
      const count = options.messages.filter(message => message.role === 'assistant').length
      if (sessionId.endsWith('/characters/white')) {
        const move = whiteMoves[count]!
        return {
          content: [{
            type: 'tool-call',
            id: `white-${count}`,
            name: 'place_stone',
            arguments: JSON.stringify({ x: move[0], y: move[1] }),
          }],
        }
      }
      const move = blackMoves[Math.floor(count / 2)]!
      return count % 2 === 0
        ? { content: [{ type: 'tool-call', id: `black-read-${count}`, name: 'read_board', arguments: '{}' }] }
        : { content: [{ type: 'tool-call', id: `black-move-${count}`, name: 'place_stone', arguments: JSON.stringify({ x: move[0], y: move[1] }) }] }
    }))

    const performanceId = SessionId('gomoku-two-character-match')
    await ctx.theater.create({ performanceId, presetId: 'two-character-gomoku', cwd: ROOT })
    await ctx.theater.whenIdle(performanceId)

    expect(ctx.theater.read(performanceId)).toMatchObject({
      phase: 'completed',
      activity: 'idle',
      stages: {
        board1: {
          completed: true,
          state: { winner: 'black', moveNumber: 9, isFinished: true },
        },
      },
    })
  })
})
