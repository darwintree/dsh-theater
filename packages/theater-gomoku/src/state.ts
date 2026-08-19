import type {
  GomokuCell,
  GomokuConfig,
  GomokuOp,
  GomokuState,
  StoneColor,
} from './types.js'

export const GOMOKU_KIND = 'gomoku'
export const GOMOKU_VERSION = '1'

export const DEFAULT_GOMOKU_CONFIG: GomokuConfig = Object.freeze({
  boardSize: 15,
  winLength: 5,
})

function readInteger(record: Record<string, unknown>, key: string, fallback: number): number {
  const value = record[key] ?? fallback
  if (!Number.isSafeInteger(value)) throw new Error(`Gomoku config ${key} must be an integer`)
  return value as number
}

/** Validate board-size and win-length so malformed games fail before play begins. */
export function parseGomokuConfig(input: unknown): GomokuConfig {
  if (input === undefined) return { ...DEFAULT_GOMOKU_CONFIG }
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('Gomoku config must be an object')
  }
  const record = input as Record<string, unknown>
  const unknown = Object.keys(record).filter(key => key !== 'boardSize' && key !== 'winLength')
  if (unknown.length > 0) throw new Error(`unknown Gomoku config field(s): ${unknown.join(', ')}`)
  const boardSize = readInteger(record, 'boardSize', DEFAULT_GOMOKU_CONFIG.boardSize)
  const winLength = readInteger(record, 'winLength', DEFAULT_GOMOKU_CONFIG.winLength)
  if (boardSize < 3 || boardSize > 25) throw new Error('Gomoku boardSize must be between 3 and 25')
  if (winLength < 3 || winLength > boardSize) {
    throw new Error('Gomoku winLength must be between 3 and boardSize')
  }
  return { boardSize, winLength }
}

export function createInitialGomokuState(config: GomokuConfig): GomokuState {
  return {
    board: Array.from({ length: config.boardSize }, () =>
      Array<GomokuCell>(config.boardSize).fill(null)),
    currentPlayer: 'black',
    moveNumber: 0,
    isDraw: false,
    isFinished: false,
  }
}

function inBounds(config: GomokuConfig, x: number, y: number): boolean {
  return x >= 0 && x < config.boardSize && y >= 0 && y < config.boardSize
}

function countDirection(
  board: readonly (readonly GomokuCell[])[],
  move: GomokuOp,
  dx: number,
  dy: number,
): number {
  let count = 0
  let x = move.x + dx
  let y = move.y + dy
  while (board[y]?.[x] === move.color) {
    count += 1
    x += dx
    y += dy
  }
  return count
}

function isWinningMove(
  board: readonly (readonly GomokuCell[])[],
  move: GomokuOp,
  winLength: number,
): boolean {
  const axes: ReadonlyArray<readonly [number, number]> = [
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1],
  ]
  return axes.some(([dx, dy]) =>
    1
    + countDirection(board, move, dx, dy)
    + countDirection(board, move, -dx, -dy)
    >= winLength)
}

function otherColor(color: StoneColor): StoneColor {
  return color === 'black' ? 'white' : 'black'
}

export type GomokuTransition =
  | { ok: false; reason: string }
  | { ok: true; state: GomokuState }

/**
 * Validate and apply one Gomoku move against the current state. Enforces
 * integer coordinates, bounds, occupancy, black/white rotation, and terminal
 * rejection; detects five-in-a-row wins and draws. Returns the next state on
 * success or a domain reason without changing state.
 */
export function validateAndApplyGomokuMove(
  state: Readonly<GomokuState>,
  config: GomokuConfig,
  move: GomokuOp,
): GomokuTransition {
  if (state.isFinished) return { ok: false, reason: 'the game is already finished' }
  if (move.color !== state.currentPlayer) {
    return { ok: false, reason: `it is ${state.currentPlayer}'s turn` }
  }
  if (!Number.isSafeInteger(move.x) || !Number.isSafeInteger(move.y)) {
    return { ok: false, reason: 'coordinates must be integers' }
  }
  if (!inBounds(config, move.x, move.y)) return { ok: false, reason: 'coordinate is outside the board' }
  if (state.board[move.y]?.[move.x] !== null) return { ok: false, reason: 'coordinate is occupied' }

  const board = state.board.map(row => [...row])
  const row = board[move.y]
  if (row === undefined) return { ok: false, reason: 'coordinate is outside the board' }
  row[move.x] = move.color

  const moveNumber = state.moveNumber + 1
  const winner = isWinningMove(board, move, config.winLength) ? move.color : undefined
  const isDraw = winner === undefined && moveNumber === config.boardSize * config.boardSize

  return {
    ok: true,
    state: {
      board,
      currentPlayer: otherColor(move.color),
      moveNumber,
      lastMove: { ...move },
      ...(winner === undefined ? {} : { winner }),
      isDraw,
      isFinished: winner !== undefined || isDraw,
    },
  }
}

export function formatGomokuCoordinate(x: number, y: number): string {
  return `${String.fromCharCode(65 + x)}${y + 1}`
}

export function renderGomokuBoard(state: Readonly<GomokuState>): string {
  const header = `   ${state.board[0]?.map((_cell, x) => String.fromCharCode(65 + x)).join(' ') ?? ''}`
  const rows = state.board.map((row, y) => {
    const cells = row.map(cell => cell === 'black' ? '●' : cell === 'white' ? '○' : '·').join(' ')
    return `${String(y + 1).padStart(2, ' ')} ${cells}`
  })
  return [header, ...rows].join('\n')
}

