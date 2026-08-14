import type { CallId } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { GomokuCharacter } from './types.js'

export interface GomokuMoveEvent {
  sourceSessionId: SessionId
  callId: CallId
  character: GomokuCharacter
  x: number
  y: number
}

declare module '@darwintree/dsh-theater' {
  interface TheaterEventMap {
    'gomoku/move': GomokuMoveEvent
  }
}
