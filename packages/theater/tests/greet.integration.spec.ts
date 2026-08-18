import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { describe, expect, it } from 'vitest'
import * as MockLlm from '@darwintree/dsh-llm-mock'
import * as GreetTool from '../src/index.ts'

describe('greet agent integration', () => {
  it('executes greet through a mocked model tool-call round trip', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SessionStore)
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
            id: 'greet-call',
            name: 'greet',
            arguments: JSON.stringify({ name: 'Theater' }),
          }],
        },
        { content: [{ type: 'text', text: 'Greeting completed.' }] },
      ],
    })
    await ctx.plugin(GreetTool)

    const agent = ctx.agentLoop.create(
      SessionId('greet-integration'),
      { provider: 'mock', model: 'scripted' },
    )
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'Greet Theater.' }],
      source: { kind: 'user' },
    }))
    await agent.whenIdle()

    const toolResult = agent.session.events.find(event => event.type === 'tool/result')
    expect(toolResult?.type === 'tool/result' && toolResult.data.message.content[0]?.content)
      .toEqual([{ type: 'text', text: 'Hello, Theater!' }])

    const finalMessage = agent.session.events
      .filter(event => event.type === 'assistant/message')
      .at(-1)
    expect(finalMessage?.type === 'assistant/message' && finalMessage.data.message.content)
      .toEqual([{ type: 'text', text: 'Greeting completed.' }])
  })
})
