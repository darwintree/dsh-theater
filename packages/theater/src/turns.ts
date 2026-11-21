import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { CharacterTurnEntry, CharacterTurnToolCall } from './types.js'

function parseJsonObject(raw: string): Readonly<Record<string, unknown>> | undefined {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
    return parsed as Record<string, unknown>
  } catch {
    return undefined
  }
}

/** Slice a settled Segment's Character Session interval starting at its first `turn/start`. */
export function sliceSettledTurnEvents(events: readonly SessionEvent[]): readonly SessionEvent[] {
  const start = events.findIndex(event => event.type === 'turn/start')
  return start < 0 ? [] : events.slice(start)
}

/** Slice the currently open Turn from a Character Session starting at its latest `turn/start`. */
export function sliceActiveTurnEvents(events: readonly SessionEvent[]): readonly SessionEvent[] {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index]?.type === 'turn/start') return events.slice(index)
  }
  return []
}

/**
 * Project raw Character Session events for one Turn into Theater's structured,
 * read-only Turn representation: assistant text, Tool calls, and Tool results
 * in chronological order, excluding incoming Instructions, reasoning, and
 * execution-only boundary events.
 */
export function extractTurnContent(events: readonly SessionEvent[]): {
  readonly entries: readonly CharacterTurnEntry[]
  readonly toolCalls: readonly CharacterTurnToolCall[]
} {
  const entries: CharacterTurnEntry[] = []
  interface MutableToolCall {
    readonly callId: string
    readonly name: string
    readonly rawArguments: string
    readonly arguments?: Readonly<Record<string, unknown>>
    result?: {
      readonly content: readonly ContentBlock[]
      readonly isError: boolean
    }
  }
  const callsById = new Map<string, MutableToolCall>()
  const callList: MutableToolCall[] = []

  const recordToolCall = (callId: string, name: string, rawArguments: string): void => {
    if (callsById.has(callId)) return
    const parsed = parseJsonObject(rawArguments)
    const call: MutableToolCall = parsed === undefined
      ? { callId, name, rawArguments }
      : { callId, name, rawArguments, arguments: parsed }
    callsById.set(callId, call)
    callList.push(call)
    entries.push(parsed === undefined
      ? { kind: 'tool-call', callId, name, rawArguments }
      : { kind: 'tool-call', callId, name, rawArguments, arguments: parsed })
  }

  for (const event of events) {
    if (event.type === 'assistant/message') {
      for (const block of event.data.message.content) {
        if (block.type === 'text') {
          entries.push({ kind: 'text', text: block.text })
        } else if (block.type === 'tool-call') {
          recordToolCall(String(block.id), block.name, block.arguments)
        }
      }
      continue
    }
    if (event.type === 'tool/call') {
      recordToolCall(String(event.data.callId), event.data.name, event.data.arguments)
      continue
    }
    if (event.type !== 'tool/result') continue
    const callId = String(event.data.message.source.callId)
    const call = callsById.get(callId)
    const isError = event.data.message.isError === true || event.data.error !== undefined
    const content = [...event.data.message.content]
    if (call !== undefined) {
      call.result = { content, isError }
      entries.push({ kind: 'tool-result', callId, name: call.name, content, isError })
    }
  }

  return {
    entries,
    toolCalls: callList.map(call => ({
      callId: call.callId,
      name: call.name,
      rawArguments: call.rawArguments,
      ...call.arguments === undefined ? {} : { arguments: call.arguments },
      ...call.result === undefined ? {} : { result: call.result },
    })),
  }
}
