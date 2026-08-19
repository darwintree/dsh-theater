# dsh-theater-gomoku

A Gomoku game plugin: a pure State Machine plus a global `place_stone` tool.

The State Machine owns live board state and the deterministic domain rules
(integer coordinates, bounds, occupancy, black/white rotation, win and draw
detection, terminal rejection). The Stage Service owns persistence; the same
canonical place-stone Op drives live transitions and replay.

The global `place_stone` tool derives a temporary Stage ID of
`${sessionId}-stage` from the calling Agent Session, lazily ensures or
restores the Gomoku Stage, applies one Op, and renders the complete board,
winner, and completion state. The user plays black and the Agent plays white;
the Agent calls the tool once for the user's directed black move and again for
its own chosen white move before replying. The tool does not call
`concludeTurn()`.

```ts
await ctx.plugin(StageService)   // provides ctx.stages
await ctx.plugin(GomokuPlugin)   // registers place_stone
```

Out of scope: Dice, a general tool-to-stageId resolver, multi-Agent or
self-play matches, and multiple Stages per Session.

