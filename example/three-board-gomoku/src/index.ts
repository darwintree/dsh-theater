import type { Context } from '@deepseek-ai/cordis'
import type {} from '@darwintree/dsh-theater'
import {
  masterPlaceStoneToolFactory,
  masterReadBoardToolFactory,
} from './tools.js'

export const name = '@darwintree/dsh-theater-example-three-board-gomoku'
export const inject = ['theater']

export function apply(ctx: Context): void {
  ctx.theater.registerToolFactory(masterReadBoardToolFactory)
  ctx.theater.registerToolFactory(masterPlaceStoneToolFactory)
}

export {
  MASTER_PLACE_STONE_TOOL,
  MASTER_READ_BOARD_TOOL,
  masterPlaceStoneToolFactory,
  masterReadBoardToolFactory,
} from './tools.js'
