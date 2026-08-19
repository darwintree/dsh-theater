# dsh-stage

`ctx.stages` is a concrete Cordis Service that routes canonical Ops to live
State Machines by Stage ID. The Service owns Session configuration, accepted Op
persistence, flush, replay, read, and completion; State Machines hold only live
state and deterministic domain rules. Stage IDs are independent of State
Machine kind and Agent identity.

A State Machine exposes a single `transition(op)` entry: the same canonical Op
drives live transitions and replay. Accepted transitions atomically advance
state and may return an optional observational outcome; domain rejections
return a reason without changing state; program faults throw. Only accepted
Ops are persisted; the calling Agent Session is the authority for persistence.

```ts
await ctx.stages.ensure(stageId, { session, factory, config })
const result = await ctx.stages.interact(stageId, op)
const snapshot = ctx.stages.read(stageId)
const done = ctx.stages.completed(stageId)
```

Out of scope: concurrent interactions, disposal and live-registry cleanup,
retry/dedup/idempotency, a general tool-to-stageId resolver, and multiple
Stages per Session before that resolver exists.

