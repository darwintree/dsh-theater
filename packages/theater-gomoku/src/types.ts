/** The black or white value placed on the board; a game value, not an identity. */
export type StoneColor = 'black' | 'white'

export type GomokuCell = StoneColor | null

/** Board-size and win-length configuration, defaulting to 15×15 and 5. */
export interface GomokuConfig {
  boardSize: number
  winLength: number
}

/** One canonical Gomoku Op: place a stone of a color at integer coordinates. */
export interface GomokuOp {
  type: 'place-stone'
  color: StoneColor
  x: number
  y: number
}

/** The latest board state, returned as a detached JSON snapshot. */
export interface GomokuState {
  board: GomokuCell[][]
  currentPlayer: StoneColor
  moveNumber: number
  lastMove?: GomokuOp
  winner?: StoneColor
  isDraw: boolean
  isFinished: boolean
}

