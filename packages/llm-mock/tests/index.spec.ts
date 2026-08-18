import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, {
  CallId,
  createAssistantMessage,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import { describe, expect, it } from 'vitest'
import * as MockLlm from '../src/index.ts'

async function collect(stream: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

describe('mock LLM plugin', () => {
  it('registers a discoverable scripted model and serves tool-call then text responses', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(MockLlm, {
      provider: 'test-mock',
      model: 'scenario',
      script: [
        {
          content: [{
            type: 'tool-call',
            id: 'greet-call',
            name: 'greet',
            arguments: JSON.stringify({ name: 'Ada' }),
          }],
        },
        { content: [{ type: 'text', text: 'Hello, Ada!' }] },
      ],
    })

    await expect(ctx.llm.listModels('test-mock')).resolves.toEqual([{
      provider: 'test-mock',
      id: 'scenario',
      name: 'scenario',
      inputModalities: ['text'],
    }])

    const first = await collect(ctx.llm.stream({
      provider: 'test-mock',
      model: 'scenario',
      messages: [],
    }))
    expect(first.at(-1)).toEqual({ type: 'finish', reason: { kind: 'tool-calls' } })
    expect(first[1]).toMatchObject({
      type: 'tool-call-delta',
      id: 'greet-call',
      name: 'greet',
    })

    const second = await collect(ctx.llm.stream({
      provider: 'test-mock',
      model: 'scenario',
      messages: [createAssistantMessage({
        content: [{
          type: 'tool-call',
          id: CallId('greet-call'),
          name: 'greet',
          arguments: JSON.stringify({ name: 'Ada' }),
        }],
        source: { provider: 'test-mock', model: 'scenario' },
      })],
    }))
    expect(second).toMatchObject([
      { type: 'block-start', blockType: 'text' },
      { type: 'text-delta', text: 'Hello, Ada!' },
      { type: 'block-end', block: { type: 'text', text: 'Hello, Ada!' } },
      { type: 'usage' },
      { type: 'finish', reason: { kind: 'stop' } },
    ])
  })
})
