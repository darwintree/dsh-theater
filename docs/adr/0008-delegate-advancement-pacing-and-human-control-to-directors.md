---
status: accepted
---

# Delegate advancement pacing and human control to Directors

The Theater Main Loop owns only serial execution, failure halting, and cancellation—passing an `AbortSignal` through `DirectorContext` and awaiting the plugged-in `Director` once per `Director Point` without discarding `act` decisions or embedding `autoAdvance` / `advance()` gating. Automatic progression, step-by-step gating, turn limits (such as headless runs), and human-driven selection live inside interchangeable `Director` implementations and wrappers provided inside the theater/director module boundary. While awaiting a `Director Decision`, an active Performance remains at its current `Director Point` (cancellable and forkable), distinct from executing a Character Turn.

## Considered Options

- **Dual waiting mechanisms (`autoAdvance` in Main Loop plus async `Director`)**: causes the Main Loop to call and discard `act` decisions while paused, breaking human-driven or side-effecting Directors and forcing workarounds such as `session/flush` listeners in headless runners.
- **Two-phase `Director` interface (read-only completion check plus gated action call)**: keeps pacing inside `TheaterService` but complicates every Director implementation with split liveness methods when a simple Director wrapper achieves both eager and lazy gating without changing the Main Loop.
