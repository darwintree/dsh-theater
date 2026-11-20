import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const fromRoot = (relative: string) => fileURLToPath(new URL(relative, import.meta.url))

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@darwintree\/dsh-theater$/, replacement: fromRoot('./packages/theater/src/index.ts') },
      { find: /^@darwintree\/dsh-theater\/events$/, replacement: fromRoot('./packages/theater/src/events.ts') },
      { find: /^@darwintree\/dsh-theater\/scenario$/, replacement: fromRoot('./packages/theater/src/scenario.ts') },
      { find: /^@darwintree\/dsh-theater-gomoku$/, replacement: fromRoot('./packages/theater-gomoku/src/index.ts') },
      { find: /^@darwintree\/dsh-theater-gomoku\/state$/, replacement: fromRoot('./packages/theater-gomoku/src/state.ts') },
    ],
  },
  test: {
    include: ['packages/*/tests/**/*.spec.ts'],
  },
})
