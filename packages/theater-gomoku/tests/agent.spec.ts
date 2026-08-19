import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { describe, expect, it } from 'vitest'
import StageService from '@darwintree/dsh-stage'
import * as MockLlm from '@darwintree/dsh-llm-mock'
import * as Gomoku from '../src/index.ts'

describe('Gomoku agent integration', () => {
  it('records the user black move, then the agent white move in a later step, and replies naturally', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SessionStore)
    await ctx.plugin(StageService)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(MockLlm, {
      provider: 'mock',
      model: 'scripted',
      script: [
        {
          content: [{
            type: 'tool-call',
            id: 'black-call',
            name: 'place_stone',
            arguments: JSON.stringify({ color: 'black', x: 7, y: 7 }),
          }],
        },
        {
          content: [{
            type: 'tool-call',
            id: 'white-call',
            name: 'place_stone',
            arguments: JSON.stringify({ color: 'white', x: 8, y: 8 }),
          }],
        },
        { content: [{ type: 'text', text: 'I placed your black stone at H8 and my white stone at I9.' }] },
      ],
    })
    await ctx.plugin(Gomoku)

    const agent = ctx.agentLoop.create(
      SessionId('gomoku-agent'),
      { provider: 'mock', model: 'scripted' },
    )
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'I place my black stone at H8.' }],
      source: { kind: 'user' },
    }))
    await agent.whenIdle()

    // two accepted Stage Ops persisted, in order, plus no rejected events
    const ops = agent.session.events.filter(event => event.type === 'stage/op')
    expect(ops).toHaveLength(2)
    expect(ops[0]?.data).toMatchObject({ op: { type: 'place-stone', color: 'black', x: 7, y: 7 } })
    expect(ops[1]?.data).toMatchObject({ op: { type: 'place-stone', color: 'white', x: 8, y: 8 } })

    // the final assistant message is the natural reply, not a tool call
    const finalMessage = agent.session.events
      .filter(event => event.type === 'assistant/message')
      .at(-1)
    expect(finalMessage?.type === 'assistant/message' && finalMessage.data.message.content)
      .toEqual([{ type: 'text', text: 'I placed your black stone at H8 and my white stone at I9.' }])

    // the loop continued across both tool results (no concludeTurn) and reached idle
    expect(agent.status).toBe('idle')
    expect(ctx.stages.completed('gomoku-agent-stage')).toBe(false)
    expect((ctx.stages.read('gomoku-agent-stage') as { moveNumber: number }).moveNumber).toBe(2)
  })
});

