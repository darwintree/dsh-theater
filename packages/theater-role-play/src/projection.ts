import type { CharacterTurnRead } from '@darwintree/dsh-theater'
import { parseArguments, textContent } from './history.js'

export const PERCEIVE_OR_RECALL = 'perceive_or_recall'

function renderCall(characterId: string, name: string, rawArguments: string): string {
  const args = parseArguments(rawArguments)
  if (name === PERCEIVE_OR_RECALL && typeof args?.content === 'string') {
    return `【${characterId}】询问：${args.content}`
  }
  return `[${characterId}调用${name}]\n${rawArguments}`
}

/** Project one ordinary Character's complete ReAct Turn for DM adjudication. */
export function projectCharacterTurn(turn: CharacterTurnRead): string {
  const parts: string[] = []
  const calls = new Map<string, string>()
  for (const event of turn.events) {
    if (event.type === 'assistant/message') {
      for (const block of event.data.message.content) {
        if (block.type === 'text') {
          parts.push(`[${turn.characterId}尝试说话/行动]\n${block.text}`)
        } else if (block.type === 'tool-call') {
          calls.set(String(block.id), block.name)
          parts.push(renderCall(turn.characterId, block.name, block.arguments))
        }
      }
      continue
    }
    if (event.type === 'tool/call') {
      calls.set(String(event.data.callId), event.data.name)
      continue
    }
    if (event.type !== 'tool/result') continue
    const block = event.data.message.content[0]
    const content = textContent(block.content)
    const name = calls.get(String(event.data.message.source.callId))
    if (name === PERCEIVE_OR_RECALL) {
      const label = block.isError === true || event.data.error !== undefined
        ? '感知/回忆失败'
        : '感知/回忆结果'
      parts.push(`[${turn.characterId}${label}]\n${content}`)
    } else if (name !== undefined) {
      parts.push(`[${turn.characterId}工具结果:${name}]\n${content}`)
    }
  }
  return parts.join('\n')
}
