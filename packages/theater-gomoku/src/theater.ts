import type { Context } from '@deepseek-ai/cordis'
import type {} from '@darwintree/dsh-theater'
import { gomokuPlaceStoneToolFactory, gomokuReadBoardToolFactory } from './character.js'

export const name = '@darwintree/dsh-theater-gomoku/theater'
export const inject = ['theater']

/** Register Gomoku's ordinary Character Tool constructors with Theater. */
export function apply(ctx: Context): void {
  ctx.theater.registerToolFactory(gomokuReadBoardToolFactory)
  ctx.theater.registerToolFactory(gomokuPlaceStoneToolFactory)
}
