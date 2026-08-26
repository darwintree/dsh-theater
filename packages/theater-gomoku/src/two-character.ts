import type { Context } from '@deepseek-ai/cordis'
import type {} from '@darwintree/dsh-theater'
import { gomokuFactory } from './machine.js'
import { formatGomokuCoordinate } from './state.js'
import type { GomokuState } from './types.js'

export interface Config {
  blackPreset: string
  whitePreset: string
  boardSize?: number
  winLength?: number
}

export const THEATER_BOARD_STAGE_ID = 'board1'

function required(value: string, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} must be non-empty`)
  return value
}

export const name = '@darwintree/dsh-theater-gomoku/two-character'
export const inject = ['theater']

/** Contribute the two-Character Gomoku roster, Stage, and single-step Director. */
export function apply(ctx: Context, config: Config): void {
  ctx.theater.registerCharacter({ id: 'black', agentPreset: required(config.blackPreset, 'blackPreset') })
  ctx.theater.registerCharacter({ id: 'white', agentPreset: required(config.whitePreset, 'whitePreset') })
  ctx.theater.registerStage({
    stageId: THEATER_BOARD_STAGE_ID,
    factory: gomokuFactory,
    config: {
      ...config.boardSize === undefined ? {} : { boardSize: config.boardSize },
      ...config.winLength === undefined ? {} : { winLength: config.winLength },
    },
  })
  ctx.theater.registerDirector(async (context) => {
    const state = context.readStage(THEATER_BOARD_STAGE_ID) as unknown as GomokuState
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
          'Use read_board to inspect the complete authoritative board, then call place_stone(x, y) for one legal move.',
        ].join('\n'),
      }],
    }
  })
}
