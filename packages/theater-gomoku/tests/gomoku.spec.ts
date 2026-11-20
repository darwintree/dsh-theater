import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { ToolCallId } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjections from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { describe, expect, it } from 'vitest'
import StageService from '@darwintree/dsh-stage'
import * as StagePreset from '@darwintree/dsh-stage/preset'
import * as Gomoku from '../src/index.ts'
import { apply as applyDirector } from '../src/director.ts'
import * as SingleAgent from '../src/single-agent.ts'

async function setup() {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjections)
  await ctx.plugin(StageService)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(NativeToolExecutor)
  await ctx.plugin(Gomoku)
  return ctx
}

async function setupWithAgent() {
  const ctx = await setup()
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  return ctx
}

async function createGomokuAgent(ctx: Context, id: string) {
  const handle = await ctx.agents.create({
    sessionId: SessionId(id),
    agentOptions: { provider: 'mock', model: 'scripted' },
    setup: async (agentCtx) => {
      await agentCtx.plugin(SingleAgent, { stage: 'test-board' })
      await agentCtx.plugin(StagePreset, {
        stages: { 'test-board': { machine: 'gomoku', params: { boardSize: 15, winLength: 5 } } },
      })
    },
  })
  return handle.agent
}

describe('Gomoku tool', () => {
  it('is not exposed globally', async () => {
    const ctx = await setup()
    expect(ctx.tools.schemas().map(tool => tool.name)).not.toContain('place_stone')
  })

  it('uses the preset-declared Stage, records both moves, and renders the full board', async () => {
    const ctx = await setupWithAgent()
    const agent = await createGomokuAgent(ctx, 'gomoku-tool')

    const blackBatch = await ctx.tools.execute({
      calls: [{
        type: 'tool-call',
        id: ToolCallId('black-1'),
        name: 'place_stone',
        arguments: JSON.stringify({ color: 'black', x: 7, y: 7 }),
      }],
      signal: new AbortController().signal,
      agent,
    })
    const black = blackBatch.results[0]!.result
    expect(black.isError, JSON.stringify(black.content)).toBe(false)
    const blackValue = black.value as Gomoku.PlaceStoneValue
    expect(blackValue.accepted).toBe(true)
    expect(blackValue.currentPlayer).toBe('white')
    expect(blackValue.moveNumber).toBe(1)
    expect(blackValue.isFinished).toBe(false)
    expect(agent.session.snapshotEvents().filter(e => e.type === 'stage/configured')[0]?.data)
      .toMatchObject({ stageId: 'test-board', machine: 'gomoku', version: '1' })

    const whiteBatch = await ctx.tools.execute({
      calls: [{
        type: 'tool-call',
        id: ToolCallId('white-1'),
        name: 'place_stone',
        arguments: JSON.stringify({ color: 'white', x: 8, y: 8 }),
      }],
      signal: new AbortController().signal,
      agent,
    })
    const white = whiteBatch.results[0]!.result
    expect(white.isError).toBe(false)
    const whiteValue = white.value as Gomoku.PlaceStoneValue
    expect(whiteValue.accepted).toBe(true)
    expect(whiteValue.currentPlayer).toBe('black')
    expect(whiteValue.moveNumber).toBe(2)
    // full board rendered with both stones
    expect(whiteValue.board).toContain('●')
    expect(whiteValue.board).toContain('○')
    // only accepted ops persisted
    expect(agent.session.snapshotEvents().filter(e => e.type === 'stage/op')).toHaveLength(2)
  })

  it('returns a domain rejection as a normal tool result without persisting', async () => {
    const ctx = await setupWithAgent()
    const agent = await createGomokuAgent(ctx, 'gomoku-reject')

    await ctx.tools.execute({
      calls: [{
        type: 'tool-call',
        id: ToolCallId('r1'),
        name: 'place_stone',
        arguments: JSON.stringify({ color: 'black', x: 0, y: 0 }),
      }],
      signal: new AbortController().signal,
      agent,
    })
    const occupiedBatch = await ctx.tools.execute({
      calls: [{
        type: 'tool-call',
        id: ToolCallId('r2'),
        name: 'place_stone',
        arguments: JSON.stringify({ color: 'white', x: 0, y: 0 }),
      }],
      signal: new AbortController().signal,
      agent,
    })
    const occupied = occupiedBatch.results[0]!.result
    expect(occupied.isError).toBe(false)
    const value = occupied.value as Gomoku.PlaceStoneValue
    expect(value.accepted).toBe(false)
    expect(value.reason).toBe('coordinate is occupied')
    expect(agent.session.snapshotEvents().filter(e => e.type === 'stage/op')).toHaveLength(1)
  })

  it('does not conclude the turn on an accepted move', async () => {
    const ctx = await setupWithAgent()
    const agent = await createGomokuAgent(ctx, 'gomoku-noconclude')
    const batch = await ctx.tools.execute({
      calls: [{
        type: 'tool-call',
        id: ToolCallId('nc1'),
        name: 'place_stone',
        arguments: JSON.stringify({ color: 'black', x: 0, y: 0 }),
      }],
      signal: new AbortController().signal,
      agent,
    })
    const result = batch.results[0]!.result
    expect(result.isError).toBe(false)
    // the tool never marks its result terminal, so the loop may continue
    expect(batch.concluded).toBe(false)
    expect(result.concludesTurn).toBeUndefined()
  })
});

describe('Gomoku Director', () => {
  it('rejects a blank configured instruction', () => {
    expect(() => applyDirector(new Context(), { stage: 'board1', instruction: ' ' }))
      .toThrow('instruction must be non-empty')
  })
})
