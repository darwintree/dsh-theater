import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { theaterEventFromSessionEvent } from '@darwintree/dsh-theater'
import type {
  GomokuCell,
  GomokuCharacter,
  GomokuConfig,
  GomokuMove,
  GomokuState,
  GomokuTransition,
} from './types.js'
import type { GomokuMoveEvent } from './events.js'

export const DEFAULT_GOMOKU_CONFIG: GomokuConfig = Object.freeze({
  boardSize: 15,
  winLength: 5,
})

function readInteger(record: Record<string, unknown>, key: string, fallback: number): number {
  const value = record[key] ?? fallback
  if (!Number.isSafeInteger(value)) throw new Error(`Gomoku config ${key} must be an integer`)
  return value as number
}

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
  move: GomokuMove,
  dx: number,
  dy: number,
): number {
  let count = 0
  let x = move.x + dx
  let y = move.y + dy
  while (board[y]?.[x] === move.character) {
    count += 1
    x += dx
    y += dy
  }
  return count
}

function isWinningMove(
  board: readonly (readonly GomokuCell[])[],
  move: GomokuMove,
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

function otherCharacter(character: GomokuCharacter): GomokuCharacter {
  return character === 'black' ? 'white' : 'black'
}

export function validateAndApplyGomokuMove(
  state: Readonly<GomokuState>,
  config: GomokuConfig,
  move: GomokuMove,
): GomokuTransition {
  if (state.isFinished) return { ok: false, reason: 'the game is already finished' }
  if (move.character !== state.currentPlayer) {
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
  row[move.x] = move.character

  const moveNumber = state.moveNumber + 1
  const winner = isWinningMove(board, move, config.winLength) ? move.character : undefined
  const isDraw = winner === undefined && moveNumber === config.boardSize * config.boardSize

  return {
    ok: true,
    state: {
      board,
      currentPlayer: otherCharacter(move.character),
      moveNumber,
      lastMove: { ...move },
      ...(winner === undefined ? {} : { winner }),
      isDraw,
      isFinished: winner !== undefined || isDraw,
    },
  }
}

export function applyCommittedGomokuMove(
  state: Readonly<GomokuState>,
  config: GomokuConfig,
  event: GomokuMoveEvent,
): GomokuState {
  const transition = validateAndApplyGomokuMove(state, config, {
    character: event.character,
    x: event.x,
    y: event.y,
  })
  if (!transition.ok) {
    throw new Error(
      `invalid committed Gomoku move ${event.character}@${event.x},${event.y}: ${transition.reason}`,
    )
  }
  return transition.state
}

export function foldGomokuState(
  events: readonly SessionEvent[],
  config: GomokuConfig,
): GomokuState {
  let state = createInitialGomokuState(config)
  for (const event of events) {
    const theaterEvent = theaterEventFromSessionEvent(event)
    if (theaterEvent?.type === 'gomoku/move') {
      state = applyCommittedGomokuMove(state, config, theaterEvent.data)
    }
  }
  return state
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

export function renderGomokuTurnPrompt(state: Readonly<GomokuState>): string {
  const role = state.currentPlayer === 'black' ? 'black (●)' : 'white (○)'
  const lastMove = state.lastMove === undefined
    ? 'No stones have been placed.'
    : `Last move: ${state.lastMove.character} at ${formatGomokuCoordinate(state.lastMove.x, state.lastMove.y)}.`
  return [
    `You are playing ${role}.`,
    '',
    renderGomokuBoard(state),
    '',
    lastMove,
    'It is your turn. Use place_stone exactly once to commit a legal move.',
  ].join('\n')
}
