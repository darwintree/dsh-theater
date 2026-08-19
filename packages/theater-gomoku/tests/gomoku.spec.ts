import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { CallId } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { describe, expect, it } from 'vitest'
import StageService from '@darwintree/dsh-stage'
import * as Gomoku from '../src/index.ts'

async function setup() {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(StageService)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(Gomoku)
  return ctx
}

async function setupWithAgent() {
  const ctx = await setup()
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  return ctx
}

describe('Gomoku tool', () => {
  it('fails clearly when executed without an agent', async () => {
    const ctx = await setup()
    const result = await ctx.tools.execute({
      callId: CallId('no-agent'),
      name: 'place_stone',
      arguments: { color: 'black', x: 7, y: 7 },
      signal: new AbortController().signal,
    })
    expect(result.isError).toBe(true)
    expect(result.content[0]).toMatchObject({ type: 'text', text: /requires a calling agent/ })
  })

  it('derives a session-scoped Stage ID, records the user black move, then the agent white move, and renders the full board', async () => {
    const ctx = await setupWithAgent()
    const agent = ctx.agentLoop.create(
      SessionId('gomoku-tool'),
      { provider: 'mock', model: 'scripted' },
    )

    const black = await ctx.tools.execute({
      callId: CallId('black-1'),
      name: 'place_stone',
      arguments: { color: 'black', x: 7, y: 7 },
      signal: new AbortController().signal,
      agent,
    })
    expect(black.isError).toBe(false)
    const blackValue = black.value as Gomoku.PlaceStoneValue
    expect(blackValue.accepted).toBe(true)
    expect(blackValue.currentPlayer).toBe('white')
    expect(blackValue.moveNumber).toBe(1)
    expect(blackValue.isFinished).toBe(false)
    // temporary Stage ID isolated in the tool: ${sessionId}-stage
    expect(agent.session.events.filter(e => e.type === 'stage/configured')[0]?.data)
      .toMatchObject({ stageId: 'gomoku-tool-stage', machine: 'gomoku', version: '1' })

    const white = await ctx.tools.execute({
      callId: CallId('white-1'),
      name: 'place_stone',
      arguments: { color: 'white', x: 8, y: 8 },
      signal: new AbortController().signal,
      agent,
    })
    expect(white.isError).toBe(false)
    const whiteValue = white.value as Gomoku.PlaceStoneValue
    expect(whiteValue.accepted).toBe(true)
    expect(whiteValue.currentPlayer).toBe('black')
    expect(whiteValue.moveNumber).toBe(2)
    // full board rendered with both stones
    expect(whiteValue.board).toContain('●')
    expect(whiteValue.board).toContain('○')
    // only accepted ops persisted
    expect(agent.session.events.filter(e => e.type === 'stage/op')).toHaveLength(2)
  })

  it('returns a domain rejection as a normal tool result without persisting', async () => {
    const ctx = await setupWithAgent()
    const agent = ctx.agentLoop.create(SessionId('gomoku-reject'), { provider: 'mock', model: 'scripted' })

    await ctx.tools.execute({
      callId: CallId('r1'),
      name: 'place_stone',
      arguments: { color: 'black', x: 0, y: 0 },
      signal: new AbortController().signal,
      agent,
    })
    const occupied = await ctx.tools.execute({
      callId: CallId('r2'),
      name: 'place_stone',
      arguments: { color: 'white', x: 0, y: 0 },
      signal: new AbortController().signal,
      agent,
    })
    expect(occupied.isError).toBe(false)
    const value = occupied.value as Gomoku.PlaceStoneValue
    expect(value.accepted).toBe(false)
    expect(value.reason).toBe('coordinate is occupied')
    expect(agent.session.events.filter(e => e.type === 'stage/op')).toHaveLength(1)
  })

  it('does not conclude the turn on an accepted move', async () => {
    const ctx = await setupWithAgent()
    const agent = ctx.agentLoop.create(SessionId('gomoku-noconclude'), { provider: 'mock', model: 'scripted' })
    const result = await ctx.tools.execute({
      callId: CallId('nc1'),
      name: 'place_stone',
      arguments: { color: 'black', x: 0, y: 0 },
      signal: new AbortController().signal,
      agent,
    })
    expect(result.isError).toBe(false)
    // the tool never marks its result terminal, so the loop may continue
    expect(result.concludesTurn).toBeUndefined()
  })
});
