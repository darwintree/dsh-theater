import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { afterEach, describe, expect, it } from 'vitest'
import { MockLlmAdapter, type MockResponse } from '@darwintree/dsh-llm-mock'
import { characterSessionId } from '@darwintree/dsh-theater'
import * as Gomoku from '@darwintree/dsh-theater-gomoku'
import * as GomokuTheater from '@darwintree/dsh-theater-gomoku/theater'
import * as Example from '@darwintree/dsh-theater-example-three-board-gomoku'
import { createDirector } from '@darwintree/dsh-theater-example-three-board-gomoku/director'
import { createDshTestContext } from '../../../tests/harness.ts'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
let ctx: Context | undefined

function tool(name: string, args: object, id: string): MockResponse {
  return {
    content: [{
      type: 'tool-call',
      id,
      name,
      arguments: JSON.stringify(args),
    }],
  }
}

function response(sessionId: string, assistantCount: number): MockResponse {
  if (sessionId.endsWith('/characters/challenger1')) {
    return tool('place_stone', { x: assistantCount, y: 0 }, `challenger1-${assistantCount}`)
  }
  if (sessionId.endsWith('/characters/challenger2')) {
    return tool('place_stone', { x: 0, y: 0 }, 'challenger2')
  }
  if (sessionId.endsWith('/characters/challenger3')) {
    return tool('place_stone', { x: 0, y: 0 }, 'challenger3')
  }
  if (!sessionId.endsWith('/characters/master')) throw new Error(`unexpected Character ${sessionId}`)
  switch (assistantCount) {
    case 0: return tool('place_stone', { game: 1, x: 0, y: 1 }, 'master-game1')
    case 1: return { content: [{ type: 'text', text: 'I only responded to game 1.' }] }
    case 2: return tool('place_stone', { game: 2, x: 0, y: 1 }, 'master-game2')
    case 3: return tool('place_stone', { game: 3, x: 0, y: 1 }, 'master-game3')
    case 4: return { content: [{ type: 'text', text: 'All pending games now have replies.' }] }
    default: throw new Error(`unexpected Master call ${assistantCount}`)
  }
}

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
})

describe('three-board Gomoku example', () => {
  it('returns to the Master until all three black moves have white replies', async () => {
    ctx = await createDshTestContext({
      baseDir: ROOT,
      presets: {
        default: 'three-board-gomoku',
        dirs: [join(ROOT, 'presets')],
      },
    })
    await ctx.plugin(Gomoku)
    ctx.llm.registerAdapter(['mock'], new MockLlmAdapter(options => response(
      String(options.sessionId),
      options.messages.filter(message => message.role === 'assistant').length,
    )))
    await ctx.plugin(GomokuTheater)
    await ctx.plugin(Example)

    const performanceId = SessionId('three-board-example')
    await ctx.theater.create({ performanceId, presetId: 'three-board-gomoku', cwd: ROOT })
    for (let turn = 0; turn < 6; turn += 1) await ctx.theater.advance(performanceId)

    const starts = ctx.sessions.get(performanceId)!.snapshotEvents()
      .filter(event => event.type === 'theater/segment-started')
      .map(event => event.data.characterId)
    expect(starts).toEqual([
      'challenger1',
      'challenger2',
      'challenger3',
      'master',
      'master',
      'challenger1',
    ])
    const stages = ctx.theater.read(performanceId).stages
    expect(stages.board1?.state).toMatchObject({ moveNumber: 3 })
    expect(stages.board2?.state).toMatchObject({ moveNumber: 2 })
    expect(stages.board3?.state).toMatchObject({ moveNumber: 2 })

    const instructionFor = (characterId: string) => ctx!.sessions
      .get(characterSessionId(performanceId, characterId))!
      .snapshotEvents()
      .flatMap(event => event.type === 'user/message' ? event.data.content : [])
      .flatMap(block => block.type === 'text' ? [block.text] : [])[0]
    const challengerInstruction = instructionFor('challenger1')
    const masterInstruction = instructionFor('master')
    expect(challengerInstruction).toContain('You play black in game 1.')
    expect(challengerInstruction).toContain('Inspect your assigned board, then place exactly one legal black stone.')
    expect(masterInstruction).toContain('Respond to every pending game: 1, 2, 3.')
    expect(masterInstruction).toContain('Use the game parameter and answer every listed game before ending this turn.')
  })

  it('rejects blank configured instructions', () => {
    expect(() => createDirector({
      master: 'master',
      instructions: { challenger: ' ', master: 'Act.' },
      games: [
        { stage: 'board1', challenger: 'challenger1' },
        { stage: 'board2', challenger: 'challenger2' },
        { stage: 'board3', challenger: 'challenger3' },
      ],
    })).toThrow('challenger instruction must be non-empty')
  })
})
