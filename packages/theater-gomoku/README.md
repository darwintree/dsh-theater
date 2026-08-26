# dsh-theater-gomoku

A Gomoku State Machine with two modes:

- `preset/` keeps the direct Single-Agent game.
- `presets/` provides a Theater Performance with independent black and white
  Character Sessions and one Performance-owned board.

The State Machine owns live board state and the deterministic domain rules
(integer coordinates, bounds, occupancy, black/white rotation, win and draw
detection, terminal rejection). The Stage Service owns persistence; the same
canonical place-stone Op drives live transitions and replay.

The Gomoku host plugin registers the `gomoku` State Machine factory. The
Single-Agent preset loads the scoped `/single-agent` plugin, which exposes
`place_stone` only to Agents using that preset, and declares a `board1` Stage
backed by the `gomoku` factory. The preset passes `stage: board1` to bind the
Toolset to that declaration. The tool resolves it through the calling Agent's
preset scope, lazily opens the Stage in the Agent Session,
applies one Op, and renders the complete board, winner, and completion state.
The user plays black and the Agent plays white; the Agent calls the tool once
for the user's directed black move and again for its own chosen white move
before replying. The tool does not call `concludeTurn()`.

```ts
await ctx.plugin(StageService)   // provides ctx.stages
await ctx.plugin(GomokuPlugin)   // registers the gomoku factory
```

See the repository-level [assembly and runtime flows](../../docs/runtime-flows.md)
for the direct Agent and Theater Performance lifecycles.

The Theater Character presets register `read_board` and a color-bound
`place_stone(x, y)`. Board reads stay in the Character Session without a Stage
Op. Accepted placements call `concludeTurn()`; rejected placements remain in
the same Character turn for retry.

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
created through `ctx.theater` with preset ID `two-character-gomoku`; it does not
pretend the Performance Session is an Agent conversation.

Remove the local bundles when they are no longer needed:

```sh
pnpm dsh plugin --profile web remove \
  @darwintree/dsh-theater-gomoku \
  @darwintree/dsh-theater \
  @darwintree/dsh-stage
```

Out of scope: user input, Projection, parallel Tool Calls, and independent
Character forks.
