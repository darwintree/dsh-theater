import type { Context } from '@deepseek-ai/cordis'
import StageService from '@darwintree/dsh-stage'
import { gomokuFactory } from './machine.js'

export const name = '@darwintree/dsh-theater-gomoku'
export const inject = ['stages']

export function apply(ctx: Context): void {
  ctx.stages.registerFactory(gomokuFactory)
}

export { StageService }
export { gomokuFactory, GomokuMachine } from './machine.js'
export {
  createInitialGomokuState,
  formatGomokuCoordinate,
  parseGomokuConfig,
  renderGomokuBoard,
  validateAndApplyGomokuMove,
  GOMOKU_KIND,
  GOMOKU_VERSION,
} from './state.js'
export { createGomokuTool } from './tool.js'
export {
  GOMOKU_PLACE_STONE_TOOL,
  GOMOKU_READ_BOARD_TOOL,
  gomokuPlaceStoneToolFactory,
  gomokuReadBoardToolFactory,
} from './character.js'
export type { GomokuConfig, GomokuOp, GomokuState, StoneColor } from './types.js'
export type { PlaceStoneValue } from './tool.js'
