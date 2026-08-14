import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { TheaterPerformance } from './performance.js'

/** Stable character identifier within one scenario. */
export type TheaterCharacterId = string

/** What the generic driver should deliver for the next character turn. */
export interface TheaterTurnRecommendation {
  character: TheaterCharacterId
  content: ContentBlock[]
}

/** Input for installing one scenario's contributions into a character scope. */
export interface SetupTheaterCharacterInput<TConfig> {
  character: TheaterCharacterId
  agentCtx: Context
  performance: TheaterPerformance<TConfig>
  config: TConfig
}

/**
 * One domain's complete Theater contract. The core owns lifecycle and sessions;
 * the scenario owns validation, domain tools, state interpretation, and turn
 * recommendations.
 */
export interface TheaterScenario<TConfig = unknown> {
  id: string
  parseConfig(input: unknown): TConfig
  characters(config: TConfig): readonly TheaterCharacterId[]
  setupCharacter?(input: SetupTheaterCharacterInput<TConfig>): void | Promise<void>
  nextTurn(input: {
    config: TConfig
    performanceEvents: readonly SessionEvent[]
  }): TheaterTurnRecommendation | null
}
