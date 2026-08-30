import type { Context } from '@deepseek-ai/cordis'
import type { Director } from '@darwintree/dsh-theater'
import { formatGomokuCoordinate, type GomokuState } from '@darwintree/dsh-theater-gomoku'

export interface Config {
  readonly master: string
  readonly instructions: {
    readonly challenger: string
    readonly master: string
  }
  readonly games: readonly {
    readonly stage: string
    readonly challenger: string
  }[]
}

interface Game {
  number: number
  stage: string
  challenger: string
}

export const name = '@darwintree/dsh-theater-example-three-board-gomoku/director'
export const inject = ['theater']

function nonEmpty(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} must be non-empty`)
  return value
}

function parseConfig(config: Config): {
  master: string
  games: Game[]
  instructions: { challenger: string; master: string }
} {
  const master = nonEmpty(config.master, 'master Character ID')
  if (typeof config.instructions !== 'object' || config.instructions === null || Array.isArray(config.instructions)) {
    throw new Error('instructions must be an object')
  }
  const instructions = {
    challenger: nonEmpty(config.instructions.challenger, 'challenger instruction'),
    master: nonEmpty(config.instructions.master, 'master instruction'),
  }
  if (!Array.isArray(config.games) || config.games.length !== 3) {
    throw new Error('three-board Director requires exactly three games')
  }
  const games = config.games.map((game, index) => {
    if (typeof game !== 'object' || game === null || Array.isArray(game)) {
      throw new Error(`game ${index + 1} must be an object`)
    }
    return {
      number: index + 1,
      stage: nonEmpty(game.stage, `Stage ID for game ${index + 1}`),
      challenger: nonEmpty(game.challenger, `challenger Character ID for game ${index + 1}`),
    }
  })
  if (new Set(games.map(game => game.stage)).size !== games.length) {
    throw new Error('three-board Director stages must be unique')
  }
  if (new Set(games.map(game => game.challenger)).size !== games.length) {
    throw new Error('three-board Director challengers must be unique')
  }
  if (games.some(game => game.challenger === master)) {
    throw new Error('master must differ from every challenger')
  }
  return { master, games, instructions }
}

function previous(state: GomokuState): string {
  return state.lastMove === undefined
    ? 'no previous move'
    : `${state.lastMove.color} at ${formatGomokuCoordinate(state.lastMove.x, state.lastMove.y)}`
}

export function createDirector(config: Config): Director {
  const { master, games, instructions } = parseConfig(config)
  return async (context) => {
    const active = games
      .map(game => ({ ...game, state: context.readStage(game.stage) as unknown as GomokuState }))
      .filter(game => !game.state.isFinished)
    if (active.length === 0) return { kind: 'complete' }

    const moveNumber = Math.min(...active.map(game => game.state.moveNumber))
    if (moveNumber % 2 === 0) {
      const game = active.find(game => game.state.moveNumber === moveNumber)!
      return {
        kind: 'act',
        characterId: game.challenger,
        instruction: [{
          type: 'text',
          text: [
            `You play black in game ${game.number}. The previous action was ${previous(game.state)}.`,
            instructions.challenger,
          ].join('\n'),
        }],
      }
    }

    const pending = active.filter(game => game.state.moveNumber % 2 === 1)
    return {
      kind: 'act',
      characterId: master,
      instruction: [{
        type: 'text',
        text: [
          `You play white. Respond to every pending game: ${pending.map(game => game.number).join(', ')}.`,
          ...pending.map(game => `Game ${game.number}: ${previous(game.state)}.`),
          instructions.master,
        ].join('\n'),
      }],
    }
  }
}

export function apply(ctx: Context, config: Config): void {
  ctx.theater.registerDirector(createDirector(config))
}
