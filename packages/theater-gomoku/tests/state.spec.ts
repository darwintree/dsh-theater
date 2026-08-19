import { describe, expect, it } from 'vitest'
import { GomokuMachine } from '../src/machine.ts'
import {
  createInitialGomokuState,
  parseGomokuConfig,
  validateAndApplyGomokuMove,
} from '../src/state.ts'
import type { GomokuConfig, GomokuOp, GomokuState, StoneColor } from '../src/types.ts'

const NINE = parseGomokuConfig({ boardSize: 9, winLength: 5 })

function move(color: StoneColor, x: number, y: number): GomokuOp {
  return { type: 'place-stone', color, x, y }
}

function play(state: GomokuState, config: GomokuConfig, color: StoneColor, x: number, y: number): GomokuState {
  const transition = validateAndApplyGomokuMove(state, config, move(color, x, y))
  expect(transition.ok).toBe(true)
  if (!transition.ok) throw new Error('expected accepted move')
  return transition.state
}

function playLine(config: GomokuConfig, moves: ReadonlyArray<readonly [StoneColor, number, number]>): GomokuState {
  let state = createInitialGomokuState(config)
  for (const [color, x, y] of moves) state = play(state, config, color, x, y)
  return state
}

describe('Gomoku State Machine rules', () => {
  it('begins with black and alternates players', () => {
    const initial = createInitialGomokuState(NINE)
    expect(initial.currentPlayer).toBe('black')
    expect(initial.moveNumber).toBe(0)
    expect(initial.isFinished).toBe(false)

    const afterBlack = play(initial, NINE, 'black', 4, 4)
    expect(afterBlack.currentPlayer).toBe('white')
    expect(afterBlack.moveNumber).toBe(1)
    expect(afterBlack.lastMove).toEqual({ type: 'place-stone', color: 'black', x: 4, y: 4 })
  })

  it('rejects a wrong stone color (black/white rotation)', () => {
    const initial = createInitialGomokuState(NINE)
    const result = validateAndApplyGomokuMove(initial, NINE, move('white', 4, 4))
    expect(result).toEqual({ ok: false, reason: "it is black's turn" })
  })

  it('rejects non-integer coordinates', () => {
    const initial = createInitialGomokuState(NINE)
    const result = validateAndApplyGomokuMove(initial, NINE, { type: 'place-stone', color: 'black', x: 1.5, y: 0 })
    expect(result).toEqual({ ok: false, reason: 'coordinates must be integers' })
  })

  it('rejects coordinates outside the board', () => {
    const initial = createInitialGomokuState(NINE)
    expect(validateAndApplyGomokuMove(initial, NINE, move('black', -1, 0)))
      .toEqual({ ok: false, reason: 'coordinate is outside the board' })
    expect(validateAndApplyGomokuMove(initial, NINE, move('black', 0, 9)))
      .toEqual({ ok: false, reason: 'coordinate is outside the board' })
    expect(validateAndApplyGomokuMove(initial, NINE, move('black', 9, 0)))
      .toEqual({ ok: false, reason: 'coordinate is outside the board' })
  })

  it('rejects an occupied cell without changing state', () => {
    const state = play(createInitialGomokuState(NINE), NINE, 'black', 4, 4)
    const result = validateAndApplyGomokuMove(state, NINE, move('white', 4, 4))
    expect(result).toEqual({ ok: false, reason: 'coordinate is occupied' })
  })

  it('rejects moves after the game is finished', () => {
    const config = parseGomokuConfig({ boardSize: 3, winLength: 3 })
    const state = playLine(config, [
      ['black', 0, 0], ['white', 1, 0],
      ['black', 0, 1], ['white', 1, 1],
      ['black', 0, 2],
    ])
    expect(state.isFinished).toBe(true)
    expect(state.winner).toBe('black')
    const result = validateAndApplyGomokuMove(state, config, move('white', 1, 2))
    expect(result).toEqual({ ok: false, reason: 'the game is already finished' })
  })

  it('detects a horizontal five-in-a-row win', () => {
    const state = playLine(NINE, [
      ['black', 0, 0], ['white', 0, 1],
      ['black', 1, 0], ['white', 1, 1],
      ['black', 2, 0], ['white', 2, 1],
      ['black', 3, 0], ['white', 3, 1],
      ['black', 4, 0],
    ])
    expect(state.winner).toBe('black')
    expect(state.isFinished).toBe(true)
  })

  it('detects a vertical five-in-a-row win', () => {
    const state = playLine(NINE, [
      ['black', 0, 0], ['white', 1, 0],
      ['black', 0, 1], ['white', 1, 1],
      ['black', 0, 2], ['white', 1, 2],
      ['black', 0, 3], ['white', 1, 3],
      ['black', 0, 4],
    ])
    expect(state.winner).toBe('black')
    expect(state.isFinished).toBe(true)
  })

  it('detects a diagonal five-in-a-row win', () => {
    const state = playLine(NINE, [
      ['black', 0, 0], ['white', 1, 0],
      ['black', 1, 1], ['white', 2, 1],
      ['black', 2, 2], ['white', 3, 2],
      ['black', 3, 3], ['white', 4, 3],
      ['black', 4, 4],
    ])
    expect(state.winner).toBe('black')
    expect(state.isFinished).toBe(true)
  })

  it('detects a draw when the board fills with no winning line', () => {
    const config = parseGomokuConfig({ boardSize: 3, winLength: 3 })
    // A 3x3 cat's game: every row, column, and diagonal splits between colors.
    const state = playLine(config, [
      ['black', 0, 0], ['white', 1, 0], ['black', 2, 0],
      ['white', 1, 1], ['black', 0, 1], ['white', 2, 1],
      ['black', 1, 2], ['white', 0, 2], ['black', 2, 2],
    ])
    expect(state.moveNumber).toBe(9)
    expect(state.winner).toBeUndefined()
    expect(state.isDraw).toBe(true)
    expect(state.isFinished).toBe(true)
  })

  it('returns a domain-rejected transition without changing state via the machine', () => {
    const machine = new GomokuMachine(NINE)
    expect(machine.transition(move('black', 4, 4))).toEqual({ kind: 'accepted' })
    expect(machine.transition(move('white', 4, 4)))
      .toEqual({ kind: 'domain-rejected', reason: 'coordinate is occupied' })
    expect((machine.read() as GomokuState).currentPlayer).toBe('white')
    expect(machine.completed).toBe(false)
  })

  it('rejects an unknown interaction kind via the machine', () => {
    const machine = new GomokuMachine(NINE)
    expect(machine.transition({ type: 'pass' } as unknown as never))
      .toEqual({ kind: 'domain-rejected', reason: 'unknown Gomoku interaction' })
  })
});
