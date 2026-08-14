import type { CallId } from '@deepseek-ai/dsh-llm'
import { defineTool, type ToolDefinition, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { TheaterPerformance } from '@darwintree/dsh-theater'
import type { GomokuConfig, GomokuCharacter } from './types.js'
import './events.js'
import {
  foldGomokuState,
  formatGomokuCoordinate,
  validateAndApplyGomokuMove,
} from './state.js'

interface PlaceStoneValue {
  accepted: boolean
  replayed?: boolean
  x?: number
  y?: number
  winner?: GomokuCharacter
  isDraw?: boolean
  reason?: string
}

function findCommittedCall(
  performance: TheaterPerformance<GomokuConfig>,
  sourceSessionId: SessionId,
  callId: CallId,
) {
  return performance.eventLog().find(event =>
    event.type === 'gomoku/move'
    && event.data.sourceSessionId === sourceSessionId
    && event.data.callId === callId)
}

export function createPlaceStoneTool(input: {
  character: GomokuCharacter
  performance: TheaterPerformance<GomokuConfig>
  config: GomokuConfig
}): ToolDefinition {
  return defineTool({
    name: 'place_stone',
    description: 'Place exactly one stone on the Gomoku board using zero-based x and y coordinates.',
    parameters: {
      x: { type: 'integer', required: true, description: 'Zero-based column index.' },
      y: { type: 'integer', required: true, description: 'Zero-based row index.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          accepted: { type: 'boolean', required: true },
          replayed: { type: 'boolean' },
          x: { type: 'integer' },
          y: { type: 'integer' },
          winner: { type: 'string', enum: ['black', 'white'] },
          isDraw: { type: 'boolean' },
          reason: { type: 'string' },
        },
      },
      render: (_args: { x: number; y: number }, value: PlaceStoneValue) => [{
        type: 'text',
        text: value.accepted
          ? `Stone committed at ${formatGomokuCoordinate(value.x ?? -1, value.y ?? -1)}.`
          : `Move rejected: ${value.reason ?? 'unknown reason'}.`,
      }],
    },
    async execute(args: { x: number; y: number }, exec: ToolRunContext): Promise<PlaceStoneValue> {
      const sourceSessionId = exec.agent?.session.id
      if (sourceSessionId === undefined) {
        throw new Error('place_stone requires a calling agent')
      }

      const existing = findCommittedCall(input.performance, sourceSessionId, exec.callId)
      if (existing?.type === 'gomoku/move') {
        exec.concludeTurn()
        return {
          accepted: true,
          replayed: true,
          x: existing.data.x,
          y: existing.data.y,
        }
      }

      const current = foldGomokuState(input.performance.session.events, input.config)
      const transition = validateAndApplyGomokuMove(current, input.config, {
        character: input.character,
        x: args.x,
        y: args.y,
      })
      if (!transition.ok) return { accepted: false, reason: transition.reason }

      const next = transition.state
      input.performance.append('gomoku/move', {
        sourceSessionId,
        callId: exec.callId,
        character: input.character,
        x: args.x,
        y: args.y,
      }, `${input.character} placed a stone at ${formatGomokuCoordinate(args.x, args.y)}.`)

      // The shared side effect is durable before the calling Agent can persist
      // a successful tool result. A replay of the same call id is idempotent.
      await input.performance.flush()
      exec.concludeTurn()

      return {
        accepted: true,
        x: args.x,
        y: args.y,
        ...(next.winner === undefined ? {} : { winner: next.winner }),
        isDraw: next.isDraw,
      }
    },
  })
}
