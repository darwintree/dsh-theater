import {
  SessionId,
  type SessionId as SessionIdType,
} from '@deepseek-ai/dsh-session'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { ModelSelection } from '@deepseek-ai/dsh-agent'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { StageConfigured, StateMachineFactory } from '@darwintree/dsh-stage'
import type {
  TheaterConfigured,
  TheaterToolFactory,
} from './types.js'

export function nonEmpty(value: string, label: string): string {
  if (value.trim() === '') throw new Error(`${label} must be non-empty`)
  return value
}

function encodeCharacter(characterId: string): string {
  return encodeURIComponent(nonEmpty(characterId, 'Character ID'))
}

/** Deterministically derive one Character Session identity. */
export function characterSessionId(
  performanceId: SessionIdType,
  characterId: string,
): SessionIdType {
  return SessionId(`${nonEmpty(String(performanceId), 'Performance Session ID')}/characters/${encodeCharacter(characterId)}`)
}

export function resolvedConfiguration(
  presetId: string,
  contributions: {
    readonly characters: readonly {
      readonly id: string
      readonly model?: ModelSelection
      readonly systemPrompt: string
      readonly tools: readonly { readonly factory: TheaterToolFactory; readonly config: JsonValue }[]
    }[]
    readonly stages: readonly {
      readonly stageId: string
      readonly factory: StateMachineFactory
      readonly config: JsonValue
    }[]
  },
): TheaterConfigured {
  nonEmpty(presetId, 'Agent Preset ID')
  if (contributions.characters.length === 0) throw new Error('Theater preset requires at least one Character contribution')
  const characterIds = new Set<string>()
  const characters = contributions.characters.map((character) => {
    const id = nonEmpty(character.id, 'Character ID')
    if (characterIds.has(id)) throw new Error(`duplicate Character ID ${JSON.stringify(id)}`)
    characterIds.add(id)
    return {
      id,
      ...character.model === undefined ? {} : {
        model: {
          provider: nonEmpty(character.model.provider, `Model provider for Character ${JSON.stringify(id)}`),
          model: nonEmpty(character.model.model, `Model ID for Character ${JSON.stringify(id)}`),
          ...character.model.reasoningEffort === undefined ? {} : {
            reasoningEffort: ReasoningEffortId(nonEmpty(
              character.model.reasoningEffort,
              `Reasoning effort for Character ${JSON.stringify(id)}`,
            )),
          },
        },
      },
      systemPrompt: nonEmpty(character.systemPrompt, `System Prompt for Character ${JSON.stringify(id)}`),
      tools: character.tools.map(tool => ({
        factory: nonEmpty(tool.factory.kind, `Tool factory for Character ${JSON.stringify(id)}`),
        config: tool.config,
      })),
    }
  })
  const stageIds = new Set<string>()
  const stages = contributions.stages.map((stage): StageConfigured => {
    const stageId = nonEmpty(stage.stageId, 'Stage ID')
    if (stageIds.has(stageId)) throw new Error(`duplicate Stage ID ${JSON.stringify(stageId)}`)
    stageIds.add(stageId)
    return {
      stageId,
      machine: nonEmpty(stage.factory.kind, 'State Machine kind'),
      version: nonEmpty(stage.factory.version, 'State Machine version'),
      config: stage.config,
    }
  })
  return { presetId, characters, stages }
}

/**
 * Check structural compatibility between current preset structure and a durable
 * Performance Configuration (ADR-0006). Character prompts, models, Tool plans,
 * and Stage params are governed by the durable snapshot and are not compared.
 */
export function structuralIncompatibility(
  current: {
    readonly characterIds: readonly string[]
    readonly stages: readonly { readonly stageId: string; readonly machine: string; readonly version: string }[]
  },
  durable: TheaterConfigured,
): string | undefined {
  const currentCharacters = new Set(current.characterIds)
  const durableCharacters = new Set(durable.characters.map(character => character.id))
  if (currentCharacters.size !== durableCharacters.size
    || [...durableCharacters].some(id => !currentCharacters.has(id))) {
    return 'current Character roster is incompatible with durable Performance configuration'
  }
  const currentStages = new Map(current.stages.map(stage => [stage.stageId, stage]))
  if (currentStages.size !== durable.stages.length) {
    return 'current Stage declarations are incompatible with durable Performance configuration'
  }
  for (const durableStage of durable.stages) {
    const currentStage = currentStages.get(durableStage.stageId)
    if (currentStage === undefined) {
      return `declared Stage ${JSON.stringify(durableStage.stageId)} is missing from current preset`
    }
    if (currentStage.machine !== durableStage.machine || currentStage.version !== durableStage.version) {
      return `Stage ${JSON.stringify(durableStage.stageId)} machine/version is incompatible with durable Performance configuration`
    }
  }
  return undefined
}

export function failure(error: unknown, code = 'UNKNOWN'): { message: string; code: string } {
  if (error instanceof Error) {
    const candidate = error as Error & { code?: unknown }
    return { message: error.message, code: typeof candidate.code === 'string' ? candidate.code : code }
  }
  return { message: String(error), code }
}
