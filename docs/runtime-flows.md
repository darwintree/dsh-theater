# Assembly and Runtime Flows

These flows show how the DSH host, Agent Presets, Stage, Theater, and domain
plugins compose. Gomoku is the concrete example; the ownership and assembly
boundaries apply to other Stage-backed applications.

The target relationship between Stage declaration modules, Toolset modules,
and their composition root is documented in [Composition](./composition.md).

## Direct Agent with a preset-declared Stage

Single-Agent Gomoku uses a Stage declaration from its Agent preset:

```text
DSH starts
  -> loads @darwintree/dsh-stage and creates ctx.stages
  -> loads @darwintree/dsh-theater-gomoku
     -> registers gomokuFactory in ctx.stages
  -> first resolves the Gomoku Agent preset
     -> @darwintree/dsh-theater-gomoku/single-agent registers place_stone
        in the preset scope, bound to stage: board1
     -> @darwintree/dsh-stage/preset reads stages.board1
     -> resolves machine: gomoku through gomokuFactory
     -> validates params and stores the resolved declaration in the preset scope
  -> creates the Agent and mounts that preset scope
     -> only this preset's Agents can see place_stone
  -> the Agent first calls place_stone
     -> ensureDeclared(...) creates the Gomoku State Machine
     -> writes stage/configured to the Agent Session
     -> applies the move and writes an accepted stage/op there
```

The Agent Session owns both the Stage and the Agent transcript in this mode.

## Theater Performance

> **Status: pending adjustment.** The flow below records the current
> implementation and is not yet an accepted target design.

Two-Character Gomoku creates a Performance Session through Theater:

```text
DSH starts
  -> loads @darwintree/dsh-stage and creates ctx.stages
  -> loads @darwintree/dsh-theater and creates ctx.theater
  -> loads @darwintree/dsh-theater-gomoku and registers gomokuFactory
  -> first resolves the two-character-gomoku preset
     -> its plugin contributes black and white Characters
     -> contributes the board1 Stage backed by gomokuFactory
     -> contributes the Gomoku Director
  -> ctx.theater.create({ performanceId, presetId: 'two-character-gomoku' })
     -> creates the Performance Session
     -> creates board1 and writes stage/configured to the Performance Session
     -> creates black and white Character Sessions and mounts their presets
     -> writes theater/configured and starts the Theater Main Loop
  -> Director reads board1 and selects the Character whose color moves next
  -> Theater writes theater/segment-started and injects the instruction
  -> the selected Character runs until it calls its bound place_stone tool
     -> accepted stage/op is written to the Performance Session
     -> Tool and message events remain in the Character Session
  -> Theater writes theater/segment-ended, producing the next Director Point
  -> repeats until the Director returns complete
```

The Performance Session owns the shared Stage and durable Theater boundaries.
Each Character Session owns only that Character's Agent history.
