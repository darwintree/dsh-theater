import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { CharacterTurnToolCall } from '@darwintree/dsh-theater'

export interface SuccessfulToolCall {
  readonly callId: string
  readonly name: string
  readonly arguments: Readonly<Record<string, unknown>>
}

export function successfulToolCalls(
  toolCalls: readonly CharacterTurnToolCall[],
  name?: string,
): SuccessfulToolCall[] {
  return toolCalls.flatMap((call) => {
    if (call.result === undefined || call.result.isError) return []
    if (call.arguments === undefined) return []
    if (name !== undefined && call.name !== name) return []
    return [{ callId: call.callId, name: call.name, arguments: call.arguments }]
  })
}

export function textContent(blocks: readonly ContentBlock[]): string {
  return blocks
    .flatMap(block => block.type === 'text' && typeof block.text === 'string' ? [block.text] : [])
    .join('\n')
}
