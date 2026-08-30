# dsh-theater

`ctx.theater` composes durable multi-Character Performances from one preset. A
Performance Session is the public root and is not driven by an Agent Loop. The
preset declares Stages, each Character's complete Tool creation plan, and
exactly one domain-owned Director. Theater combines those declarations when it
creates, resumes, or forks a Performance.

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
call advances at most one Character Segment:

```ts
await ctx.theater.advance(performanceId)
ctx.theater.setAutoAdvance(performanceId, true)
await ctx.theater.whenIdle(performanceId)
```

`setAutoAdvance(false)` does not cancel an open Character Segment; the Main
Loop stops at the next Director Point. Runtime switching is process-local.
Resume and fork restore the preset value stored in `theater/configured`.

Bare Character Agent Loops run in separate deterministically named Sessions.
Theater materializes ordinary Tools against the current Performance's Stages
and registers the exact list in each Character Agent scope. Each
invocation is enclosed by durable `theater/segment-started` and
`theater/segment-ended` events in the Performance Session. Only prefixes with
an empty Segment stack are forkable; each Segment end records the acting
Character Session's exclusive watermark.

Theater owns the Performance Main Loop. At each forkable Director Point it
asks the Director for one decision: `act` or `complete`. Completion always
settles immediately; an action requires automatic advancement or one explicit
advance permit and settles before another decision. The Director reads durable
state and decides Performance completion;
Stages remain the source of domain terminal facts.

Performance reads expose `phase`, Main Loop `activity`, current `autoAdvance`,
Stage state, forkable positions, and Character Session references. `whenIdle()`
observes Main Loop quiescence rather than Performance completion. Character
Events and Instructions are not copied into a merged transcript. Projection,
Character-level fork, parallel Character execution, and Workflow replay are not
implemented.
