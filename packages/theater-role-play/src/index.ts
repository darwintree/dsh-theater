import type { Context } from '@deepseek-ai/cordis'
import type {} from '@darwintree/dsh-theater'
import { rolePlayToolFactories } from './tools.js'

export const name = '@darwintree/dsh-theater-role-play'
export const inject = ['theater']

export function apply(ctx: Context): void {
  for (const factory of rolePlayToolFactories) ctx.theater.registerToolFactory(factory)
}

export { createRolePlayDirector } from './director.js'
export { projectCharacterTurn } from './projection.js'
export * from './tools.js'
