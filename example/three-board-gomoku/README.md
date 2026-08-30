# Master vs Three Challengers

This example extends DSH Theater without changing its core. Three Gomoku Stages
belong to one Performance. Each Challenger receives ordinary Tools bound to one
board, while the Master receives Tools with a `game` parameter that route to all
three boards.

The Director derives the schedule from the boards: Challenger 1, Challenger 2,
Challenger 3, then the Master until every pending black move has a white reply.
The preset disables automatic advancement so each Character Turn can be
inspected with `ctx.theater.advance()`.

Install the Stage, Theater, Gomoku, and example bundles, then copy the preset to
the Harness preset root:

```sh
cd ../deepseek-harness
pnpm dsh plugin --profile web add \
  link:../dsh-theater-new/packages/stage \
  link:../dsh-theater-new/packages/theater \
  link:../dsh-theater-new/packages/theater-gomoku \
  link:../dsh-theater-new/example/three-board-gomoku

mkdir -p "${DSH_HOME:-$HOME/.dsh}/.agent-presets/three-board-gomoku"
cp ../dsh-theater-new/example/three-board-gomoku/preset/*.yml \
  "${DSH_HOME:-$HOME/.dsh}/.agent-presets/three-board-gomoku/"
```

Create and advance the Performance through `ctx.theater`:

```ts
await ctx.theater.create({
  performanceId,
  presetId: 'three-board-gomoku',
  cwd,
})
await ctx.theater.advance(performanceId)
```
