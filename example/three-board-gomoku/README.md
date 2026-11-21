# Master vs Three Challengers

This example extends DSH Theater without changing its core. Three Gomoku Stages
belong to one Performance. Each Challenger receives ordinary Tools bound to one
board, while the Master receives Tools with a `game` parameter that route to all
three boards.

The Director derives the schedule from the boards: Challenger 1, Challenger 2,
Challenger 3, then the Master until every pending black move has a white reply.
Wrap the default Director with `createStepDirector()` when you want to inspect
each Character Turn one step at a time.

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

Run a headless smoke test or drive the Performance step-by-step through `ctx.theater`:

```sh
dsh --profile theater-dev \
  --patch ./packages/theater/headless.cordis.patch.yml \
  -- --preset three-board-gomoku --max-segments 6
```

```ts
import { createStepDirector } from '@darwintree/dsh-theater'

const stepper = createStepDirector()
await ctx.theater.create({
  performanceId,
  presetId: 'three-board-gomoku',
  cwd,
  wrapDirector: base => stepper.wrap(base),
})
await stepper.step()
await ctx.theater.stop(performanceId)
```
