import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { StateMachineFactory } from '@darwintree/dsh-stage'
import type { GomokuConfig, GomokuState } from './types.js'
import { GOMOKU_KIND, formatGomokuCoordinate, renderGomokuBoard } from './state.js'
import { gomokuFactory } from './machine.js'

export interface PlaceStoneValue {
  accepted: boolean
  color: string
  x?: number
  y?: number
  reason?: string
  board: string
  currentPlayer: string
  moveNumber: number
  winner?: string
  isDraw: boolean
  isFinished: boolean
}

function renderResult(value: PlaceStoneValue): string {
  const coordinate = value.accepted && value.x !== undefined && value.y !== undefined
    ? formatGomokuCoordinate(value.x, value.y)
    : undefined
  const head = value.accepted
    ? `${value.color} stone committed at ${coordinate}.`
    : `Move rejected: ${value.reason ?? 'unknown reason'}.`
  const tail = value.isFinished
    ? value.isDraw
      ? 'The board is full — the game is a draw.'
      : `The game is finished — ${value.winner} wins.`
    : `It is ${value.currentPlayer}'s turn (move ${value.moveNumber + 1}).`
  return [head, '', value.board, '', tail].join('\n')
}

export interface GomokuToolOptions {
  /**
   * First-use config input. Defaults to the 15×15 board and win length 5 when
   * omitted; ignored once a Stage is already configured for the Session.
   */
  config?: unknown
  /**
   * Override the State Machine factory. Defaults to the bundled Gomoku
   * factory; supplied for tests that swap in alternative rules.
   */
  factory?: StateMachineFactory
}

/**
 * The global Gomoku `place_stone` tool. It derives a temporary Stage ID of
 * `${sessionId}-stage` from the calling Agent Session, lazily ensures or
 * restores the Gomoku Stage, applies one canonical place-stone Op, and renders
 * the complete updated board, winner, and completion state. The user plays
 * black and the Agent plays white; the Agent calls the tool once for the
 * user's directed black move and again for its own chosen white move before
 * replying. The tool does not call `concludeTurn()`.
 *
 * The registration context supplies `ctx.stages`; the calling Agent Session
 * supplies the Stage ID and is the authority for persistence.
 */
export function createGomokuTool(ctx: Context, options: GomokuToolOptions = {}) {
  const factory = options.factory ?? gomokuFactory
  return defineTool({
    name: 'place_stone',
    description:
      'Place exactly one Gomoku stone. Use color "black" for the user move and "white" for your own move, with zero-based x (column) and y (row) coordinates.',
    parameters: {
      color: {
        type: 'string',
        required: true,
        description: 'Stone color: "black" (the user) or "white" (the agent).',
        enum: ['black', 'white'],
      },
      x: { type: 'integer', required: true, description: 'Zero-based column index.' },
      y: { type: 'integer', required: true, description: 'Zero-based row index.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          accepted: { type: 'boolean', required: true },
          color: { type: 'string', required: true },
          x: { type: 'integer' },
          y: { type: 'integer' },
          reason: { type: 'string' },
          board: { type: 'string', required: true },
          currentPlayer: { type: 'string', required: true },
          moveNumber: { type: 'integer', required: true },
          winner: { type: 'string' },
          isDraw: { type: 'boolean', required: true },
          isFinished: { type: 'boolean', required: true },
        },
      },
      render: (_args, value: PlaceStoneValue) => [{ type: 'text', text: renderResult(value) }],
    },
    async execute(args, exec) {
      const agent = exec.agent
      if (agent === undefined) {
        throw new Error('place_stone requires a calling agent')
      }
      const sessionId = agent.session.id
      const stageId = `${sessionId}-stage`
      await ctx.stages.ensure(stageId, {
        session: agent.session,
        factory,
        config: options.config ?? {},
      })
      const result = await ctx.stages.interact(stageId, {
        type: 'place-stone',
        color: args.color,
        x: args.x,
        y: args.y,
      })
      const snapshot = ctx.stages.read(stageId) as unknown as GomokuState
      const base = {
        board: renderGomokuBoard(snapshot),
        currentPlayer: snapshot.currentPlayer,
        moveNumber: snapshot.moveNumber,
        isDraw: snapshot.isDraw,
        isFinished: snapshot.isFinished,
        ...(snapshot.winner === undefined ? {} : { winner: snapshot.winner }),
      }
      const value: PlaceStoneValue = result.kind === 'domain-rejected'
        ? { accepted: false, color: args.color, reason: result.reason, ...base }
        : { accepted: true, color: args.color, x: args.x, y: args.y, ...base }
      return value
    },
  })
}

export { GOMOKU_KIND }
export type { GomokuConfig }

