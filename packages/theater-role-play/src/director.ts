import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { Context } from '@deepseek-ai/cordis'
import type { CharacterTurnRead, Director } from '@darwintree/dsh-theater'
import { successfulToolCalls, type SuccessfulToolCall } from './history.js'
import { PERCEIVE_OR_RECALL, projectCharacterTurn } from './projection.js'
import {
  END_PERFORMANCE,
  RECOMMEND_NEXT_CHARACTER,
  THINK,
  VOICE_OVER,
  WARN,
  type VoiceOverSegment,
} from './tools.js'

function text(content: string): readonly ContentBlock[] {
  return [{ type: 'text', text: content }]
}

function terminal(turn: CharacterTurnRead): SuccessfulToolCall | undefined {
  const calls = successfulToolCalls(turn.events)
  for (let index = calls.length - 1; index >= 0; index -= 1) {
    const call = calls[index]
    if (call?.name === RECOMMEND_NEXT_CHARACTER || call?.name === END_PERFORMANCE) return call
  }
  return undefined
}

function isVoiceOverSegment(value: unknown): value is VoiceOverSegment {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const segment = value as Record<string, unknown>
  return Array.isArray(segment.visibleTo)
    && segment.visibleTo.every(id => typeof id === 'string')
    && typeof segment.content === 'string'
}

function voiceOvers(events: readonly SessionEvent[]): VoiceOverSegment[] {
  return successfulToolCalls(events, VOICE_OVER).flatMap((call) => {
    const segments = call.arguments.segments
    return Array.isArray(segments) ? segments.filter(isVoiceOverSegment) : []
  })
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function publicContent(turn: CharacterTurnRead): readonly ContentBlock[] {
  return turn.events.flatMap(event => event.type === 'assistant/message'
    ? event.data.message.content.flatMap((block) => {
        if (block.type === 'text') return [{
          type: 'text' as const,
          text: `<character_message character="${escapeXml(turn.characterId)}">\n${escapeXml(block.text)}\n</character_message>`,
        }]
        if (block.type === 'tool-call' && (block.name === THINK || block.name === PERCEIVE_OR_RECALL)) {
          return [{
            type: 'text' as const,
            text: `<character_tool character="${escapeXml(turn.characterId)}" name="${block.name}" />`,
          }]
        }
        return []
      })
    : [])
}

function dmContent(events: readonly SessionEvent[], characterId: string): readonly ContentBlock[] {
  return successfulToolCalls(events).flatMap((call) => {
    if (call.name === VOICE_OVER) {
      const segments = call.arguments.segments
      return Array.isArray(segments)
        ? segments.filter(isVoiceOverSegment)
          .filter(segment => segment.visibleTo.includes(characterId))
          .map(segment => ({ type: 'text' as const, text: segment.content }))
        : []
    }
    if (call.name === WARN && typeof call.arguments.target === 'string'
      && typeof call.arguments.reason === 'string') {
      return [{
        type: 'text' as const,
        text: `<dm_warning>${escapeXml(call.arguments.target)} 因为 ${escapeXml(call.arguments.reason)} 被dm警告了</dm_warning>`,
      }]
    }
    return []
  })
}

function instructionFor(characterId: string, turns: readonly CharacterTurnRead[]): readonly ContentBlock[] {
  let previous = -1
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    if (turns[index]?.characterId === characterId) {
      previous = index
      break
    }
  }
  return turns.slice(previous + 1).flatMap((turn) => {
    if (turn.characterId !== 'dm') return publicContent(turn)
    return dmContent(turn.events, characterId)
  })
}

/** Reconstruct the next Role-play action from settled top-level Turns only. */
export function createRolePlayDirector(): Director {
  return async (context) => {
    const turns = context.readSettledTurns()
    const latest = turns.at(-1)
    if (latest === undefined) return { kind: 'act', characterId: 'dm', instruction: text('开始演出。') }
    if (latest.outcome !== 'completed') throw new Error(`Character ${JSON.stringify(latest.characterId)} Turn failed`)
    if (latest.characterId !== 'dm') {
      return { kind: 'act', characterId: 'dm', instruction: text(projectCharacterTurn(latest)) }
    }

    const result = terminal(latest)
    if (result?.name === END_PERFORMANCE) return { kind: 'complete' }
    if (result?.name === RECOMMEND_NEXT_CHARACTER && typeof result.arguments.character === 'string') {
      const characterId = result.arguments.character
      return { kind: 'act', characterId, instruction: instructionFor(characterId, turns) }
    }

    let attempts = 0
    for (let index = turns.length - 1; index >= 0 && turns[index]?.characterId === 'dm'; index -= 1) attempts += 1
    if (attempts >= 3) throw new Error('DM 连续三轮未完成顶层裁定')
    const adjudication = turns.slice(turns.length - attempts)
    const hasVoiceOver = adjudication.some(turn => voiceOvers(turn.events).length > 0)
    const reason = hasVoiceOver
      ? '上一轮顶层裁定未完成：缺少一次成功的 recommend_next_character 或 end_performance。'
      : '上一轮顶层裁定未完成：缺少一次成功的 voice_over，以及一次成功的 recommend_next_character 或 end_performance。'
    return { kind: 'act', characterId: 'dm', instruction: text(reason) }
  }
}

export const name = '@darwintree/dsh-theater-role-play/director'
export const inject = ['theater']

export function apply(ctx: Context): void {
  ctx.theater.registerDirector(createRolePlayDirector())
}
