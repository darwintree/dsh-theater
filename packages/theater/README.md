# dsh-theater

`ctx.theater` composes durable multi-Character Performances from one preset. A
Performance Session is the public root and is not driven by an Agent Loop. The
preset may declare Stages, declares each Character's complete Tool creation plan, and
exactly one domain-owned Director. Theater combines those declarations when it
creates, resumes, or forks a Performance.

The preset may also declare a Performance `title`, per-Character titles, and a
per-Character model selection. Theater persists the model selection with its
configuration and otherwise uses the deployment default model. Session titles
are written on creation and only filled when missing on resume, so an explicit
rename is never overwritten.

Theater owns the Performance Main Loop. At each Director Point it asks the
Director whether to run one Character Turn or complete the Performance.
Character Turns run serially in separate Character Sessions, while their Tools
may operate on Stages owned by the Performance Session. Stage-free Performances
use the same Main Loop and may be resumed or forked at a Director Point.

Directors can call `readSettledTurns()` to read top-level Character Turns in
Performance order. Each read contains `{ characterId, outcome, events }` and is
reconstructed from durable Segment watermarks; nested Turns are omitted.

Theater Tool factories receive a `TheaterToolContext`. It retains `stage(id)`
and exposes the bound Character roster, `currentTurnKind()`, and
`runNestedTurn()`. Nested Turns are durable LIFO Segments, bypass the Director,
and return the same settled Turn read while the calling Character's ReAct Turn
remains open.

## Usage

```ts
await ctx.theater.create({ performanceId, presetId, cwd })
await ctx.theater.whenIdle(performanceId)

const performance = ctx.theater.read(performanceId)
await ctx.theater.fork({
  sourcePerformanceId: performanceId,
  cursor: performance.forkablePositions.at(-1),
  childPerformanceId,
})
```

The Performance preset may set `autoAdvance` (default `true`). With automatic
advancement disabled, creation settles at the initial Director Point and each
call advances at most one Character Turn:

```ts
await ctx.theater.advance(performanceId)
ctx.theater.setAutoAdvance(performanceId, true)
await ctx.theater.whenIdle(performanceId)
```
