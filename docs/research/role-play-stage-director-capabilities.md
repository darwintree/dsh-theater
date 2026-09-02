# Role-play Stage / Director capability audit

Date: 2026-08-31
Scope: current source plus accepted repository contracts; proposed role-play behavior is marked separately.

## Conclusions

1. **`perceive_or_recall` once per outer Character Turn needs no Theater lifecycle extension.** The Tool can derive a trusted `(characterId, turn)` from `ToolRunContext.agent` and the caller Character Session's open `turn/start`, then submit that pair in the Stage Op. The role-play State Machine stores the last accepted pair (or a set) and domain-rejects a duplicate. Turn numbers are restored from the latest durable `turn/start` and incremented when a new Turn opens; ordinary Tools are exclusive unless they explicitly opt into concurrency. Sources: [Tool execution carries its Agent](/Users/conflux/Documents/code/deepseek-harness/packages/core/tools/src/index.ts#L315-L338), [Agent restores and increments Turn numbers](/Users/conflux/Documents/code/deepseek-harness/packages/core/agent-loop/src/agent.ts#L88-L103), [Turn start](/Users/conflux/Documents/code/deepseek-harness/packages/core/agent-loop/src/agent.ts#L252-L266), [fail-closed exclusive Tool scheduling](/Users/conflux/Documents/code/deepseek-harness/packages/core/tools/src/index.ts#L1268-L1283).
2. **The current Theater cannot yet implement the complete agreed role-play flow with Stage as the Director's only input.** `DirectorContext` can read only Stage snapshots, but a completed Character's direct text changes no Stage. `act()` currently goes from `character.whenIdle()` directly to flush and `theater/segment-ended`; there is no projector/settlement contribution that can turn the completed Character Turn into a Stage Op. Sources: [DirectorContext](../../packages/theater/src/types.ts#L60-L66), [current settlement path](../../packages/theater/src/service.ts#L404-L446).
3. **Nested DM Turns are accepted design, not current implementation.** The ADR requires a durable LIFO nested Segment that bypasses Director and returns to the calling Tool, while current `act()` rejects starting any Segment when another is open and Tool factories receive only configured Stage handles. Sources: [ADR-0003](../adr/0003-manage-tool-triggered-nested-character-turns.md#L5-L7), [open-Segment rejection](../../packages/theater/src/service.ts#L404-L414), [Tool factory surface](../../packages/theater/src/types.ts#L17-L31).

## Q4: what Stage actually sees

The State Machine receives only its initial JSON config and candidate JSON Stage Ops. It cannot observe Context, Session, Agent, Tool, Segment stack, or Turn lifecycle; `StageService.interact()` receives the owning Session but passes only the snapshotted Op to `transition()`. Accepted Ops are then appended and flushed. Sources: [State Machine contract](../../packages/stage/src/machine.ts#L8-L29), [Stage interaction](../../packages/stage/src/service.ts#L193-L225).

Therefore the identity must be added by the trusted Tool, not discovered by Stage:

```ts
{
  type: "perception-requested",
  characterId: boundCharacterId,
  turn: openTurnNumber,
  content
}
```

`characterId` and `turn` are not model parameters. The Tool binds/derives them from its execution Agent and Session. The State Machine accepts the first `(characterId, turn)` and rejects later requests with the same key. Because each fork owns a separate Performance Stage, equal Turn numbers in divergent branches do not collide. This is smaller and more exact than resetting a boolean during recommendation or Segment settlement: it directly names the unit constrained by the rule.

The Tool should fail if it has no execution Agent or no open `turn/start`; silently inventing identity would weaken the boundary. The current Theater Tool factory does not inject `characterId`, but role-play can bind it in validated Tool config as Gomoku already binds authority in Tool config; adding generic Segment identity is unnecessary for this rule. Sources: [factory config and Stage handle](../../packages/theater/src/types.ts#L17-L35), [Character-specific Tool construction](../../packages/theater/src/service.ts#L563-L584).

The confirmed three-attempt DM repair loop does not consume three perceptions: one accepted `perception-requested` Op opens the request; the Tool may execute up to three nested DM Turns looking for `perception_result`. A valid result closes the same pending request. Three misses make the Tool throw, which must settle the outer Segment as error and stop the Main Loop. The recovery meaning of the still-pending request after such a failure remains a role-play decision (clear before throwing, or make restart/fork retry it); current generic Theater does not decide that policy.

## Q6: Director user-story coverage

The original Theater requirement is broader than “Stage only”: user story 14 says a fresh Director derives work from durable **Performance, Stage, and Character state**. The later implementation deliberately narrowed `DirectorContext` to `readStage()` for Gomoku and says to add a narrow read query when a blocking case appears. Sources: [archived user story 14](../../.issues/archive/20260824_closed_implement-performance-session-theater-and-two-character-gomoku.md#L41-L45), [Director liveness trace](../traces/implementations/2026-08-25-director-liveness-interface.md#L9-L20).

| User story | Current Theater | If Director must read only Stage |
|---|---|---|
| create / initial decision | Satisfied: Stages and Characters are created and flushed before the initial Main Loop. | Role-play Stage config must contain the initial phase. |
| manual `advance` / auto-advance | Satisfied when Stage already expresses the next action; `act` is gated, `complete` is recognized immediately. Dynamic `autoAdvance` remains process-local by design. | No additional role-play state required. Sources: [Main Loop](../../packages/theater/src/service.ts#L369-L401), [dynamic advance contract](../traces/implementations/2026-08-30-theater-dynamic-advance.md#L41-L52). |
| fork | Satisfied only at empty durable Segment stacks; Character watermarks and Stage Ops in the selected Performance prefix are forked/replayed. | Any projection-to-Stage Op must be durable before `segment-ended`, otherwise a Director Point can expose stale Stage state. Sources: [fork validation](../../packages/theater/src/service.ts#L238-L255), [stack/watermarks](../../packages/theater/src/events.ts#L55-L84). |
| cold resume | Satisfied for settled/failed Director Points, as currently tested. | Resume from a suspended outer Tool/nested call stack is not implemented; accepted ADR-0003 requires new behavior rather than relying on current resume. Source: [resume path](../../packages/theater/src/service.ts#L188-L228). |
| top-level DM / ordinary Character alternation | Not satisfied for direct Character text: no Stage Op changes phase when the Turn ends. | Needs Theater-managed settlement before `segment-ended` to project the completed Turn and interact with the role-play Stage. |
| complete | Mechanism exists: Director returns `complete`. | `end_performance` must make the Stage snapshot terminal; Director maps it to `complete`. Source: [Director decision union](../../packages/theater/src/types.ts#L48-L66). |
| whole Character Turn Projection | Defined as assistant content, Tool calls, and Tool results, excluding the incoming Instruction and execution boundaries; not implemented. | Settlement must read the just-completed Character Session interval, project it, and persist the resulting role-play Stage Op. Source: [Character Turn Projection](../../CONTEXT.md#L81-L83). |
| nested DM Turn | Accepted but absent, as above. | It bypasses Director, so Stage-only Director input does not solve it; Theater must expose nested execution to the Tool and record LIFO Segment boundaries. |
| per-Character visibility | No role-play implementation. | `voice_over` Ops can validate that every ordinary Character is covered, including empty content, and Stage can retain only pending visible content/cursors needed for future Instructions. The coverage contract is already recorded in [CONTEXT.md](../../CONTEXT.md#L49-L55). |
| recommendation reason | No role-play implementation. | Persist `reason` in the recommendation Tool call/Stage Op for observability, but exclude it from transition decisions; only selected `characterId` drives phase. |

## Smallest missing seam

For the Stage-only choice, add one Theater-managed **completed-Turn settlement contribution** executed after the Character Session is durable and before `theater/segment-ended`. It receives the trusted Character identity and the completed Character Session interval, creates the destination-specific Character Turn Projection, and submits the domain Stage Op. This uses the settlement ordering already required by user story 19 without exposing raw Sessions to Director. The separate nested-Turn executor required by ADR-0003 is still necessary.

The lower-duplication alternative is the seam already anticipated by the Director trace: keep scheduling phase/cursors in Stage and add a narrow read-only `readCharacterTurnProjection(...)` capability to `DirectorContext`. That better preserves “Character Events stay in Character Sessions,” but it does not satisfy a literal requirement that every Director input value live inside Stage. Copying the whole Projection into Stage is therefore a deliberate product choice, not a capability the current architecture already provides.
