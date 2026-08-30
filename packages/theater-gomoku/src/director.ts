import type { Context } from '@deepseek-ai/cordis'
import type { Director } from '@darwintree/dsh-theater'
import { formatGomokuCoordinate } from './state.js'
import type { GomokuState } from './types.js'

export interface Config {
  readonly stage: string
  readonly instruction: string
}

export const name = '@darwintree/dsh-theater-gomoku/director'
export const inject = ['theater']

function nonEmpty(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} must be non-empty`)
  return value
}

/** Select the Character whose bound color is next on the authoritative board. */
function createDirector(config: Config): Director {
  const stageId = nonEmpty(config.stage, 'stage')
  const instruction = nonEmpty(config.instruction, 'instruction')
  return async (context) => {
    const state = context.readStage(stageId) as unknown as GomokuState
    if (state.isFinished) return { kind: 'complete' }
    const previous = state.lastMove === undefined
      ? 'none; this is the opening move'
      : `${state.lastMove.color} at ${formatGomokuCoordinate(state.lastMove.x, state.lastMove.y)}`
    const character = state.currentPlayer
    return {
      kind: 'act',
      characterId: character,
      instruction: [{
        type: 'text',
        text: [
          `Your bound color is ${character}.`,
          `Previous action: ${previous}.`,
          instruction,
        ].join('\n'),
      }],
    }
  }
}

export function apply(ctx: Context, config: Config): void {
  const director = createDirector(config)
  ctx.theater.registerDirector(director)
}
