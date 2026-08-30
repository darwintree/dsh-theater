import type { JsonValue } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { TheaterStageHandle, TheaterToolFactory } from '@darwintree/dsh-theater'
import { renderGomokuBoard, type GomokuState } from '@darwintree/dsh-theater-gomoku'

export const MASTER_READ_BOARD_TOOL = 'three-board-gomoku-read-board'
export const MASTER_PLACE_STONE_TOOL = 'three-board-gomoku-place-stone'

interface BoardValue {
  game: number
  board: string
  currentPlayer: 'black' | 'white'
  moveNumber: number
  winner?: 'black' | 'white'
  isDraw: boolean
  isFinished: boolean
}

interface MoveValue extends BoardValue {
  accepted: boolean
  x?: number
  y?: number
  reason?: string
}

function parseConfig(input: unknown): { stages: string[] } {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('master Gomoku Tool config must be an object')
  }
  const value = input as Record<string, unknown>
  if (!Array.isArray(value.stages) || value.stages.length !== 3) {
    throw new Error('master Gomoku Tool requires exactly three stages')
  }
  const stages = value.stages.map((stage) => {
    if (typeof stage !== 'string' || stage.trim() === '') throw new Error('master Gomoku stage must be non-empty')
    return stage
  })
  if (new Set(stages).size !== stages.length) throw new Error('master Gomoku stages must be unique')
  return { stages }
}

function resolveStages(
  input: JsonValue,
  resolveStage: (stageId: string) => TheaterStageHandle,
): TheaterStageHandle[] {
  return parseConfig(input).stages.map(resolveStage)
}

function selected(stages: readonly TheaterStageHandle[], game: number): TheaterStageHandle {
  const stage = stages[game - 1]
  if (stage === undefined) throw new Error(`game must be between 1 and ${stages.length}`)
  return stage
}

function boardValue(game: number, state: GomokuState): BoardValue {
  return {
    game,
    board: renderGomokuBoard(state),
    currentPlayer: state.currentPlayer,
    moveNumber: state.moveNumber,
    ...state.winner === undefined ? {} : { winner: state.winner },
    isDraw: state.isDraw,
    isFinished: state.isFinished,
  }
}

const gameParameter = {
  type: 'integer' as const,
  required: true as const,
  enum: [1, 2, 3],
  description: 'Game number: 1, 2, or 3.',
}

const boardSchema = {
  type: 'object' as const,
  additionalProperties: false,
  properties: {
    game: { type: 'integer' as const, required: true },
    board: { type: 'string' as const, required: true },
    currentPlayer: { type: 'string' as const, required: true },
    moveNumber: { type: 'integer' as const, required: true },
    winner: { type: 'string' as const },
    isDraw: { type: 'boolean' as const, required: true },
    isFinished: { type: 'boolean' as const, required: true },
  },
} as const

function renderBoard(value: BoardValue): string {
  let tail = `It is ${value.currentPlayer}'s turn.`
  if (value.isDraw) tail = 'The game is a draw.'
  else if (value.isFinished) tail = `${value.winner} wins.`
  return `Game ${value.game}\n${value.board}\n\n${tail}`
}

export const masterReadBoardToolFactory: TheaterToolFactory = {
  kind: MASTER_READ_BOARD_TOOL,
  resolveConfig(input) {
    return parseConfig(input) as JsonValue
  },
  create(config, resolveStage) {
    const stages = resolveStages(config, resolveStage)
    return defineTool({
      name: 'read_board',
      description: 'Read one of the three authoritative Gomoku boards by game number.',
      parameters: { game: gameParameter },
      output: {
        schema: boardSchema,
        render: (_args, value: BoardValue) => [{ type: 'text', text: renderBoard(value) }],
      },
      async execute(args) {
        return boardValue(args.game, selected(stages, args.game).read() as unknown as GomokuState)
      },
    })
  },
}

export const masterPlaceStoneToolFactory: TheaterToolFactory = {
  kind: MASTER_PLACE_STONE_TOOL,
  resolveConfig(input) {
    return parseConfig(input) as JsonValue
  },
  create(config, resolveStage) {
    const stages = resolveStages(config, resolveStage)
    return defineTool({
      name: 'place_stone',
      description: 'Place one white stone in a game. Game is selected by number; color is fixed to white.',
      parameters: {
        game: gameParameter,
        x: { type: 'integer', required: true, description: 'Zero-based column index.' },
        y: { type: 'integer', required: true, description: 'Zero-based row index.' },
      },
      output: {
        schema: {
          ...boardSchema,
          properties: {
            ...boardSchema.properties,
            accepted: { type: 'boolean', required: true },
            x: { type: 'integer' },
            y: { type: 'integer' },
            reason: { type: 'string' },
          },
        },
        render: (_args, value: MoveValue) => [{
          type: 'text',
          text: `${value.accepted ? 'White stone accepted.' : `Move rejected: ${value.reason}.`}\n\n${renderBoard(value)}`,
        }],
      },
      async execute(args) {
        const stage = selected(stages, args.game)
        const result = await stage.interact({
          type: 'place-stone',
          color: 'white',
          x: args.x,
          y: args.y,
        })
        const base = boardValue(args.game, stage.read() as unknown as GomokuState)
        return result.kind === 'domain-rejected'
          ? { accepted: false, reason: result.reason, ...base }
          : { accepted: true, x: args.x, y: args.y, ...base }
      },
    })
  },
}
