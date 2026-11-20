import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { REPO_ROOT } from './harness.ts'

const WORKSPACE_PACKAGES = [
  'packages/llm-mock',
  'packages/stage',
  'packages/theater',
  'packages/theater-gomoku',
  'packages/theater-role-play',
  'example/three-board-gomoku',
] as const

const hasBuiltDist = WORKSPACE_PACKAGES.every(pkg => existsSync(join(REPO_ROOT, pkg, 'dist', 'index.js')))

async function matchesWildcardTarget(pkgDir: string, target: string): Promise<boolean> {
  const star = target.indexOf('*')
  const dir = join(REPO_ROOT, pkgDir, dirname(target))
  const filePattern = target.slice(target.lastIndexOf('/') + 1)
  const [prefix, suffix] = filePattern.split('*')
  if (star === -1 || prefix === undefined || suffix === undefined || !existsSync(dir)) return false
  const entries = await readdir(dir)
  return entries.some(name => name.startsWith(prefix) && name.endsWith(suffix))
}

describe('built package exports smoke check', () => {
  it.skipIf(!hasBuiltDist)('materializes every declared export target on disk after pnpm build', async () => {
    for (const pkgDir of WORKSPACE_PACKAGES) {
      const manifest = JSON.parse(await readFile(join(REPO_ROOT, pkgDir, 'package.json'), 'utf8')) as {
        exports?: Record<string, string | { default?: string; types?: string }>
        dsh?: { bundle?: { patch?: string | string[] } }
      }
      for (const [subpath, target] of Object.entries(manifest.exports ?? {})) {
        if (typeof target === 'string') {
          const ok = target.includes('*')
            ? await matchesWildcardTarget(pkgDir, target)
            : existsSync(join(REPO_ROOT, pkgDir, target))
          expect(ok, `${pkgDir} export ${subpath} -> ${target}`).toBe(true)
          continue
        }
        if (target.default !== undefined) {
          expect(existsSync(join(REPO_ROOT, pkgDir, target.default)), `${pkgDir} export ${subpath} default`).toBe(true)
        }
        if (target.types !== undefined) {
          expect(existsSync(join(REPO_ROOT, pkgDir, target.types)), `${pkgDir} export ${subpath} types`).toBe(true)
        }
      }
      const patchField = manifest.dsh?.bundle?.patch
      const patches = patchField === undefined ? [] : typeof patchField === 'string' ? [patchField] : patchField
      for (const patchPath of patches) {
        expect(existsSync(join(REPO_ROOT, pkgDir, patchPath)), `${pkgDir} dsh.bundle.patch -> ${patchPath}`).toBe(true)
      }
    }
  })
})
