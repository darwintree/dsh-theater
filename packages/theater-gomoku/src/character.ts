import type { JsonValue } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { TheaterToolFactory } from '@darwintree/dsh-theater'
import { renderGomokuBoard } from './state.js'
import type { GomokuState, StoneColor } from './types.js'

export const GOMOKU_READ_BOARD_TOOL = 'gomoku-read-board'
export const GOMOKU_PLACE_STONE_TOOL = 'gomoku-place-stone'

interface BoardValue {
  board: string
  currentPlayer: StoneColor
  moveNumber: number
  winner?: StoneColor
  isDraw: boolean
  isFinished: boolean
}

interface MoveValue extends BoardValue {
  accepted: boolean
  color: StoneColor
  x?: number
  y?: number
  reason?: string
}

function record(input: unknown, label: string): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error(`${label} must be an object`)
  }
  return input as Record<string, unknown>
}

function stageId(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error('stage must be non-empty')
  return value
}

function color(value: unknown): StoneColor {
  if (value !== 'black' && value !== 'white') throw new Error('color must be black or white')
  return value
}

function readConfig(input: unknown): { stage: string } {
  const value = record(input, GOMOKU_READ_BOARD_TOOL)
  return { stage: stageId(value.stage) }
}

function placeConfig(input: unknown): { stage: string; color: StoneColor } {
  const value = record(input, GOMOKU_PLACE_STONE_TOOL)
  return { stage: stageId(value.stage), color: color(value.color) }
}

function boardValue(state: GomokuState): BoardValue {
  return {
    board: renderGomokuBoard(state),
    currentPlayer: state.currentPlayer,
    moveNumber: state.moveNumber,
    ...state.winner === undefined ? {} : { winner: state.winner },
    isDraw: state.isDraw,
    isFinished: state.isFinished,
  }
}

const boardSchema = {
  type: 'object' as const,
  additionalProperties: false,
  properties: {
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
  return `${value.board}\n\n${tail}`
}

export const gomokuReadBoardToolFactory: TheaterToolFactory = {
  kind: GOMOKU_READ_BOARD_TOOL,
  resolveConfig(input) {
    return readConfig(input) as JsonValue
  },
  create(config, resolveStage) {
    const stage = resolveStage(readConfig(config).stage)
    return defineTool({
      name: 'read_board',
      description: 'Read the complete authoritative Gomoku board and current game state.',
      parameters: {},
      output: {
        schema: boardSchema,
        render: (_args, value: BoardValue) => [{ type: 'text', text: renderBoard(value) }],
      },
      async execute() {
        return boardValue(stage.read() as unknown as GomokuState)
      },
    })
  },
}

export const gomokuPlaceStoneToolFactory: TheaterToolFactory = {
  kind: GOMOKU_PLACE_STONE_TOOL,
  resolveConfig(input) {
    return placeConfig(input) as JsonValue
  },
  create(config, resolveStage) {
    const bound = placeConfig(config)
    const stage = resolveStage(bound.stage)
    return defineTool({
      name: 'place_stone',
      description: `Place one ${bound.color} stone at zero-based coordinates. Color is fixed by this Character.`,
      parameters: {
        x: { type: 'integer', required: true, description: 'Zero-based column index.' },
        y: { type: 'integer', required: true, description: 'Zero-based row index.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ...boardSchema.properties,
            accepted: { type: 'boolean', required: true },
            color: { type: 'string', required: true },
            x: { type: 'integer' },
            y: { type: 'integer' },
            reason: { type: 'string' },
          },
        },
        render: (_args, value: MoveValue) => [{
          type: 'text',
          text: `${value.accepted ? `${value.color} stone accepted.` : `Move rejected: ${value.reason}.`}\n\n${renderBoard(value)}`,
        }],
      },
      async execute(args, exec) {
        const result = await stage.interact({
          type: 'place-stone',
          color: bound.color,
          x: args.x,
          y: args.y,
        })
        const state = stage.read() as unknown as GomokuState
        const value: MoveValue = result.kind === 'domain-rejected'
          ? { accepted: false, color: bound.color, reason: result.reason, ...boardValue(state) }
          : { accepted: true, color: bound.color, x: args.x, y: args.y, ...boardValue(state) }
        if (result.kind === 'accepted') exec.concludeTurn()
        return value
      },
    })
  },
}
