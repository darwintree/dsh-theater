import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { gomokuFactory } from './machine.js'
import { renderGomokuBoard } from './state.js'
import type { GomokuState, StoneColor } from './types.js'

export const GOMOKU_STAGE_ID = 'gomoku'

export interface Config {
  color: StoneColor
}

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

function color(value: unknown): StoneColor {
  if (value !== 'black' && value !== 'white') throw new Error('Gomoku Character color must be black or white')
  return value
}

function ownerId(characterSessionId: string, characterId: StoneColor): ReturnType<typeof SessionId> {
  const suffix = `/characters/${encodeURIComponent(characterId)}`
  if (!characterSessionId.endsWith(suffix)) {
    throw new Error(`Character Session ${JSON.stringify(characterSessionId)} does not match ${characterId}`)
  }
  return SessionId(characterSessionId.slice(0, -suffix.length))
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

export const name = '@darwintree/dsh-theater-gomoku/character'
export const inject = ['sessions', 'stages', 'tools']

/** Register read-only and color-bound Gomoku tools for one Character preset. */
export function apply(ctx: Context, config: Config): void {
  const boundColor = color(config.color)
  const owner = (sessionId: string) => {
    const session = ctx.sessions.get(ownerId(sessionId, boundColor))
    if (session === undefined) throw new Error('owning Performance Session is not live')
    return session
  }
  ctx.tools.register(defineTool({
    name: 'read_board',
    description: 'Read the complete authoritative Gomoku board and current game state.',
    parameters: {},
    output: {
      schema: boardSchema,
      render: (_args, value: BoardValue) => [{ type: 'text', text: renderBoard(value) }],
    },
    async execute(_args, exec) {
      if (exec.agent === undefined) throw new Error('read_board requires a calling Character')
      const session = owner(String(exec.agent.session.id))
      await ctx.stages.ensure(session, GOMOKU_STAGE_ID, { factory: gomokuFactory })
      return boardValue(ctx.stages.read(session, GOMOKU_STAGE_ID) as unknown as GomokuState)
    },
  }))
  ctx.tools.register(defineTool({
    name: 'place_stone',
    description: `Place one ${boundColor} stone at zero-based coordinates. Color is fixed by this Character.`,
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
      if (exec.agent === undefined) throw new Error('place_stone requires a calling Character')
      const session = owner(String(exec.agent.session.id))
      await ctx.stages.ensure(session, GOMOKU_STAGE_ID, { factory: gomokuFactory })
      const result = await ctx.stages.interact(session, GOMOKU_STAGE_ID, {
        type: 'place-stone',
        color: boundColor,
        x: args.x,
        y: args.y,
      })
      const state = ctx.stages.read(session, GOMOKU_STAGE_ID) as unknown as GomokuState
      const value: MoveValue = result.kind === 'domain-rejected'
        ? { accepted: false, color: boundColor, reason: result.reason, ...boardValue(state) }
        : { accepted: true, color: boundColor, x: args.x, y: args.y, ...boardValue(state) }
      if (result.kind === 'accepted') exec.concludeTurn()
      return value
    },
  }))
}
