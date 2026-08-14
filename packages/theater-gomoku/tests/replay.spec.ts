import { describe, expect, it } from 'vitest'
import { CallId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { TheaterPerformance } from '@darwintree/dsh-theater'
import { gomokuScenario } from '../src/scenario.js'
import { foldGomokuState, parseGomokuConfig } from '../src/state.js'
import '../src/events.js'

describe('Gomoku replay', () => {
  it('folds committed moves from the performance session', () => {
    const config = parseGomokuConfig({ boardSize: 9, winLength: 5 })
    const session = Session.create(SessionId('theater:game-1'))
    const performance = new TheaterPerformance(
      'game-1',
      session,
      gomokuScenario,
      config,
      { black: SessionId('black'), white: SessionId('white') },
      { flush: async () => false },
    )

    performance.append('gomoku/move', {
      sourceSessionId: SessionId('black'),
      callId: CallId('call-1'),
      character: 'black',
      x: 4,
      y: 4,
    }, 'black placed a stone at E5.')

    const state = foldGomokuState(session.events, config)
    expect(state.board[4]?.[4]).toBe('black')
    expect(state.currentPlayer).toBe('white')
    expect(performance.recommendNextTurn()?.character).toBe('white')
  })
})
