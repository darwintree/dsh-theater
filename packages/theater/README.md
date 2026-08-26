# dsh-theater

`ctx.theater` composes durable multi-Character Performances from one preset. A
Performance Session is the public root and is not driven by an Agent Loop. The
preset declares Stages, each Character's complete Tool creation plan, and
exactly one domain-owned Director. Theater combines those declarations when it
creates, resumes, or forks a Performance.

```ts
await ctx.theater.create({ performanceId, presetId })
await ctx.theater.whenIdle(performanceId)

const performance = ctx.theater.read(performanceId)
await ctx.theater.fork({
  sourcePerformanceId: performanceId,
  cursor: performance.forkablePositions.at(-1),
  childPerformanceId,
})
```

Bare Character Agent Loops run in separate deterministically named Sessions.
Theater materializes ordinary Tools against the current Performance's Stages
and registers the exact list in each Character Agent scope. Each
invocation is enclosed by durable `theater/segment-started` and
`theater/segment-ended` events in the Performance Session. Only prefixes with
an empty Segment stack are forkable; each Segment end records the acting
Character Session's exclusive watermark.

Theater owns the Performance Main Loop. At each forkable Director Point it
asks the Director for one decision: `act` or `complete`. It executes and
settles an action before asking again, or completes the Performance. The
Director reads durable state and decides Performance completion;
Stages remain the source of domain terminal facts.

Performance reads expose runtime status, Stage state, forkable positions, and
Character Session references. Character Events and Instructions are not copied
into a merged transcript. Projection, Character-level fork, parallel Character
execution, and Workflow replay are not implemented.
