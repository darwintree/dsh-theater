import type { Context } from '@deepseek-ai/cordis'
import {
  CallId,
  LlmAdapter,
  LlmError,
  type GenerateOptions,
  type LlmModelInfo,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import z from '@deepseek-ai/schemastery'

const DEFAULT_PROVIDER = 'mock'
const DEFAULT_MODEL = 'scripted'

export type MockResponseBlock =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool-call'; id: string; name: string; arguments: string }

export interface MockResponse {
  content: MockResponseBlock[]
  stopReason?: 'stop' | 'max-tokens'
}

export type Behaviour = (options: GenerateOptions) => MockResponse

export interface MockLlmAdapterOptions {
  model?: string
}

export interface Config {
  provider?: string
  model?: string
  script: MockResponse[]
}

const responseBlockSchema: z<MockResponseBlock> = z.union([
  z.object({ type: z.const('text'), text: z.string().required() }),
  z.object({ type: z.const('reasoning'), text: z.string().required() }),
  z.object({
    type: z.const('tool-call'),
    id: z.string().required(),
    name: z.string().required(),
    arguments: z.string().required(),
  }),
])

const responseSchema: z<MockResponse> = z.object({
  content: z.array(responseBlockSchema).required(),
  stopReason: z.union(['stop', 'max-tokens']),
})

export const Config: z<Config> = z.object({
  provider: z.string().default(DEFAULT_PROVIDER),
  model: z.string().default(DEFAULT_MODEL),
  script: z.array(responseSchema).required(),
})

export function createScriptedBehaviour(script: readonly MockResponse[]): Behaviour {
  // ponytail: assistant-count routing covers linear fixtures; pass a custom Behaviour when branching matters.
  return (options) => {
    const index = options.messages.filter(message => message.role === 'assistant').length
    const scriptedResponse = script[index]
    if (scriptedResponse === undefined) {
      throw new LlmError(`Mock script exhausted at index ${index}`, 'MOCK_SCRIPT_EXHAUSTED')
    }
    return scriptedResponse
  }
}

function finishReason(response: MockResponse): Extract<StreamChunk, { type: 'finish' }>['reason'] {
  if (response.stopReason === 'max-tokens') return { kind: 'max-tokens' }
  if (response.content.some(block => block.type === 'tool-call')) return { kind: 'tool-calls' }
  return { kind: 'stop' }
}

function chunksFor(response: MockResponse): StreamChunk[] {
  const chunks: StreamChunk[] = []

  response.content.forEach((block, index) => {
    chunks.push({ type: 'block-start', index, blockType: block.type })
    if (block.type === 'text') {
      chunks.push({ type: 'text-delta', index, text: block.text })
      chunks.push({ type: 'block-end', index, block })
      return
    }
    if (block.type === 'reasoning') {
      chunks.push({ type: 'reasoning-delta', index, text: block.text })
      chunks.push({ type: 'block-end', index, block })
      return
    }

    const toolCall = { ...block, id: CallId(block.id) }
    chunks.push({
      type: 'tool-call-delta',
      index,
      id: toolCall.id,
      name: toolCall.name,
      argumentsDelta: toolCall.arguments,
    })
    chunks.push({ type: 'block-end', index, block: toolCall })
  })

  chunks.push(
    { type: 'usage', usage: { inputTokens: 0, outputTokens: 0 } },
    { type: 'finish', reason: finishReason(response) },
  )
  return chunks
}

export class MockLlmAdapter extends LlmAdapter {
  private readonly model: string

  constructor(
    private readonly behaviour: Behaviour,
    options: MockLlmAdapterOptions = {},
  ) {
    super()
    this.model = options.model ?? DEFAULT_MODEL
  }

  override listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    return Promise.resolve([{
      provider,
      id: this.model,
      name: this.model,
      inputModalities: ['text'],
    }])
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    if (model !== this.model) {
      throw new LlmError(`Unknown mock model "${model}"`, 'UNKNOWN_MODEL')
    }
    return Promise.resolve({ provider, id: model, name: model, inputModalities: ['text'] })
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    options.signal?.throwIfAborted()
    if (options.model !== this.model) {
      throw new LlmError(`Unknown mock model "${options.model}"`, 'UNKNOWN_MODEL')
    }

    let response: MockResponse
    try {
      response = this.behaviour(options)
    } catch (error) {
      if (error instanceof LlmError) throw error
      throw new LlmError('Mock behaviour failed', 'MOCK_BEHAVIOUR_ERROR', { cause: error })
    }

    for (const chunk of chunksFor(response)) {
      options.signal?.throwIfAborted()
      yield chunk
    }
  }
}

export const name = 'llm-mock'
export const inject = ['llm']

export function apply(ctx: Context, config: Config): void {
  ctx.llm.registerAdapter(
    [config.provider ?? DEFAULT_PROVIDER],
    new MockLlmAdapter(
      createScriptedBehaviour(config.script),
      config.model === undefined ? {} : { model: config.model },
    ),
  )
}
