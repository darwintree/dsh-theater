import type { Context } from '@deepseek-ai/cordis'
import type {} from '@darwintree/dsh-theater'
import { formatGomokuCoordinate } from './state.js'
import type { GomokuState } from './types.js'

export interface Config {
  readonly stage: string
}

export const name = '@darwintree/dsh-theater-gomoku/director'
export const inject = ['theater']

/** Select the Character whose bound color is next on the authoritative board. */
export function apply(ctx: Context, config: Config): void {
  if (typeof config.stage !== 'string' || config.stage.trim() === '') {
    throw new Error('stage must be non-empty')
  }
  const stageId = config.stage
  ctx.theater.registerDirector(async (context) => {
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
          'Use your available tools to make one legal move.',
        ].join('\n'),
      }],
    }
  })
}
