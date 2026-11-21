import type { Context } from '@deepseek-ai/cordis'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { StateMachine, StateMachineFactory } from '@darwintree/dsh-stage'
import type { TheaterToolFactory } from '@darwintree/dsh-theater'

export interface TestGameState {
  readonly currentPlayer: 'black' | 'white'
  readonly moveNumber: number
  readonly lastMove?: { readonly color: 'black' | 'white'; readonly x: number; readonly y: number }
  readonly winner?: 'black' | 'white'
  readonly isFinished: boolean
}

interface TestGameConfig {
  readonly target: number
  readonly boardSize: number
}

function parseConfig(input: unknown): TestGameConfig {
  if (input === undefined) return { target: 5, boardSize: 3 }
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('test-game config must be an object')
  }
  const raw = input as Record<string, unknown>
  const target = raw.target ?? 5
  const boardSize = raw.boardSize ?? 3
  if (!Number.isSafeInteger(target) || (target as number) < 1) {
    throw new Error('test-game target must be a positive integer')
  }
  if (!Number.isSafeInteger(boardSize) || (boardSize as number) < 1) {
    throw new Error('test-game boardSize must be a positive integer')
  }
  return { target: target as number, boardSize: boardSize as number }
}

class TestGameMachine implements StateMachine {
  readonly kind = 'test-game'
  readonly version = '1'
  private state: TestGameState = {
    currentPlayer: 'black',
    moveNumber: 0,
    isFinished: false,
  }

  constructor(private readonly config: TestGameConfig) {}

  transition(op: JsonValue) {
    if (typeof op !== 'object' || op === null || Array.isArray(op)) {
      throw new Error('test-game op must be an object')
    }
    const raw = op as Record<string, unknown>
    if (raw.type !== 'move') throw new Error(`unknown test-game op: ${String(raw.type)}`)
    const color = raw.color
    const x = raw.x
    const y = raw.y
    if (color !== 'black' && color !== 'white') throw new Error('color must be black or white')
    if (typeof x !== 'number' || typeof y !== 'number') throw new Error('coordinates must be numbers')
    if (this.state.isFinished) return { kind: 'domain-rejected' as const, reason: 'the game is already finished' }
    if (color !== this.state.currentPlayer) return { kind: 'domain-rejected' as const, reason: `it is ${this.state.currentPlayer}'s turn` }
    if (x < 0 || y < 0 || x >= this.config.boardSize || y >= this.config.boardSize) {
      return { kind: 'domain-rejected' as const, reason: 'coordinate is outside the board' }
    }
    const moveNumber = this.state.moveNumber + 1
    const isFinished = moveNumber >= this.config.target
    this.state = {
      currentPlayer: color === 'black' ? 'white' : 'black',
      moveNumber,
      lastMove: { color, x, y },
      ...isFinished ? { winner: color } : {},
      isFinished,
    }
    return { kind: 'accepted' as const }
  }

  read(): JsonValue {
    return {
      ...this.state,
      ...this.state.lastMove === undefined ? {} : { lastMove: { ...this.state.lastMove } },
    } as unknown as JsonValue
  }

  get completed(): boolean {
    return this.state.isFinished
  }
}

export const testGameFactory: StateMachineFactory = {
  kind: 'test-game',
  version: '1',
  resolveConfig: input => parseConfig(input) as unknown as JsonValue,
  create: config => new TestGameMachine(config as unknown as TestGameConfig),
}

export const testReadBoardToolFactory: TheaterToolFactory = {
  kind: 'test-read-board',
  resolveConfig(input) {
    const raw = input as Record<string, unknown>
    if (typeof raw?.stage !== 'string' || raw.stage.trim() === '') throw new Error('stage must be non-empty')
    return { stage: raw.stage }
  },
  create(config, context) {
    const stage = context.stage((config as { stage: string }).stage)
    return defineTool({
      name: 'read_board',
      description: 'Read current test-game state.',
      parameters: {},
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      async execute() {
        return JSON.stringify(stage.read())
      },
    })
  },
}

export const testPlaceStoneToolFactory: TheaterToolFactory = {
  kind: 'test-place-stone',
  resolveConfig(input) {
    const raw = input as Record<string, unknown>
    if (typeof raw?.stage !== 'string' || raw.stage.trim() === '') throw new Error('stage must be non-empty')
    if (raw.color !== 'black' && raw.color !== 'white') throw new Error('color must be black or white')
    return { stage: raw.stage, color: raw.color }
  },
  create(config, context) {
    const bound = config as { stage: string; color: 'black' | 'white' }
    const stage = context.stage(bound.stage)
    return defineTool({
      name: 'place_stone',
      description: `Make one ${bound.color} move.`,
      parameters: {
        x: { type: 'integer', required: true },
        y: { type: 'integer', required: true },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            accepted: { type: 'boolean', required: true },
            reason: { type: 'string' },
          },
        },
        render: (_args, value) => [{
          type: 'text',
          text: value.accepted ? 'accepted' : `rejected: ${value.reason ?? ''}`,
        }],
      },
      async execute(args, exec) {
        const result = await stage.interact({ type: 'move', color: bound.color, x: args.x, y: args.y })
        if (result.kind === 'accepted') {
          exec.concludeTurn()
          return { accepted: true }
        }
        return { accepted: false, reason: result.reason }
      },
    })
  },
}

export const TestGameStagePlugin = {
  name: 'test-game-stage',
  inject: ['stages'] as const,
  apply(ctx: Context): void {
    ctx.stages.registerFactory(testGameFactory)
  },
}

export const TestGameTheaterPlugin = {
  name: 'test-game-theater',
  inject: ['theater'] as const,
  apply(ctx: Context): void {
    ctx.theater.registerToolFactory(testReadBoardToolFactory)
    ctx.theater.registerToolFactory(testPlaceStoneToolFactory)
  },
}
