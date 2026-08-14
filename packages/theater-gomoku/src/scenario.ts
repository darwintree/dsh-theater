import type { TheaterScenario } from '@darwintree/dsh-theater'
import type { GomokuConfig, GomokuCharacter } from './types.js'
import { foldGomokuState, parseGomokuConfig, renderGomokuTurnPrompt } from './state.js'
import { createPlaceStoneTool } from './tool.js'

export const GOMOKU_SCENARIO_ID = 'gomoku'
export const GOMOKU_CHARACTERS: readonly GomokuCharacter[] = ['black', 'white']

export const gomokuScenario: TheaterScenario<GomokuConfig> = {
  id: GOMOKU_SCENARIO_ID,
  parseConfig: parseGomokuConfig,
  characters: () => GOMOKU_CHARACTERS,
  setupCharacter({ character, agentCtx, performance, config }) {
    if (character !== 'black' && character !== 'white') {
      throw new Error(`unknown Gomoku character: ${character}`)
    }
    agentCtx.tools.register(createPlaceStoneTool({
      character,
      performance,
      config,
    }))
  },
  nextTurn({ config, performanceEvents }) {
    const state = foldGomokuState(performanceEvents, config)
    if (state.isFinished) return null
    return {
      character: state.currentPlayer,
      content: [{ type: 'text', text: renderGomokuTurnPrompt(state) }],
    }
  },
}
