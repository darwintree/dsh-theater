# dsh-theater-gomoku

A Gomoku Stage integration with two composition modes:

- `preset/` keeps the direct Single-Agent game.
- `presets/` provides a Theater Performance with independent black and white
  Character Sessions and one Performance-owned board.

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

## Presets

`preset/` provides the direct Gomoku entry for the Harness Web preset picker. The
following follows the Harness profile/plugin flow and assumes this repository
and `deepseek-harness` are siblings.

Build this workspace:

```sh
pnpm install --frozen-lockfile
pnpm build
```

Install the Stage, Theater, and Gomoku bundles:

```sh
cd ../deepseek-harness
pnpm dsh plugin --profile web add \
  link:../dsh-theater-new/packages/stage \
  link:../dsh-theater-new/packages/theater \
  link:../dsh-theater-new/packages/theater-gomoku
```

Harness discovers user presets from `$DSH_HOME/.agent-presets` (defaulting to
`~/.dsh/.agent-presets`). Copy the shipped preset there from the
`dsh-theater-new` checkout:

```sh
cd ../dsh-theater-new
mkdir -p "${DSH_HOME:-$HOME/.dsh}/.agent-presets/gomoku"
cp packages/theater-gomoku/preset/*.yml \
  "${DSH_HOME:-$HOME/.dsh}/.agent-presets/gomoku/"

cp -R packages/theater-gomoku/presets/* \
  "${DSH_HOME:-$HOME/.dsh}/.agent-presets/"
```

Verify the composed profile, then start Web:

```sh
cd ../deepseek-harness
pnpm dsh web --dump-config
pnpm dsh web
```

Choose **Gomoku** for the direct Agent mode. Two-Character Gomoku is
created through `ctx.theater` with preset ID `two-character-gomoku`.

To smoke-test one Performance without Web, install the same three bundles in
the `headless` profile, copy the presets as above, then replace DSH's ordinary
one-Agent runner with the supplied patch:

```sh
cd ../deepseek-harness
pnpm dsh plugin --profile headless add \
  link:../dsh-theater-new/packages/stage \
  link:../dsh-theater-new/packages/theater \
  link:../dsh-theater-new/packages/theater-gomoku
pnpm dsh --profile headless \
  --patch ../dsh-theater-new/packages/theater-gomoku/headless.cordis.patch.yml
```

The headless runner advances four Character Turns and prints the resulting
Performance read as JSON.

Remove the local bundles when they are no longer needed:

```sh
pnpm dsh plugin --profile web remove \
  @darwintree/dsh-theater-gomoku \
  @darwintree/dsh-theater \
  @darwintree/dsh-stage
```
