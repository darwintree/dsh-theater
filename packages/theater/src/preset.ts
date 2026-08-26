import type { Context } from '@deepseek-ai/cordis'
import type { TheaterToolDeclaration } from './types.js'

export interface Config {
  readonly characters: Readonly<Record<string, {
    readonly tools: readonly TheaterToolDeclaration[]
  }>>
}

export const name = '@darwintree/dsh-theater/preset'
export const inject = ['theater']

/** Declare the complete Tool list for each Character in one Performance preset. */
export function apply(ctx: Context, config: Config): void {
  if (typeof config.characters !== 'object' || config.characters === null || Array.isArray(config.characters)) {
    throw new Error('Theater characters must be an object keyed by Character ID')
  }
  const characters = Object.entries(config.characters)
  if (characters.length === 0) throw new Error('Theater characters must not be empty')
  for (const [id, character] of characters) {
    if (typeof character !== 'object' || character === null || !Array.isArray(character.tools)) {
      throw new Error(`Character ${JSON.stringify(id)} must declare a Tool list`)
    }
    for (const [index, tool] of character.tools.entries()) {
      if (typeof tool !== 'object' || tool === null || Array.isArray(tool)) {
        throw new Error(`Tool ${index} for Character ${JSON.stringify(id)} must be an object`)
      }
    }
    ctx.theater.registerCharacter({ id, tools: character.tools })
  }
}
