import { defineConfig } from 'vitest/config'
import { buildVitestWorkspaceAliases } from './tests/workspace-packages.ts'

export default defineConfig({
  resolve: {
    alias: buildVitestWorkspaceAliases(),
  },
  test: {
    include: [
      'tests/**/*.spec.ts',
      'packages/*/tests/**/*.spec.ts',
      'example/*/tests/**/*.spec.ts',
    ],
  },
})
