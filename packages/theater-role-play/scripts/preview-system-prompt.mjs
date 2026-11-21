import { apply } from '../dist/preset.js'

const rawArgs = process.argv.slice(2)
const characterId = (rawArgs[0] === '--' ? rawArgs[1] : rawArgs[0]) ?? 'dm'
const systemPrompts = new Map()

apply({
  theater: {
    registerTitle() {},
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
