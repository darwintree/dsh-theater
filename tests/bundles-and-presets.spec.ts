import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Include, { type PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { afterEach, describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'
import { installWorkspaceSourceLoader, REPO_ROOT } from './harness.ts'

const MOUNTABLE_PACKAGES = [
  { dir: 'packages/stage', name: '@darwintree/dsh-stage', presetPatches: [] },
  { dir: 'packages/theater', name: '@darwintree/dsh-theater', presetPatches: [] },
  {
    dir: 'packages/theater-gomoku',
    name: '@darwintree/dsh-theater-gomoku',
    presetPatches: ['./presets/gomoku.patch.yml', './presets/two-character-gomoku.patch.yml'],
  },
  {
    dir: 'packages/theater-role-play',
    name: '@darwintree/dsh-theater-role-play',
    presetPatches: ['./presets/role-play-v3.patch.yml'],
  },
  {
    dir: 'example/three-board-gomoku',
    name: '@darwintree/dsh-theater-example-three-board-gomoku',
    presetPatches: ['./presets/three-board-gomoku.patch.yml'],
  },
] as const

const SHIPPED_PRESETS = [
  { id: 'gomoku', patchFile: 'packages/theater-gomoku/presets/gomoku.patch.yml' },
  { id: 'two-character-gomoku', patchFile: 'packages/theater-gomoku/presets/two-character-gomoku.patch.yml' },
  { id: 'three-board-gomoku', patchFile: 'example/three-board-gomoku/presets/three-board-gomoku.patch.yml' },
  { id: 'role-play-v3', patchFile: 'packages/theater-role-play/presets/role-play-v3.patch.yml' },
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

function normalizePatchList(patch: string | readonly string[] | undefined): string[] {
  if (patch === undefined) return []
  return typeof patch === 'string' ? [patch] : [...patch]
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
        dsh?: { bundle?: { patch?: string | string[] } }
      }
      expect(manifest.name).toBe(pkg.name)
      const declaredPatches = normalizePatchList(manifest.dsh?.bundle?.patch)
      expect(declaredPatches).toEqual(['./cordis.patch.yml', ...pkg.presetPatches])
      expect(manifest.exports?.['./cordis.patch.yml']).toBe('./cordis.patch.yml')
      expect(manifest.files).toContain('cordis.patch.yml')
      if (pkg.presetPatches.length > 0) {
        expect(manifest.exports?.['./presets/*.patch.yml']).toBe('./presets/*.patch.yml')
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

  it('uses package export specifiers instead of relative dist paths in every shipped declarative preset patch', async () => {
    for (const preset of SHIPPED_PRESETS) {
      const patch = await readPatch(preset.patchFile)
      const inserted = patch.flatMap(entry => entry.insert ?? [])
      expect(inserted).toHaveLength(1)
      const row = inserted[0]!
      expect(row.name).toBe('@deepseek-ai/dsh-agent-preset')
      const config = row.config as { id?: string; plugins?: Array<{ name?: string }> }
      expect(config.id).toBe(preset.id)
      expect(Array.isArray(config.plugins)).toBe(true)
      expect(config.plugins!.length).toBeGreaterThan(0)
      for (const plugin of config.plugins!) {
        expect(typeof plugin.name).toBe('string')
        expect(plugin.name).not.toMatch(/^\.\.?\/|\/dist\/|\.js$/)
      }
    }
  })

  it('mounts optional bundles and declarative presets in reverse order via real Cordis Loader and supports disabling optional rows', async () => {
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
      "- id: tool-executor-native",
      "  name: '@deepseek-ai/dsh-tool-executor-native'",
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
      "- id: agent-preset-registry",
      "  name: '@deepseek-ai/dsh-agent-preset-registry'",
      "  config:",
      "    default: gomoku",
      '',
    ].join('\n'))

    // Apply optional domain bundles and their preset patches BEFORE stage and theater to verify service-driven activation.
    const patches = [
      ...await readPatch('example/three-board-gomoku/cordis.patch.yml'),
      ...await readPatch('example/three-board-gomoku/presets/three-board-gomoku.patch.yml'),
      ...await readPatch('packages/theater-role-play/cordis.patch.yml'),
      ...await readPatch('packages/theater-role-play/presets/role-play-v3.patch.yml'),
      ...await readPatch('packages/theater-gomoku/cordis.patch.yml'),
      ...await readPatch('packages/theater-gomoku/presets/gomoku.patch.yml'),
      ...await readPatch('packages/theater-gomoku/presets/two-character-gomoku.patch.yml'),
      ...await readPatch('packages/theater/cordis.patch.yml'),
      ...await readPatch('packages/stage/cordis.patch.yml'),
    ]

    ctx = new Context()
    ctx.baseUrl = `${pathToFileURL(REPO_ROOT).href}/`
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    installWorkspaceSourceLoader(ctx)

    const includeId = await ctx.loader.create({
      name: 'cordis:include',
      config: {
        path: pathToFileURL(configPath).href,
        patches,
      },
    })
    await ctx.loader.await()

    const pending = [...ctx.loader.entries()]
      .filter(entry => entry.fiber === undefined && !entry.disabled)
      .map(entry => ({ id: entry.id, name: entry.name }))
    expect(pending).toEqual([])
    expect(ctx.get('stages')).toBeDefined()
    expect(ctx.get('theater')).toBeDefined()

    const discovered = await ctx.agentPresets.list()
    for (const preset of SHIPPED_PRESETS) {
      const found = discovered.find(item => item.id === preset.id)
      expect(found, `expected preset ${preset.id} to be discovered`).toBeDefined()
      expect(found?.broken, `expected preset ${preset.id} to be valid`).toBeUndefined()
      const lease = await ctx.agentPresets.acquireScope(preset.id)
      expect(lease.key).toBeDefined()
      await lease[Symbol.asyncDispose]()
    }

    // Disable optional role-play and three-board-gomoku rows independently while core stays live.
    const includeEntry = [...ctx.loader.entries()].find(entry => entry.id === includeId)
    expect(includeEntry).toBeDefined()
    await includeEntry!.update({
      config: {
        path: pathToFileURL(configPath).href,
        patches: [
          ...patches,
          { id: 'theater-role-play', disabled: true },
          { id: 'preset-role-play-v3', disabled: true },
          { id: 'theater-example-three-board-gomoku', disabled: true },
          { id: 'preset-three-board-gomoku', disabled: true },
        ],
      },
    })
    await ctx.loader.await()
    expect(ctx.get('stages')).toBeDefined()
    expect(ctx.get('theater')).toBeDefined()
    const remainingIds = (await ctx.agentPresets.list()).map(item => item.id).sort()
    expect(remainingIds).toEqual(['gomoku', 'two-character-gomoku'])
  })
})
