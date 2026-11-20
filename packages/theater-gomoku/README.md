# dsh-theater-gomoku

A Gomoku Stage integration with two composition modes:

- `presets/gomoku.patch.yml` provides the direct Single-Agent game (`gomoku`).
- `presets/two-character-gomoku.patch.yml` provides a Theater Performance with independent
  black and white Character Sessions and one Performance-owned board (`two-character-gomoku`).

The State Machine owns the board and Gomoku rules. The Stage Service owns its
persistence and replay.

The Gomoku host plugin registers the `gomoku` State Machine factory. The
Single-Agent preset loads the scoped `/single-agent` plugin, which exposes
`place_stone` only to Agents using that preset, and declares a `board1` Stage
backed by the `gomoku` factory. The preset passes `stage: board1` to bind the
Tools to that declaration. The Tools open the Stage in the Agent Session and
render the board after each move.
The user plays black and the Agent plays white; the Agent calls the tool once
for the user's directed black move and again for its own chosen white move
before replying.

```ts
await ctx.plugin(StageService)   // provides ctx.stages
await ctx.plugin(GomokuPlugin)   // registers the gomoku factory
```

See the repository-level [assembly and runtime flows](../../docs/runtime-flows.md)
for the direct Agent and Theater Performance lifecycles.

The Theater preset gives black `read_board` plus a color-bound
`place_stone(x, y)`, and gives white only its color-bound `place_stone`. Theater
also applies each Character's preset-declared System Prompt and materializes
those Tools against the Performance-owned board.

## Presets & DSH Loading

Build the workspace and mount the core and Gomoku bundles into a DSH profile;
`dsh.bundle.patch` registers both the host plugins and the two declarative
presets automatically (see also the root [README](../../README.md)):

```sh
pnpm install --frozen-lockfile
pnpm build

dsh plugin --profile theater-dev add \
  ./packages/stage \
  ./packages/theater \
  ./packages/theater-gomoku
```

Verify the composed profile, then start Web:

```sh
dsh --profile theater-dev --dump-config
dsh --profile theater-dev
```

Choose **Gomoku** for the direct Agent mode. Two-Character Gomoku is created
through `ctx.theater` with preset ID `two-character-gomoku`.

To smoke-test one Performance in headless mode without Web, use the generic
Theater headless patch:

```sh
dsh --profile theater-dev \
  --patch ./packages/theater/headless.cordis.patch.yml \
  -- --preset two-character-gomoku --max-segments 4
```

Remove the local bundles when they are no longer needed:

```sh
dsh plugin --profile theater-dev remove \
  @darwintree/dsh-theater-gomoku \
  @darwintree/dsh-theater \
  @darwintree/dsh-stage
```
