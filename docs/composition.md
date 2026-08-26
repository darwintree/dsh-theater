# Composition

This document is the shared home for the repository's composition model. It
records how independently provided modules are selected, connected, and scoped
by presets. New composition rules should extend this document.

## Stage and Toolset modules

### User story

1. Module S declares one or more Stages.
2. Module T declares a Toolset that can operate a Stage.
3. A preset composes the two modules and binds the Toolset to a declared Stage.

The preset is the composition root. A Stage ID belongs to that composition:
Module S declares it, Module T consumes it as a reference, and neither module
invents a shared Stage ID in its implementation.

### Configuration shape

For direct Single-Agent Gomoku, the composition is:

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

- id: gomoku-tools
  name: '@darwintree/dsh-theater-gomoku/single-agent'
  config:
    stage: board1
```

`stages.board1` is the declaration. `stage: board1` is a reference to that
declaration, like a foreign key; it is not a second source of Stage
configuration.

The Toolset module accepts the reference through its plugin configuration and
binds every Tool it registers to that Stage:

```ts
interface Config {
  stage: string
}

export function apply(ctx: Context, config: Config): void {
  ctx.tools.register(createGomokuTool(ctx, config.stage))
}
```

### Responsibilities

Module S owns:

- the Stage ID declaration;
- the State Machine kind and first-use parameters;
- validation and registration of the declaration in the preset scope.

Module T owns:

- model-facing Tool schemas and results;
- translation from Tool calls to canonical Stage Ops;
- registration of the Toolset in its target Agent or Character scope.

The preset owns:

- selecting Modules S and T;
- choosing which declared Stage the Toolset operates;
- keeping the binding explicit when more than one Stage exists.

The State Machine remains independent of Tool schemas, Agent scopes, and Tool
visibility. Tool exposure is assembly state and is not persisted in
`stage/configured`; only the resolved State Machine configuration is durable.

### Resolution flow

```text
Preset resolution
  -> Module S declares board1
  -> Module T receives stage: board1
  -> Module T registers a Toolset bound to board1
  -> an Agent joins the preset scope and sees that Toolset
  -> a Tool call resolves board1 in the Agent's declaration scope
  -> the Stage Op is written to the Stage's owning Session
```

### Theater follow-up

The same composition rule applies to Theater, but its target and owner scopes
differ: a Character sees the Toolset while the Stage may be owned by the
Performance Session. Theater still needs an explicit mechanism that carries a
preset-owned Stage binding into the target Character scope. Hard-coding the
Stage ID in a Character Tool or repeating it independently in every Character
preset does not satisfy this composition model.
