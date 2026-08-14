import { describe, expect, it } from 'vitest'
import {
  createInitialGomokuState,
  parseGomokuConfig,
  validateAndApplyGomokuMove,
} from '../src/state.js'

describe('Gomoku state', () => {
  it('alternates players and rejects occupied cells', () => {
    const config = parseGomokuConfig({ boardSize: 9, winLength: 5 })
    const initial = createInitialGomokuState(config)
    const black = validateAndApplyGomokuMove(initial, config, { character: 'black', x: 4, y: 4 })
    expect(black.ok).toBe(true)
    if (!black.ok) return
    expect(black.state.currentPlayer).toBe('white')

    const occupied = validateAndApplyGomokuMove(black.state, config, { character: 'white', x: 4, y: 4 })
    expect(occupied).toEqual({ ok: false, reason: 'coordinate is occupied' })
  })

  it('detects five in a row', () => {
    const config = parseGomokuConfig({ boardSize: 9, winLength: 5 })
    let state = createInitialGomokuState(config)
    const moves = [
      ['black', 0, 0], ['white', 0, 1],
      ['black', 1, 0], ['white', 1, 1],
      ['black', 2, 0], ['white', 2, 1],
      ['black', 3, 0], ['white', 3, 1],
      ['black', 4, 0],
    ] as const

    for (const [character, x, y] of moves) {
      const transition = validateAndApplyGomokuMove(state, config, { character, x, y })
      expect(transition.ok).toBe(true)
      if (!transition.ok) return
      state = transition.state
    }

    expect(state.winner).toBe('black')
    expect(state.isFinished).toBe(true)
  })
})
