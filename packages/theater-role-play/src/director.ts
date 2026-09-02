import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { Context } from '@deepseek-ai/cordis'
import type { CharacterTurnRead, Director } from '@darwintree/dsh-theater'
import { successfulToolCalls, type SuccessfulToolCall } from './history.js'
import { projectCharacterTurn } from './projection.js'
import { END_PERFORMANCE, RECOMMEND_NEXT_CHARACTER, VOICE_OVER, type VoiceOverSegment } from './tools.js'

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

function instructionFor(characterId: string, turns: readonly CharacterTurnRead[]): readonly ContentBlock[] {
  let previous = -1
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    if (turns[index]?.characterId === characterId) {
      previous = index
      break
    }
  }
  return turns.slice(previous + 1)
    .filter(turn => turn.characterId === 'dm')
    .flatMap(turn => voiceOvers(turn.events))
    .filter(segment => segment.visibleTo.includes(characterId))
    .map(segment => ({ type: 'text' as const, text: segment.content }))
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
