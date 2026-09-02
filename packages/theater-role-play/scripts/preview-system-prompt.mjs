import { apply } from '../dist/preset.js'

const characterId = process.argv[2] ?? 'dm'
const systemPrompts = new Map()

apply({
  theater: {
    registerAutoAdvance() {},
    registerCharacter(character) {
      systemPrompts.set(character.id, character.systemPrompt)
    },
    registerDirector() {},
  },
})

const systemPrompt = systemPrompts.get(characterId)
if (systemPrompt === undefined) {
  console.error(`Unknown Character ID: ${characterId}. Available: ${[...systemPrompts.keys()].join(', ')}`)
  process.exitCode = 1
} else {
  process.stdout.write(`${systemPrompt}\n`)
}
