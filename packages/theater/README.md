# dsh-theater

`ctx.theater` composes durable multi-Character Performances from one preset. A
Performance Session is the public root and is not driven by an Agent Loop. The
preset may declare zero or more Stages (`@darwintree/dsh-stage` is optional for
Stage-free Performances), declares each Character's System Prompt and Tool list
(which may be empty), and a default Director.

At creation time, Theater persists the resolved `Performance Configuration`
(`systemPrompt`, `model`, resolved Tool configs, and declared Stages) as the
authoritative snapshot across `resume` and `fork`. On `resume` and `fork`,
Theater checks structural compatibility (Character roster, Stage IDs and
State Machine kind/version, and required factory availability) and allows
replacing or wrapping the `Director`. Session titles are written on creation and
only filled when missing on resume, so an explicit rename is never overwritten.

Theater owns the Performance Main Loop. At each `Director Point` it awaits one
cancellable `Director Decision` (`DirectorContext.signal`), executes an `act`
Turn or completes the Performance, and halts on any non-completed top-level Turn.
Only a `completed` top-level Character Turn produces a new `Director Point` /
`forkablePositions` entry; recovery from runtime Turn failures or mid-Turn
crashes always forks from the last valid `Director Point`.

Directors and Tools share a structured read-only view of Character Turns
(`entries` and paired `toolCalls`) without touching raw DSH Session events.
`TheaterToolContext` exposes `stage(id)`, the Character roster,
`currentTurnKind()`, `readCurrentTurn()`, `readSettledTurns()`,
`runNestedTurn()`, and `abortTurn(reason)`.

## Usage

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

Advancement pacing and human-driven control live inside pluggable `Director`
implementations and wrappers (`createStepDirector`, `createHumanDirector`,
`createTurnLimitDirector`), and an active Performance can be stopped cleanly at
any time via `ctx.theater.stop(performanceId)`:

```ts
import { createHumanDirector, createStepDirector } from '@darwintree/dsh-theater'

const stepper = createStepDirector()
await ctx.theater.create({
  performanceId,
  presetId,
  cwd,
  wrapDirector: base => stepper.wrap(base),
})
await stepper.step()
stepper.setContinuous(true)
await ctx.theater.whenIdle(performanceId)

const human = createHumanDirector()
await ctx.theater.resume({ performanceId, director: human.director })
const req = await human.nextRequest()
req.act('black', [{ type: 'text', text: 'Make your move.' }])
await ctx.theater.stop(performanceId)
```
