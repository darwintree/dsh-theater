import type { Context } from '@deepseek-ai/cordis'
import { createGomokuTool } from './tool.js'

export interface Config {
  stage: string
}

export const name = '@darwintree/dsh-theater-gomoku/single-agent'
export const inject = ['stages', 'tools']

/** Expose the direct Gomoku tool only to Agents using this preset scope. */
export function apply(ctx: Context, config: Config): void {
  if (typeof config.stage !== 'string' || config.stage.trim() === '') {
    throw new Error('stage must be non-empty')
  }
  ctx.tools.register(createGomokuTool(ctx, config.stage))
}
