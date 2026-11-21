import type { ActiveCharacterTurnRead, CharacterTurnRead } from '@darwintree/dsh-theater'
import { textContent } from './history.js'

export const PERCEIVE_OR_RECALL = 'perceive_or_recall'

function renderCall(
  characterId: string,
  name: string,
  rawArguments: string,
  parsedArguments?: Readonly<Record<string, unknown>>,
): string {
  if (name === PERCEIVE_OR_RECALL && typeof parsedArguments?.content === 'string') {
    return `【${characterId}】询问：${parsedArguments.content}`
  }
  return `[${characterId}调用${name}]\n${rawArguments}`
}

/** Project one ordinary Character's ReAct Turn (settled or active prefix) for DM adjudication. */
export function projectCharacterTurn(
  turn: Pick<ActiveCharacterTurnRead | CharacterTurnRead, 'characterId' | 'entries'>,
): string {
  const parts: string[] = []
  for (const entry of turn.entries) {
    if (entry.kind === 'text') {
      parts.push(`[${turn.characterId}尝试说话/行动]\n${entry.text}`)
    } else if (entry.kind === 'tool-call') {
      parts.push(renderCall(turn.characterId, entry.name, entry.rawArguments, entry.arguments))
    } else if (entry.kind === 'tool-result') {
      const content = textContent(entry.content)
      if (entry.name === PERCEIVE_OR_RECALL) {
        const label = entry.isError ? '感知/回忆失败' : '感知/回忆结果'
        parts.push(`[${turn.characterId}${label}]\n${content}`)
      } else {
        parts.push(`[${turn.characterId}工具结果:${entry.name}]\n${content}`)
      }
    }
  }
  return parts.join('\n')
}
