# dsh-theater

DSH-native Stage and multi-character Performance Theater plugins for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

## Packages

Each mountable package declares a DSH bundle manifest (`dsh.bundle.patch`), and scenario packages ship their Agent Presets directly as declarative `@deepseek-ai/dsh-agent-preset` patch files under `presets/<preset-id>.patch.yml` using package export specifiers:

| Package | Role | Bundle Patches | Presets |
|---|---|---|---|
| `@darwintree/dsh-stage` (`packages/stage`) | Durable Stage service (`ctx.stages`) & preset declarations | `cordis.patch.yml` | — |
| `@darwintree/dsh-theater` (`packages/theater`) | Performance runtime (`ctx.theater`), preset API, generic headless runner | `cordis.patch.yml`, `headless.cordis.patch.yml` | — |
| `@darwintree/dsh-theater-gomoku` (`packages/theater-gomoku`) | Gomoku State Machine, Single-Agent tools, and two-character Director | `cordis.patch.yml`, `presets/*.patch.yml` | `gomoku`, `two-character-gomoku` |
| `@darwintree/dsh-theater-role-play` (`packages/theater-role-play`) | Stage-free multi-character Role-play tools, Director, and v3 preset | `cordis.patch.yml`, `presets/*.patch.yml` | `role-play-v3` |
| `@darwintree/dsh-theater-example-three-board-gomoku` (`example/three-board-gomoku`) | Master vs. Three Challengers example | `cordis.patch.yml`, `presets/*.patch.yml` | `three-board-gomoku` |
| `@darwintree/dsh-llm-mock` (`packages/llm-mock`) | Scripted LLM adapter for offline integration tests | — | — |

## Quick Start (Development & Testing)

This workspace resolves DSH dependencies from npm by default, so any standalone checkout can install, build, and run tests directly:

```bash
pnpm install
pnpm check       # tsc -b + vitest run
pnpm test:watch  # fast watch mode
pnpm build:watch # incremental dist/ rebuilds when linked into a DSH profile
```

If you need to co-develop against an unreleased local `deepseek-harness` checkout, apply temporary link overrides in `pnpm-workspace.yaml` without touching any `package.json`:

```bash
node scripts/dsh-local-links.mjs apply ../deepseek-harness
pnpm install

# Restore pinned npm versions when done:
git checkout -- pnpm-workspace.yaml pnpm-lock.yaml && pnpm install
```

## Loading into a DSH Profile

1. Build the workspace:

```bash
pnpm build
```

2. Mount `@darwintree/dsh-theater` plus `@darwintree/dsh-stage` (optional when running only Stage-free Performances such as `role-play-v3`) and whichever optional scenario bundles you want into a DSH profile (order does not matter because Cordis activates by service availability, and each scenario bundle's `dsh.bundle.patch` registers both its host plugins and its `@deepseek-ai/dsh-agent-preset` declarations automatically):

```bash
dsh plugin --profile theater-dev add \
  ./packages/stage \
  ./packages/theater \
  ./packages/theater-gomoku \
  ./packages/theater-role-play \
  ./example/three-board-gomoku
```

Installed optional bundles or presets can be disabled in the profile's `cordis.patch.yml` without uninstalling:

```yaml
- id: theater-role-play
  disabled: true
- id: preset-role-play-v3
  disabled: true
```

3. Verify composition and start DSH Web:

```bash
dsh --profile theater-dev --dump-config
dsh --profile theater-dev
```

## Headless Smoke Runs

Use the generic `@darwintree/dsh-theater/headless` patch to run any installed Performance preset in headless mode and print the final `PerformanceRead` JSON:

```bash
dsh --profile theater-dev \
  --patch ./packages/theater/headless.cordis.patch.yml \
  -- --preset two-character-gomoku --max-segments 4
```

Supported CLI flags (passed after `--` via DSH `cmdlineArgs`):

- `--preset <id>` — target Performance preset ID (e.g. `two-character-gomoku`, `three-board-gomoku`, `role-play-v3`)
- `--max-segments <n|all>` — stop after `n` completed top-level Character Segments, or `all` (default) to run until the Performance finishes
- `--cwd <path>` — working directory stored in the Performance Session header (defaults to `process.cwd()`)
- `--performance-id <id>` — explicit Performance Session ID (defaults to `performance-<uuid>`)

## Documentation

- [CONTEXT.md](./CONTEXT.md) — shared domain glossary and boundaries
- [docs/composition.md](./docs/composition.md) — preset composition rules
- [docs/runtime-flows.md](./docs/runtime-flows.md) — Direct Agent and Performance runtime lifecycles
- [docs/adr/](./docs/adr/) — architectural decision records
