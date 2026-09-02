import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

export interface SuccessfulToolCall {
  readonly name: string
  readonly arguments: Record<string, unknown>
  readonly callSeq: number
  readonly resultSeq: number
}

function record(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

export function parseArguments(value: string): Record<string, unknown> | undefined {
  try {
    return record(JSON.parse(value))
  } catch {
    return undefined
  }
}

export function successfulToolCalls(
  events: readonly SessionEvent[],
  name?: string,
): SuccessfulToolCall[] {
  const calls = new Map<string, { name: string; arguments: Record<string, unknown>; callSeq: number }>()
  const successful: SuccessfulToolCall[] = []
  for (const event of events) {
    if (event.type === 'tool/call') {
      const args = parseArguments(event.data.arguments)
      if (args !== undefined) calls.set(String(event.data.callId), {
        name: event.data.name,
        arguments: args,
        callSeq: event.seq,
      })
      continue
    }
    if (event.type !== 'tool/result' || event.data.error !== undefined) continue
    const block = event.data.message.content[0]
    if (block.isError === true) continue
    const call = calls.get(String(event.data.message.source.callId))
    if (call !== undefined && (name === undefined || call.name === name)) {
      successful.push({ ...call, resultSeq: event.seq })
    }
  }
  return successful.sort((left, right) => left.callSeq - right.callSeq)
}

export function textContent(blocks: readonly ContentBlock[]): string {
  return blocks
    .flatMap(block => block.type === 'text' && typeof block.text === 'string' ? [block.text] : [])
    .join('\n')
}
