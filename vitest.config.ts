import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const fromRoot = (relative: string) => fileURLToPath(new URL(relative, import.meta.url))

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@darwintree\/dsh-llm-mock$/, replacement: fromRoot('./packages/llm-mock/src/index.ts') },
      { find: /^@darwintree\/dsh-stage$/, replacement: fromRoot('./packages/stage/src/index.ts') },
      { find: /^@darwintree\/dsh-stage\/preset$/, replacement: fromRoot('./packages/stage/src/preset.ts') },
      { find: /^@darwintree\/dsh-theater$/, replacement: fromRoot('./packages/theater/src/index.ts') },
      { find: /^@darwintree\/dsh-theater\/preset$/, replacement: fromRoot('./packages/theater/src/preset.ts') },
      { find: /^@darwintree\/dsh-theater\/headless$/, replacement: fromRoot('./packages/theater/src/headless.ts') },
      { find: /^@darwintree\/dsh-theater-gomoku$/, replacement: fromRoot('./packages/theater-gomoku/src/index.ts') },
      { find: /^@darwintree\/dsh-theater-gomoku\/single-agent$/, replacement: fromRoot('./packages/theater-gomoku/src/single-agent.ts') },
      { find: /^@darwintree\/dsh-theater-gomoku\/director$/, replacement: fromRoot('./packages/theater-gomoku/src/director.ts') },
      { find: /^@darwintree\/dsh-theater-gomoku\/theater$/, replacement: fromRoot('./packages/theater-gomoku/src/theater.ts') },
      { find: /^@darwintree\/dsh-theater-role-play$/, replacement: fromRoot('./packages/theater-role-play/src/index.ts') },
      { find: /^@darwintree\/dsh-theater-role-play\/director$/, replacement: fromRoot('./packages/theater-role-play/src/director.ts') },
      { find: /^@darwintree\/dsh-theater-role-play\/v3$/, replacement: fromRoot('./packages/theater-role-play/src/preset.ts') },
      { find: /^@darwintree\/dsh-theater-example-three-board-gomoku$/, replacement: fromRoot('./example/three-board-gomoku/src/index.ts') },
      { find: /^@darwintree\/dsh-theater-example-three-board-gomoku\/director$/, replacement: fromRoot('./example/three-board-gomoku/src/director.ts') },
    ],
  },
  test: {
    include: [
      'tests/**/*.spec.ts',
      'packages/*/tests/**/*.spec.ts',
      'example/*/tests/**/*.spec.ts',
    ],
  },
})
