import type { Context } from '@deepseek-ai/cordis'
import './events.js'
import { gomokuScenario } from './scenario.js'

export const name = '@darwintree/dsh-theater-gomoku'
export const inject = ['theater']

export function apply(ctx: Context): () => void {
  return ctx.theater.registerScenario(gomokuScenario)
}

export * from './events.js'
export * from './scenario.js'
export * from './state.js'
export * from './tool.js'
export * from './types.js'
