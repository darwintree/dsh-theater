import type { JsonValue } from '@deepseek-ai/dsh-session'
import type { StateMachine, StateMachineFactory } from '@darwintree/dsh-stage'
import type { GomokuConfig, GomokuOp, GomokuState } from './types.js'
import {
  createInitialGomokuState,
  GOMOKU_KIND,
  GOMOKU_VERSION,
  parseGomokuConfig,
  validateAndApplyGomokuMove,
} from './state.js'

/**
 * A pure Gomoku State Machine: it owns live board state and the deterministic
 * domain rules (rotation, bounds, occupancy, win/draw, terminal rejection). It
 * never touches Context, Session, events, or flush; the Stage Service owns
 * persistence. The same canonical place-stone Op drives live transitions and
 * replay.
 */
export class GomokuMachine implements StateMachine {
  readonly kind = GOMOKU_KIND
  readonly version = GOMOKU_VERSION
  private state: GomokuState

  constructor(private readonly config: GomokuConfig) {
    this.state = createInitialGomokuState(config)
  }

  transition(op: JsonValue) {
    const move = op as unknown as GomokuOp
    if (move.type !== 'place-stone') {
      return { kind: 'domain-rejected' as const, reason: 'unknown Gomoku interaction' }
    }
    if (move.color !== 'black' && move.color !== 'white') {
      return { kind: 'domain-rejected' as const, reason: 'stone color must be black or white' }
    }
    const transition = validateAndApplyGomokuMove(this.state, this.config, move)
    if (!transition.ok) return { kind: 'domain-rejected' as const, reason: transition.reason }
    this.state = transition.state
    return { kind: 'accepted' as const }
  }

  read(): JsonValue {
    return {
      ...this.state,
      board: this.state.board.map(row => [...row]),
      ...(this.state.lastMove === undefined ? {} : { lastMove: { ...this.state.lastMove } }),
    } as unknown as JsonValue
  }

  get completed(): boolean {
    return this.state.isFinished
  }
}

/** Construction capability for Gomoku State Machines. */
export const gomokuFactory: StateMachineFactory = {
  kind: GOMOKU_KIND,
  version: GOMOKU_VERSION,
  resolveConfig(input: unknown): JsonValue {
    return parseGomokuConfig(input) as unknown as JsonValue
  },
  create(config: JsonValue): StateMachine {
    return new GomokuMachine(config as unknown as GomokuConfig)
  },
}
