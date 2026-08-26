import type { Context } from '@deepseek-ai/cordis'
import type { StageDeclarations } from './catalog.js'

export interface Config {
  readonly stages: StageDeclarations
}

export const name = '@darwintree/dsh-stage/preset'
export const inject = ['stages']

/** Register preset-owned Stage declarations in the preset's standing scope. */
export function apply(ctx: Context, config: Config): void {
  ctx.stages.declare(config.stages)
}
