import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Include, { type PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentDefaultModel from '@deepseek-ai/dsh-agent-default-model'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import AgentPresets from '@deepseek-ai/dsh-agent-presets'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import SessionProjections from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const MOUNTABLE_PACKAGES = [
  { dir: 'packages/stage', name: '@darwintree/dsh-stage', hasPresets: false },
  { dir: 'packages/theater', name: '@darwintree/dsh-theater', hasPresets: false },
  { dir: 'packages/theater-gomoku', name: '@darwintree/dsh-theater-gomoku', hasPresets: true },
  { dir: 'packages/theater-role-play', name: '@darwintree/dsh-theater-role-play', hasPresets: true },
  { dir: 'example/three-board-gomoku', name: '@darwintree/dsh-theater-example-three-board-gomoku', hasPresets: true },
] as const

const SHIPPED_PRESETS = [
  { id: 'gomoku', dir: 'packages/theater-gomoku/presets/gomoku' },
  { id: 'two-character-gomoku', dir: 'packages/theater-gomoku/presets/two-character-gomoku' },
  { id: 'three-board-gomoku', dir: 'example/three-board-gomoku/presets/three-board-gomoku' },
  { id: 'role-play-v3', dir: 'packages/theater-role-play/presets/role-play-v3' },
] as const

let tempDirs: string[] = []
let ctx: Context | undefined

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

async function readPatch(relativePath: string): Promise<PatchOptions[]> {
  const parsed: unknown = parseYaml(await readFile(join(REPO_ROOT, relativePath), 'utf8'))
  if (!Array.isArray(parsed)) throw new Error(`expected array patch in ${relativePath}`)
  return parsed as PatchOptions[]
}

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
  for (const dir of tempDirs) {
    await rm(dir, { recursive: true, force: true })
  }
  tempDirs = []
})

