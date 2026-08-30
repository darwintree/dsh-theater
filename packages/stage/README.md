# dsh-stage

`ctx.stages` is a concrete Cordis Service that routes canonical Ops to live
State Machines by owning Session and Stage ID. The Service owns persistence and
replay; State Machines hold live state and deterministic domain rules. Two
Sessions may use the same Stage ID without sharing state.

A State Machine receives canonical Stage Ops. Only accepted Stage Ops are
persisted in the owning Session, and replaying them restores the Stage.

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
const result = await ctx.stages.interact(agent.session, 'board1', op)
const snapshot = ctx.stages.read(agent.session, 'board1')
const done = ctx.stages.completed(agent.session, 'board1')
```
