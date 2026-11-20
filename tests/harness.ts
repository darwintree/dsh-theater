import { readdir, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Include, { type PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentDefaultModel from '@deepseek-ai/dsh-agent-default-model'
import * as AgentInstructions from '@deepseek-ai/dsh-agent-instructions'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import AgentPreset from '@deepseek-ai/dsh-agent-preset'
import AgentPresetRegistry, { type PresetDefinition } from '@deepseek-ai/dsh-agent-preset-registry'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import LlmRuntime, { type GenerateOptions } from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import * as JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionProjections from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import StageService from '@darwintree/dsh-stage'
import TheaterService from '@darwintree/dsh-theater'
import { parse as parseYaml } from 'yaml'

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Map workspace package specifiers directly to Vitest-transformed `src/*.ts`
 * modules so Cordis Loader and AgentPresetRegistry share the exact same live
 * source singletons as direct TypeScript imports — even when `dist/` does not exist.
 */
const WORKSPACE_SOURCE_LOADERS: Readonly<Record<string, () => Promise<unknown>>> = {
  '@darwintree/dsh-llm-mock': () => import('@darwintree/dsh-llm-mock'),
  '@darwintree/dsh-stage': () => import('@darwintree/dsh-stage'),
  '@darwintree/dsh-stage/preset': () => import('@darwintree/dsh-stage/preset'),
  '@darwintree/dsh-theater': () => import('@darwintree/dsh-theater'),
  '@darwintree/dsh-theater/preset': () => import('@darwintree/dsh-theater/preset'),
  '@darwintree/dsh-theater/headless': () => import('@darwintree/dsh-theater/headless'),
  '@darwintree/dsh-theater-gomoku': () => import('@darwintree/dsh-theater-gomoku'),
  '@darwintree/dsh-theater-gomoku/single-agent': () => import('@darwintree/dsh-theater-gomoku/single-agent'),
  '@darwintree/dsh-theater-gomoku/director': () => import('@darwintree/dsh-theater-gomoku/director'),
  '@darwintree/dsh-theater-gomoku/theater': () => import('@darwintree/dsh-theater-gomoku/theater'),
  '@darwintree/dsh-theater-role-play': () => import('@darwintree/dsh-theater-role-play'),
  '@darwintree/dsh-theater-role-play/director': () => import('@darwintree/dsh-theater-role-play/director'),
  '@darwintree/dsh-theater-role-play/v3': () => import('@darwintree/dsh-theater-role-play/v3'),
  '@darwintree/dsh-theater-example-three-board-gomoku': () => import('@darwintree/dsh-theater-example-three-board-gomoku'),
  '@darwintree/dsh-theater-example-three-board-gomoku/director': () => import('@darwintree/dsh-theater-example-three-board-gomoku/director'),
}

/**
 * Intercept `@darwintree/*` module loads on Cordis `Loader` so presets and
 * bundle patches execute against live `src/*.ts` sources rather than `dist/`.
 */
export function installWorkspaceSourceLoader(ctx: Context): void {
  const original = ctx.loader.internal
  const fallbackImport = async (specifier: string, parentURL?: string, importAttributes: Record<string, string> = {}): Promise<unknown> => {
    if (original !== undefined && typeof original.import === 'function') {
      const targetParent = parentURL ?? ctx.baseUrl
      try {
        return await original.import(specifier, targetParent, importAttributes)
      } catch (error) {
        const isBare = !specifier.startsWith('./') && !specifier.startsWith('../')
          && !specifier.startsWith('/') && !specifier.startsWith('file://')
        if (isBare && targetParent !== ctx.baseUrl) {
          return await original.import(specifier, ctx.baseUrl, importAttributes)
        }
        throw error
      }
    }
    if (specifier.startsWith('./') || specifier.startsWith('../')) {
      const base = parentURL ?? ctx.baseUrl
      return await import(/* @vite-ignore */ new URL(specifier, base).href)
    }
    if (specifier.startsWith('file://') || specifier.startsWith('/')) {
      return await import(/* @vite-ignore */ specifier)
    }
    return await import(/* @vite-ignore */ specifier)
  }

  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string, parentURL?: string, importAttributes?: Record<string, string>) {
      const sourceLoader = WORKSPACE_SOURCE_LOADERS[specifier]
      if (sourceLoader !== undefined) return await sourceLoader()
      return await fallbackImport(specifier, parentURL, importAttributes)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
}

function resolveRelativePluginNames(plugins: readonly unknown[], fromDir: string): unknown[] {
  return plugins.map((entry) => {
    if (typeof entry !== 'object' || entry === null) return entry
    const row = entry as Record<string, unknown>
    if (typeof row.name === 'string' && (row.name.startsWith('./') || row.name.startsWith('../'))) {
      return { ...row, name: pathToFileURL(resolve(fromDir, row.name)).href }
    }
    return entry
  })
}

/** Extract `@deepseek-ai/dsh-agent-preset` definitions declared in one or more bundle patch files. */
export async function loadPresetDefinitionsFromPatchFiles(files: readonly string[]): Promise<PresetDefinition[]> {
  const definitions: PresetDefinition[] = []
  for (const file of files) {
    const parsed: unknown = parseYaml(await readFile(file, 'utf8'))
    if (!Array.isArray(parsed)) throw new Error(`expected patch array in ${file}`)
    const fileDir = dirname(file)
    for (const patch of parsed as PatchOptions[]) {
      for (const row of patch.insert ?? []) {
        if (row.name !== '@deepseek-ai/dsh-agent-preset') continue
        const config = row.config as PresetDefinition | undefined
        if (config === undefined) throw new Error(`missing config on preset row in ${file}`)
        definitions.push({
          ...config,
          plugins: resolveRelativePluginNames(config.plugins, fileDir),
        })
      }
    }
  }
  return definitions
}

/**
 * Load preset definitions from either `*.patch.yml` files or legacy fixture
 * `<id>/agent.cordis.yml` subdirectories inside `dir`.
 */
export async function loadPresetDefinitionsFromDir(dir: string): Promise<PresetDefinition[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const patchFiles = entries
    .filter(entry => entry.isFile() && entry.name.endsWith('.patch.yml'))
    .map(entry => join(dir, entry.name))
    .sort()
  const definitions = await loadPresetDefinitionsFromPatchFiles(patchFiles)

  for (const entry of entries.filter(item => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const presetDir = join(dir, entry.name)
    let raw: string
    try {
      raw = await readFile(join(presetDir, 'agent.cordis.yml'), 'utf8')
    } catch {
      continue
    }
    const plugins: unknown = parseYaml(raw)
    if (!Array.isArray(plugins)) throw new Error(`expected entry array in ${join(presetDir, 'agent.cordis.yml')}`)
    definitions.push({
      id: entry.name,
      plugins: resolveRelativePluginNames(plugins, presetDir),
    })
  }
  return definitions
}

export interface DshTestContextOptions {
  readonly baseDir?: string
  readonly persistenceRoot?: string
  readonly personaPrefix?: string
  readonly ambientContext?: { readonly name: string; readonly order: number; readonly text: string }
  readonly agentInstructions?: { readonly dshHome: string; readonly maxBytes?: number; readonly fsCwd?: string }
  readonly maxParallelToolCalls?: number
  readonly defaultModel?: { readonly provider: string; readonly model: string } | false
  readonly presets?: {
    readonly default: string
    readonly definitions?: readonly PresetDefinition[]
    readonly patchFiles?: readonly string[]
    readonly dirs?: readonly string[]
  }
  readonly mountTheater?: boolean
  readonly mountStage?: boolean
}

/** Create a standard in-process DSH Context backed by live workspace `src/` modules. */
export async function createDshTestContext(options: DshTestContextOptions = {}): Promise<Context> {
  const ctx = new Context()
  const baseDir = options.baseDir ?? REPO_ROOT
  ctx.baseUrl = `${pathToFileURL(baseDir).href}/`
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  installWorkspaceSourceLoader(ctx)

  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjections)

  if (options.persistenceRoot !== undefined) {
    await ctx.plugin(JsonlSessionPersistence, {
      root: options.persistenceRoot,
      compression: 'none',
    })
  }

  if (options.mountStage !== false) {
    await ctx.plugin(StageService)
  }

  await ctx.plugin(
    SystemPrompt,
    options.personaPrefix === undefined ? {} : { personaPrefix: options.personaPrefix },
  )
  if (options.ambientContext !== undefined) {
    ctx.systemPrompt.context(options.ambientContext)
  }

  if (options.agentInstructions !== undefined) {
    await ctx.plugin(LocalFileSystem, { cwd: options.agentInstructions.fsCwd ?? '/' })
    await ctx.plugin(AgentInstructions, {
      dshHome: options.agentInstructions.dshHome,
      maxBytes: options.agentInstructions.maxBytes ?? 65536,
    })
  }

  await ctx.plugin(ToolRuntime)
  await ctx.plugin(NativeToolExecutor)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, {
    agents: [],
    ...options.maxParallelToolCalls === undefined ? {} : { maxParallelToolCalls: options.maxParallelToolCalls },
  })

  if (options.defaultModel !== false) {
    await ctx.plugin(
      AgentDefaultModel,
      options.defaultModel ?? { provider: 'mock', model: 'scripted' },
    )
  }

  if (options.presets !== undefined) {
    await ctx.plugin(AgentPresetRegistry, {
      default: options.presets.default,
    })
  }

  if (options.mountTheater !== false) {
    await ctx.plugin(TheaterService)
  }

  if (options.presets !== undefined) {
    const definitions: PresetDefinition[] = [
      ...(options.presets.definitions ?? []),
      ...(options.presets.patchFiles === undefined
        ? []
        : await loadPresetDefinitionsFromPatchFiles(options.presets.patchFiles)),
    ]
    for (const dir of options.presets.dirs ?? []) {
      definitions.push(...await loadPresetDefinitionsFromDir(dir))
    }
    for (const definition of definitions) {
      await ctx.plugin(AgentPreset, definition)
    }
  }

  return ctx
}

/** Extract the effective system prompt from either `options.system` or a loop-built leading system message. */
export function extractSystemPrompt(options: GenerateOptions): string | undefined {
  if (options.system !== undefined) return options.system
  const systemMessage = options.messages.find(message => message.role === 'system')
  if (systemMessage === undefined) return undefined
  return systemMessage.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n')
}