describe('DSH bundles and shipped presets', () => {
  it('declares consistent dsh.bundle manifests and exports across every mountable package', async () => {
    for (const pkg of MOUNTABLE_PACKAGES) {
      const manifest = JSON.parse(await readFile(join(REPO_ROOT, pkg.dir, 'package.json'), 'utf8')) as {
        name: string
        exports?: Record<string, unknown>
        files?: string[]
        dsh?: { bundle?: { patch?: string } }
      }
      expect(manifest.name).toBe(pkg.name)
      expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
      expect(manifest.exports?.['./cordis.patch.yml']).toBe('./cordis.patch.yml')
      expect(manifest.files).toContain('cordis.patch.yml')
      if (pkg.hasPresets) {
        expect(manifest.files).toContain('presets')
      }

      const patch = await readPatch(join(pkg.dir, 'cordis.patch.yml'))
      const rows = patch.flatMap(entry => entry.insert ?? [])
      expect(rows.length).toBeGreaterThan(0)
      for (const row of rows) {
        expect(row.name).not.toMatch(/^\.\.?\/|\/dist\//)
      }
    }
  })

  it('uses package export specifiers instead of relative dist paths in every shipped preset', async () => {
    for (const preset of SHIPPED_PRESETS) {
      const rows = parseYaml(await readFile(join(REPO_ROOT, preset.dir, 'agent.cordis.yml'), 'utf8')) as Array<{
        id?: string
        name?: string
      }>
      expect(Array.isArray(rows)).toBe(true)
      expect(rows.length).toBeGreaterThan(0)
      for (const row of rows) {
        expect(typeof row.name).toBe('string')
        expect(row.name).not.toMatch(/^\.\.?\/|\/dist\/|\.js$/)
      }
    }
  })

  it('mounts optional bundles in reverse order via real Cordis Loader and supports disabling optional rows', async () => {
    const configDir = await makeTempDir('dsh-theater-bundles-')
    const configPath = join(configDir, 'cordis.yml')
    await writeFile(configPath, [
      "- id: llm",
      "  name: '@deepseek-ai/dsh-llm'",
      "- id: session",
      "  name: '@deepseek-ai/dsh-session'",
      "- id: session-projections",
      "  name: '@deepseek-ai/dsh-session-projection'",
      "- id: system-prompt",
      "  name: '@deepseek-ai/dsh-system-prompt'",
      "- id: tools",
      "  name: '@deepseek-ai/dsh-tools'",
      "- id: agents",
      "  name: '@deepseek-ai/dsh-agent'",
      "- id: agent-loop",
      "  name: '@deepseek-ai/dsh-agent-loop'",
      "  config:",
      "    agents: []",
      "- id: agent-default-model",
      "  name: '@deepseek-ai/dsh-agent-default-model'",
      "  config:",
      "    provider: mock",
      "    model: scripted",
      "- id: agent-presets",
      "  name: '@deepseek-ai/dsh-agent-presets'",
      "  config:",
      "    default: gomoku",
      "    roots: []",
      "    includeUserRoot: false",
      '',
    ].join('\n'))

    // Apply optional domain bundles BEFORE stage and theater to verify service-driven activation.
    const patches = [
      ...await readPatch('example/three-board-gomoku/cordis.patch.yml'),
      ...await readPatch('packages/theater-role-play/cordis.patch.yml'),
      ...await readPatch('packages/theater-gomoku/cordis.patch.yml'),
      ...await readPatch('packages/theater/cordis.patch.yml'),
      ...await readPatch('packages/stage/cordis.patch.yml'),
    ]

    ctx = new Context()
    ctx.baseUrl = `${pathToFileURL(REPO_ROOT).href}/`
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include

    const includeId = await ctx.loader.create({
      name: 'cordis:include',
      config: {
        path: pathToFileURL(configPath).href,
        patches,
      },
    })
    await ctx.loader.await()

    const pending = [...ctx.loader.entries()].filter(entry => entry.fiber === undefined && !entry.disabled)
    expect(pending).toEqual([])
    expect(ctx.get('stages')).toBeDefined()
    expect(ctx.get('theater')).toBeDefined()

    // Disable optional role-play and three-board-gomoku rows independently while core stays live.
    const includeEntry = [...ctx.loader.entries()].find(entry => entry.id === includeId)
    expect(includeEntry).toBeDefined()
    await includeEntry!.update({
      config: {
        path: pathToFileURL(configPath).href,
        patches: [
          ...patches,
          { id: 'theater-role-play', disabled: true },
          { id: 'theater-example-three-board-gomoku', disabled: true },
        ],
      },
    })
    await ctx.loader.await()
    expect(ctx.get('stages')).toBeDefined()
    expect(ctx.get('theater')).toBeDefined()
  })

  it('loads all shipped presets cleanly after copying them to an isolated external preset root', async () => {
    const externalPresetsRoot = await makeTempDir('dsh-external-presets-')
    for (const preset of SHIPPED_PRESETS) {
      await cp(join(REPO_ROOT, preset.dir), join(externalPresetsRoot, preset.id), { recursive: true })
    }

    ctx = new Context()
    ctx.baseUrl = `${pathToFileURL(REPO_ROOT).href}/`
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjections)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(AgentDefaultModel, { provider: 'mock', model: 'scripted' })
    await ctx.plugin(AgentPresets, {
      default: 'gomoku',
      roots: [{ path: externalPresetsRoot, trust: 'system' }],
      includeUserRoot: false,
    })

    const stagePlugin = await import('@darwintree/dsh-stage')
    const theaterPlugin = await import('@darwintree/dsh-theater')
    const gomokuPlugin = await import('@darwintree/dsh-theater-gomoku')
    const gomokuTheaterPlugin = await import('@darwintree/dsh-theater-gomoku/theater')
    const rolePlayPlugin = await import('@darwintree/dsh-theater-role-play')
    const threeBoardPlugin = await import('@darwintree/dsh-theater-example-three-board-gomoku')

    await ctx.plugin(stagePlugin.default)
    await ctx.plugin(theaterPlugin.default)
    await ctx.plugin(gomokuPlugin)
    await ctx.plugin(gomokuTheaterPlugin)
    await ctx.plugin(rolePlayPlugin)
    await ctx.plugin(threeBoardPlugin)

    const discovered = await ctx.agentPresets.list()
    for (const preset of SHIPPED_PRESETS) {
      const found = discovered.find(item => item.id === preset.id)
      expect(found, `expected preset ${preset.id} to be discovered`).toBeDefined()
      expect(found?.broken, `expected preset ${preset.id} to be valid`).toBeUndefined()
      await expect(ctx.agentPresets.standingKeyFor(preset.id)).resolves.toBeDefined()
    }
  })
})
