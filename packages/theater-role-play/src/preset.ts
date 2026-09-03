/// <reference types="node" />

import { readFileSync } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@darwintree/dsh-theater'
import { parse } from 'yaml'
import { createRolePlayDirector } from './director.js'
import {
  END_PERFORMANCE,
  PERCEIVE_OR_RECALL,
  PERCEPTION_RESULT,
  RECOMMEND_NEXT_CHARACTER,
  THINK,
  VOICE_OVER,
  WARN,
} from './tools.js'

interface PresetPrompts {
  readonly dmGuidance: string
  readonly characterGuidance: string
  readonly characterCardHeading: string
  readonly openingHeading: string
}

interface PresetCharacter {
  readonly id: string
  readonly card: string
}

interface RolePlayPreset {
  readonly title: string
  readonly common: string
  readonly opening: string
  readonly prompts: PresetPrompts
  readonly characters: readonly PresetCharacter[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isPresetPrompts(value: unknown): value is PresetPrompts {
  return isRecord(value)
    && typeof value.dmGuidance === 'string'
    && value.dmGuidance.includes('{characterIds}')
    && typeof value.characterGuidance === 'string'
    && typeof value.characterCardHeading === 'string'
    && typeof value.openingHeading === 'string'
}

function isPresetCharacter(value: unknown): value is PresetCharacter {
  return isRecord(value)
    && typeof value.id === 'string'
    && value.id.trim() !== ''
    && typeof value.card === 'string'
}

function readPreset(): RolePlayPreset {
  const value: unknown = parse(readFileSync(new URL('../preset/v3.yml', import.meta.url), 'utf8'))
  if (!isRecord(value) || typeof value.title !== 'string' || value.title.trim() === ''
    || typeof value.common !== 'string'
    || typeof value.opening !== 'string' || !isPresetPrompts(value.prompts)
    || !Array.isArray(value.characters)) {
    throw new Error('Invalid Role-play preset')
  }
  if (value.characters.length === 0 || !value.characters.every(isPresetCharacter)) {
    throw new Error('Invalid Role-play character')
  }
  const ids = value.characters.map(character => character.id)
  if (ids.includes('dm') || new Set(ids).size !== ids.length) {
    throw new Error('Role-play character ids must be unique and cannot be dm')
  }
  return {
    title: value.title,
    common: value.common,
    opening: value.opening,
    prompts: value.prompts,
    characters: value.characters,
  }
}

function section(name: string, content: string): string {
  return `<${name}>\n${content}\n</${name}>`
}

export const name = '@darwintree/dsh-theater-role-play/v3'
export const inject = ['theater']

/** Contribute the complete v3 cast and scheduling prompts to one Agent Preset. */
export function apply(ctx: Context): void {
  const preset = readPreset()
  const characterIds = preset.characters.map(character => character.id)
  const cards = preset.characters
    .map(({ card }, index) => {
      const heading = preset.prompts.characterCardHeading.replace('{index}', String(index + 1))
      return `${heading}\n${card}`
    })
    .join('\n\n')
  ctx.theater.registerTitle(preset.title)
  ctx.theater.registerAutoAdvance(true)
  ctx.theater.registerCharacter({
    id: 'dm',
    title: `${preset.title} · DM`,
    systemPrompt: [
      section('dm_guidance', preset.prompts.dmGuidance.replaceAll('{characterIds}', characterIds.join('、'))),
      section('common_scene_card', preset.common),
      section('character_cards', cards),
      section('opening', [preset.prompts.openingHeading, preset.opening].join('\n')),
    ].join('\n\n'),
    tools: [VOICE_OVER, WARN, RECOMMEND_NEXT_CHARACTER, PERCEPTION_RESULT, END_PERFORMANCE]
      .map(factory => ({ factory })),
  })
  for (const { id, card } of preset.characters) {
    ctx.theater.registerCharacter({
      id,
      title: `${preset.title} · ${id[0]!.toUpperCase()}${id.slice(1)}`,
      systemPrompt: [
        section('character_guidance', preset.prompts.characterGuidance),
        section('common_scene_card', preset.common),
        section('character_card', card),
      ].join('\n\n'),
      tools: [THINK, PERCEIVE_OR_RECALL].map(factory => ({ factory })),
    })
  }
  ctx.theater.registerDirector(createRolePlayDirector())
}
