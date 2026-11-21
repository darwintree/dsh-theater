# Assembly and Runtime Flows

These flows show how the DSH host, Agent Presets, Stage, Theater, and domain
plugins compose. Gomoku is the concrete example; the ownership and assembly
boundaries apply to other Stage-backed applications.

The target relationship between Stage declaration modules, Tool modules,
and their composition root is documented in [Composition](./composition.md).

## Direct Agent with a preset-declared Stage

Single-Agent Gomoku uses a Stage declaration from its Agent preset:

```text
DSH loads the Stage and Gomoku modules
  -> the Agent preset declares board1 and Tools bound to it
  -> an Agent mounts the preset
  -> a Tool opens board1 in the Agent Session
  -> the Tool submits a Stage Op
  -> the Stage applies and persists the accepted Stage Op
```

The Agent Session owns both the Stage and the Agent transcript in this mode.

## Theater Performance

Two-Character Gomoku creates a Performance Session through Theater:

```text
DSH loads the Stage, Theater, and Gomoku modules
  -> the Performance preset declares board1, black, white, their Tools, and a Director
  -> Theater creates the Performance Session and Character Sessions
  -> Theater opens board1 in the Performance Session and binds each Character's Tools
  -> the Director selects the next Character from the board state
  -> Theater runs one Character Turn
  -> the Character's Tool submits a Stage Op to board1
  -> Theater reaches the next Director Point and continues or completes
```

The Performance Session owns any declared Stages and durable Theater boundaries.
Each Character Session owns only that Character's Agent history. Stage-free
Performances (such as `role-play-v3`) follow the same flow without mounting
`@darwintree/dsh-stage`, driving decisions solely from structured settled
Character Turns.

Only a `completed` top-level Character Turn produces a new Director Point; a
runtime Turn failure or process crash mid-Segment halts the Performance, and
recovery forks from the last valid Director Point. While awaiting a pluggable
Director (automatic, step-gated, or human-driven), the Performance stays at its
current Director Point (`activity: 'awaiting-director'`) and can be forked or
stopped cleanly via `ctx.theater.stop()`.
