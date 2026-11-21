import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))

export interface WorkspaceSourceEntry {
  readonly specifier: string
  readonly sourcePath: string
}

export interface WorkspacePackageInfo {
  readonly dir: string
  readonly relativeDir: string
  readonly name: string
  readonly sourceEntries: readonly WorkspaceSourceEntry[]
  readonly hasBundlePatch: boolean
  readonly presetPatches: readonly string[]
}

interface PackageManifest {
  readonly name: string
  readonly exports?: Record<string, string | { readonly default?: string; readonly types?: string }>
  readonly dsh?: { readonly bundle?: { readonly patch?: string | readonly string[] } }
}

function normalizePatchList(patch: string | readonly string[] | undefined): string[] {
  if (patch === undefined) return []
  return typeof patch === 'string' ? [patch] : [...patch]
}

function distTargetToSourcePath(pkgDir: string, target: string): string | undefined {
  if (!target.startsWith('./dist/') || !target.endsWith('.js')) return undefined
  const candidate = join(pkgDir, 'src', `${target.slice('./dist/'.length, -'.js'.length)}.ts`)
  return existsSync(candidate) ? candidate : undefined
}

/** Discover all workspace packages under `packages/*` and `example/*` from their `package.json` manifests. */
export function discoverWorkspacePackages(): readonly WorkspacePackageInfo[] {
  const results: WorkspacePackageInfo[] = []
  for (const parent of ['packages', 'example'] as const) {
    const parentDir = join(REPO_ROOT, parent)
    if (!existsSync(parentDir)) continue
    const dirs = readdirSync(parentDir, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .sort()
    for (const folder of dirs) {
      const dir = join(parentDir, folder)
      const manifestPath = join(dir, 'package.json')
      if (!existsSync(manifestPath)) continue
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as PackageManifest
      const sourceEntries: WorkspaceSourceEntry[] = []
      for (const [subpath, target] of Object.entries(manifest.exports ?? {})) {
        const defaultTarget = typeof target === 'string' ? target : target.default
        if (defaultTarget === undefined) continue
        const sourcePath = distTargetToSourcePath(dir, defaultTarget)
        if (sourcePath === undefined) continue
        const specifier = subpath === '.' ? manifest.name : `${manifest.name}/${subpath.slice(2)}`
        sourceEntries.push({ specifier, sourcePath })
      }
      const patches = normalizePatchList(manifest.dsh?.bundle?.patch)
      results.push({
        dir,
        relativeDir: `${parent}/${folder}`,
        name: manifest.name,
        sourceEntries,
        hasBundlePatch: patches.length > 0,
        presetPatches: patches.filter(patch => patch !== './cordis.patch.yml'),
      })
    }
  }
  return results
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Build Vitest resolve aliases mapping every workspace package export to its live `src/*.ts` file. */
export function buildVitestWorkspaceAliases(): Array<{ find: RegExp; replacement: string }> {
  return discoverWorkspacePackages().flatMap(pkg =>
    pkg.sourceEntries.map(entry => ({
      find: new RegExp(`^${escapeRegExp(entry.specifier)}$`),
      replacement: entry.sourcePath,
    })),
  )
}

/** Build a lookup map from workspace export specifier to its dynamic `src/*.ts` loader for Cordis Loader. */
export function buildWorkspaceSourceLoaders(): Readonly<Record<string, () => Promise<unknown>>> {
  const loaders: Record<string, () => Promise<unknown>> = {}
  for (const pkg of discoverWorkspacePackages()) {
    for (const entry of pkg.sourceEntries) {
      const targetUrl = pathToFileURL(entry.sourcePath).href
      loaders[entry.specifier] = () => import(/* @vite-ignore */ targetUrl)
    }
  }
  return loaders
}
