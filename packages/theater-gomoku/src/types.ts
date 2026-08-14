export type GomokuCharacter = 'black' | 'white'
export type GomokuCell = GomokuCharacter | null

export interface GomokuConfig {
  boardSize: number
  winLength: number
}

export interface GomokuMove {
  character: GomokuCharacter
  x: number
  y: number
}

export interface GomokuState {
  board: GomokuCell[][]
  currentPlayer: GomokuCharacter
  moveNumber: number
  lastMove?: GomokuMove
  winner?: GomokuCharacter
  isDraw: boolean
  isFinished: boolean
}

export type GomokuTransition =
  | { ok: false; reason: string }
  | { ok: true; state: GomokuState }
