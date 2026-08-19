import type { Context } from '@deepseek-ai/cordis'
import StageService from '@darwintree/dsh-stage'
import { createGomokuTool } from './tool.js'

export const name = '@darwintree/dsh-theater-gomoku'
export const inject = ['stages', 'tools']

export function apply(ctx: Context): void {
  ctx.tools.register(createGomokuTool(ctx))
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
export type { GomokuConfig, GomokuOp, GomokuState, StoneColor } from './types.js'
export type { GomokuToolOptions, PlaceStoneValue } from './tool.js'
