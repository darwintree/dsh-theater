import {
  SessionId,
  type JsonValue,
  type SessionId as SessionIdType,
} from '@deepseek-ai/dsh-session'
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
  if (contributions.stages.length === 0) throw new Error('Theater preset requires at least one Stage contribution')
  const characterIds = new Set<string>()
  const characters = contributions.characters.map((character) => {
    const id = nonEmpty(character.id, 'Character ID')
    if (characterIds.has(id)) throw new Error(`duplicate Character ID ${JSON.stringify(id)}`)
    characterIds.add(id)
    if (character.tools.length === 0) {
      throw new Error(`Character ${JSON.stringify(id)} requires at least one Tool`)
    }
    return {
      id,
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

export function compatible(current: TheaterConfigured, durable: TheaterConfigured): boolean {
  return JSON.stringify(current) === JSON.stringify(durable)
}

export function failure(error: unknown, code = 'UNKNOWN'): { message: string; code: string } {
  if (error instanceof Error) {
    const candidate = error as Error & { code?: unknown }
    return { message: error.message, code: typeof candidate.code === 'string' ? candidate.code : code }
  }
  return { message: String(error), code }
}
