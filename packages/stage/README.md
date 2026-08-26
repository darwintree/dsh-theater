# dsh-stage

`ctx.stages` is a concrete Cordis Service that routes canonical Ops to live
State Machines by owning Session and Stage ID. The Service owns Session configuration, accepted Op
persistence, flush, replay, read, and completion; State Machines hold only live
state and deterministic domain rules. Two Sessions may use the same Stage ID
without sharing live state or durable Ops.

A State Machine exposes a single `transition(op)` entry: the same canonical Op
drives live transitions and replay. Accepted transitions atomically advance
state and may return an optional observational outcome; domain rejections
return a reason without changing state; program faults throw. Only accepted
Ops are persisted in the owning Session, even when another Session's Agent
invokes the operation.

State Machine plugins register their factory once. Agent presets declare one or
more Stages by Stage ID:

```ts
ctx.stages.registerFactory(factory)
```

```yaml
- id: stages
  name: '@darwintree/dsh-stage/preset'
  config:
    stages:
      board1:
        machine: gomoku
        params:
          boardSize: 15
          winLength: 5
```

An Agent-scoped caller then opens the declaration lazily in its own Session:

```ts
await ctx.stages.ensureDeclared(agent.ctx, agent.session, 'board1')
const result = await ctx.stages.interact(session, stageId, op)
const snapshot = ctx.stages.read(session, stageId)
const done = ctx.stages.completed(session, stageId)
```

Assembly code that already owns a concrete factory may still pass
`{ factory, config }` directly to `ensure`.

Out of scope: concurrent interactions, disposal and live-registry cleanup,
and retry/dedup/idempotency.
