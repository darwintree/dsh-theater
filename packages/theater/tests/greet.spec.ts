import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as GreetTool from '../src/index.ts'

describe('greet tool', () => {
  it('runs through the DSH tool pipeline', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(GreetTool)

    const result = await ctx.tools.execute({
      callId: CallId('greet-smoke'),
      name: 'greet',
      arguments: { name: 'Theater' },
      signal: new AbortController().signal,
    })

    expect(result).toEqual({
      content: [{ type: 'text', text: 'Hello, Theater!' }],
      isError: false,
      value: 'Hello, Theater!',
    })
  })
})
