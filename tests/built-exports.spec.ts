import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
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

describe('built package exports smoke check', () => {
  it.skipIf(!hasBuiltDist)('materializes every declared export target on disk after pnpm build', async () => {
    for (const pkgDir of WORKSPACE_PACKAGES) {
      const manifest = JSON.parse(await readFile(join(REPO_ROOT, pkgDir, 'package.json'), 'utf8')) as {
        exports?: Record<string, string | { default?: string; types?: string }>
      }
      for (const [subpath, target] of Object.entries(manifest.exports ?? {})) {
        if (typeof target === 'string') {
          expect(existsSync(join(REPO_ROOT, pkgDir, target)), `${pkgDir} export ${subpath} -> ${target}`).toBe(true)
          continue
        }
        if (target.default !== undefined) {
          expect(existsSync(join(REPO_ROOT, pkgDir, target.default)), `${pkgDir} export ${subpath} default`).toBe(true)
        }
        if (target.types !== undefined) {
          expect(existsSync(join(REPO_ROOT, pkgDir, target.types)), `${pkgDir} export ${subpath} types`).toBe(true)
        }
      }
    }
  })
})
