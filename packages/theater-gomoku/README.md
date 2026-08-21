# dsh-theater-gomoku

A Gomoku game plugin: a pure State Machine plus a global `place_stone` tool.

The State Machine owns live board state and the deterministic domain rules
(integer coordinates, bounds, occupancy, black/white rotation, win and draw
detection, terminal rejection). The Stage Service owns persistence; the same
canonical place-stone Op drives live transitions and replay.

The global `place_stone` tool derives a temporary Stage ID of
`${sessionId}-stage` from the calling Agent Session, lazily ensures or
restores the Gomoku Stage, applies one Op, and renders the complete board,
winner, and completion state. The user plays black and the Agent plays white;
the Agent calls the tool once for the user's directed black move and again for
its own chosen white move before replying. The tool does not call
`concludeTurn()`.

```ts
await ctx.plugin(StageService)   // provides ctx.stages
await ctx.plugin(GomokuPlugin)   // registers place_stone
```

## Web preset

`preset/` provides the Gomoku entry for the Harness Web preset picker. The
following follows the Harness profile/plugin flow and assumes this repository
and `deepseek-harness` are siblings.

Build this workspace:

```sh
pnpm install --frozen-lockfile
pnpm build
```

Install both bundles into the Web profile, with Stage first because Gomoku
injects `ctx.stages`:

```sh
cd ../deepseek-harness
pnpm dsh plugin --profile web add \
  link:../dsh-theater-new/packages/stage \
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
```

Verify the composed profile, then start Web:

```sh
cd ../deepseek-harness
pnpm dsh web --dump-config
pnpm dsh web
```

Open `http://127.0.0.1:3080` and choose **Gomoku Theater** when creating a
session.

Remove the local bundles when they are no longer needed:

```sh
pnpm dsh plugin --profile web remove \
  @darwintree/dsh-theater-gomoku \
  @darwintree/dsh-stage
```

Out of scope: Dice, a general tool-to-stageId resolver, multi-Agent or
self-play matches, and multiple Stages per Session.
