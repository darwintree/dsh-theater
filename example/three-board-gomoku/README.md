# Master vs Three Challengers

This example extends DSH Theater without changing its core. Three Gomoku Stages
belong to one Performance. Each Challenger receives ordinary Tools bound to one
board, while the Master receives Tools with a `game` parameter that route to all
three boards.

The Director derives the schedule from the boards: Challenger 1, Challenger 2,
Challenger 3, then the Master until every pending black move has a white reply.
The preset disables automatic advancement so each Character Turn can be
inspected with `ctx.theater.advance()`.

Install the Stage, Theater, Gomoku, and example bundles; `dsh.bundle.patch`
registers both the host plugin and the `three-board-gomoku` preset automatically
(see also the root [README](../../README.md)):

```sh
pnpm build

dsh plugin --profile theater-dev add \
  ./packages/stage \
  ./packages/theater \
  ./packages/theater-gomoku \
  ./example/three-board-gomoku
```

Run a headless smoke test or drive the Performance programmatically through `ctx.theater`:

```sh
dsh --profile theater-dev \
  --patch ./packages/theater/headless.cordis.patch.yml \
  -- --preset three-board-gomoku --max-segments 6
```

```ts
await ctx.theater.create({
  performanceId,
  presetId: 'three-board-gomoku',
  cwd,
})
await ctx.theater.advance(performanceId)
```
