# dsh-theater

`ctx.theater` composes durable multi-Character Performances from one preset. A
Performance Session is the public root and is not driven by an Agent Loop. The
preset declares Stages, each Character's complete Tool creation plan, and
exactly one domain-owned Director. Theater combines those declarations when it
creates, resumes, or forks a Performance.

Theater owns the Performance Main Loop. At each Director Point it asks the
Director whether to run one Character Turn or complete the Performance.
Character Turns run serially in separate Character Sessions, while their Tools
operate on Stages owned by the Performance Session. A Performance may be forked
at a Director Point.

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
