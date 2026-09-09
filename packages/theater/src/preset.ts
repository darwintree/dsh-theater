import type { Context } from '@deepseek-ai/cordis'
import type { ModelSelection } from '@deepseek-ai/dsh-agent'
import type { TheaterToolDeclaration } from './types.js'

export interface Config {
  readonly title?: string
  readonly autoAdvance?: boolean
  readonly characters: Readonly<Record<string, {
    readonly title?: string
    readonly model?: ModelSelection
    readonly systemPrompt: string
    readonly tools: readonly TheaterToolDeclaration[]
  }>>
}

export const name = '@darwintree/dsh-theater/preset'
export const inject = ['theater']

/** Declare the complete Tool list for each Character in one Performance preset. */
export function apply(ctx: Context, config: Config): void {
  if (config.title !== undefined && typeof config.title !== 'string') {
    throw new Error('Theater title must be a string')
  }
  if (config.title !== undefined) ctx.theater.registerTitle(config.title)
  if (config.autoAdvance !== undefined && typeof config.autoAdvance !== 'boolean') {
    throw new Error('Theater autoAdvance must be boolean')
  }
  if (typeof config.characters !== 'object' || config.characters === null || Array.isArray(config.characters)) {
    throw new Error('Theater characters must be an object keyed by Character ID')
  }
  ctx.theater.registerAutoAdvance(config.autoAdvance ?? true)
  const characters = Object.entries(config.characters)
  if (characters.length === 0) throw new Error('Theater characters must not be empty')
  for (const [id, character] of characters) {
    if (typeof character !== 'object' || character === null || !Array.isArray(character.tools)) {
      throw new Error(`Character ${JSON.stringify(id)} must declare a Tool list`)
    }
    if (typeof character.systemPrompt !== 'string' || character.systemPrompt.trim() === '') {
      throw new Error(`Character ${JSON.stringify(id)} must declare a non-empty System Prompt`)
    }
    if (character.title !== undefined && typeof character.title !== 'string') {
      throw new Error(`Character ${JSON.stringify(id)} title must be a string`)
    }
    if (character.model !== undefined && (typeof character.model !== 'object' || character.model === null
      || typeof character.model.provider !== 'string' || typeof character.model.model !== 'string'
      || (character.model.reasoningEffort !== undefined && typeof character.model.reasoningEffort !== 'string'))) {
      throw new Error(`Character ${JSON.stringify(id)} model must select a provider and model`)
    }
    for (const [index, tool] of character.tools.entries()) {
      if (typeof tool !== 'object' || tool === null || Array.isArray(tool)) {
        throw new Error(`Tool ${index} for Character ${JSON.stringify(id)} must be an object`)
      }
    }
    ctx.theater.registerCharacter({
      id,
      ...(character.title === undefined ? {} : { title: character.title }),
      ...(character.model === undefined ? {} : { model: character.model }),
      systemPrompt: character.systemPrompt,
      tools: character.tools,
    })
  }
}
