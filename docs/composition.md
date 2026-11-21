# Composition

This document is the shared home for the repository's composition model. It
records how independently provided modules are selected, connected, and scoped
by presets. New composition rules should extend this document.

## Stage and Tool modules

### User story

1. Module S declares one or more Stages.
2. Module T declares one or more Tools that can operate a Stage.
3. A preset composes the two modules and binds those Tools to a declared Stage.

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

The Tool module accepts the reference through its plugin configuration and
binds every Tool it registers to that Stage.

### Responsibilities

Module S owns:

- the Stage ID declaration;
- the State Machine kind and first-use parameters;
- validation and registration of the declaration in the preset scope.

Module T owns:

- model-facing Tool schemas and results;
- translation from Tool calls to canonical Stage Ops;
- registration of the Tools in their target Agent or Character scope.

The preset owns:

- selecting Modules S and T;
- choosing which declared Stage the Tools operate;
- keeping the binding explicit when more than one Stage exists.

The State Machine remains independent of Tool schemas, Agent scopes, and Tool
visibility.

### Resolution flow

```text
Preset resolution
  -> Module S declares board1
  -> Module T receives stage: board1
  -> Module T registers its Tools bound to board1
  -> an Agent joins the preset scope and sees those Tools
  -> a Tool call resolves board1 in the Agent's declaration scope
  -> the Stage Op is written to the Stage's owning Session
```

## Performance composition

A Performance preset is the single composition root for its optional Stages, each
Character's System Prompt and complete Tool list (which may be empty for
text-only Characters), and its default Director:

```yaml
- id: stages
  name: '@darwintree/dsh-stage/preset'
  config:
    stages:
      board1:
        machine: gomoku

- id: performance
  name: '@darwintree/dsh-theater/preset'
  config:
    characters:
      black:
        model: { provider: deepseek-official, model: deepseek-v4-flash }
        systemPrompt: You are the black player in a Gomoku game.
        tools:
          - factory: gomoku-read-board
            params: { stage: board1 }
          - factory: gomoku-place-stone
            params: { stage: board1, color: black }
      white:
        systemPrompt: You are the white player in a Gomoku game.
        tools:
          - factory: gomoku-place-stone
            params: { stage: board1, color: white }

- id: director
  name: '@darwintree/dsh-theater-gomoku/director'
  config:
    stage: board1
    instruction: Use your available tools to make one legal move.
```

Stage and Tool factory providers register process capabilities at host startup.
`@darwintree/dsh-stage` is optional when a Performance declares no Stages.
`@darwintree/dsh-theater/preset` handles flat declarative presets, while
template-driven domains (such as `@darwintree/dsh-theater-role-play/v3`) may
contribute Characters, titles, and a default Director directly via
`ctx.theater.register*`.

For each Performance runtime, Theater captures the resolved Characters, Tool
configurations, and declared Stages into a durable `Performance Configuration`
snapshot. That snapshot remains authoritative across `resume` and `fork`, where
Theater verifies structural compatibility (Character IDs, declared Stage IDs and
State Machine kind/version, and required factory availability) rather than
byte-for-byte preset equality. A Tool receives a bound Stage handle, structured
Turn read views, and an explicit Turn-abort contract without touching raw DSH
Sessions or Agent handles.

The `Director` is excluded from durable identity and may be replaced or wrapped
at `create`, `resume`, or `fork` time (for example, switching between automatic,
step-gated, turn-limited, and human-driven Directors via `createStepDirector`,
`createTurnLimitDirector`, or `createHumanDirector`).

This keeps two Performances isolated even when they use the same preset and
Stage IDs. Character Sessions do not mount separate Agent Presets.
