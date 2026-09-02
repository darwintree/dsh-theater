---
# This section is managed by the CLI. Do not edit manually.
id: "72552232-1715-46cd-a374-4ae8bb98cfd0"
title: "Implement Stage-free role-play scheduling"
status: "closed"
priority: "high"
labels: ["FEATURE REQUEST", "READY-FOR-AGENT"]
created_at: "2026-09-01T09:23:00Z"
updated_at: "2026-09-01T11:04:00Z"
---
## Problem

`dsh-theater-new` 的 Theater 当前要求至少一个 Stage，Director 只能读取 Stage，Character Segment 不能嵌套，Theater-bound Tool 也不能运行另一个 Character Turn。因此它无法承载已经确认的 Role-play 调度：普通 Character 在同一 ReAct Turn 内通过 `perceive_or_recall` 请求私有 DM 裁定，Turn 结算后再由顶层 DM 把完整行动尝试裁定为按 Character 可见的事实。

旧 `agents-chat` Role-play 依赖 Stage phase、`speak_or_action`、共享 projection 流程和用户覆盖。它是行为参考，不是兼容目标。新的实现必须直接使用 Performance Session、独立 Character Sessions、durable LIFO Segments 与原生 Agent Turns，不复制旧状态机。

## Goal

实现一个无 Stage 的 Role-play Performance：

- `dm` 与普通 Characters 各自使用独立 Character Session。
- 普通 Character 的直接 assistant 文字代表说话或行动尝试。
- `perceive_or_recall` 在外层 Turn 内运行嵌套 DM Turn，并把私有结果返回原 ReAct。
- 普通 Turn 结算后，顶层 DM 读取完整自然语言 Projection，通过 `voice_over` 形成事实，并推荐下一位 Character 或结束 Performance。
- Director 的所有决定均从 durable Performance 与 Character records 重建；restart 与 fork 不依赖内存 cursor、Transcript 或 Stage。

## User Stories

1. As a preset author, I want a Performance with zero Stages, so that narrative scheduling does not require a synthetic rules state machine.
2. As a Director author, I want ordered reads of settled top-level Character Turns, so that next work can be reconstructed from durable history.
3. As a Theater Tool author, I want to run one nested Character Turn and receive its settled Turn read, so that Tool-managed adjudication remains inside Theater boundaries.
4. As an ordinary Character, I want one private `perceive_or_recall` during my Turn, so that I can use the answer and continue the same ReAct loop.
5. As DM, I want the complete ordinary Character Turn projected in natural language, so that direct text, perception requests, and their results can be adjudicated together.
6. As DM, I want `voice_over` facts partitioned by Character visibility, so that each Character later receives only what it could perceive.
7. As a Character, I want all visible facts since my previous action delivered when I next act, so that inactive Sessions need no background synchronization.
8. As a Performance operator, I want malformed DM Turns retried at most three times and then stopped visibly, so that automatic advancement cannot loop forever.
9. As a fork caller, I want nested and top-level Segment boundaries durable and strictly LIFO, so that only settled Director Points remain forkable.

## Functional Contract

### Performance composition

- Add a Role-play Theater package following the existing Theater package conventions.
- Reserve Character ID `dm` for the single DM and require at least one other Character.
- Use the existing Theater preset contribution for roster, system prompts, and Tool declarations.
- Allow `TheaterConfigured.stages` and a Performance preset's Stage contributions to be empty.
- Do not create a Role-play Stage or any equivalent hidden state object.

### Generic Theater read model

Expose this minimal read shape:

```ts
interface CharacterTurnRead {
  readonly characterId: string
  readonly outcome: 'completed' | 'aborted' | 'error'
  readonly events: readonly SessionEvent[]
}
```

Add `DirectorContext.readSettledTurns(): readonly CharacterTurnRead[]`.

- Return settled top-level Turns only, in Performance order.
- Reconstruct each exact Character Session slice from Segment order and watermarks.
- Do not persist the read model or add Turn IDs, parent IDs, depth, timestamps, read cursors, or caches.
- Nested Turns remain durable but are omitted from Director reads.

### Theater Tool runtime

Replace the Tool factory's Stage-only resolver argument with one narrow Theater runtime context that retains Stage resolution and adds only the data required here:

```ts
interface TheaterToolContext {
  readonly characterId: string
  readonly characterIds: readonly string[]
  stage(stageId: string): TheaterStageHandle
  currentTurnKind(): 'top-level' | 'nested'
  runNestedTurn(
    characterId: string,
    instruction: readonly ContentBlock[],
  ): Promise<CharacterTurnRead>
}
```

- `currentTurnKind()` must derive the caller's current top-of-stack position from the active Performance runtime.
- `runNestedTurn()` is valid only while an outer Character Segment is open.
- Theater writes and flushes nested `segment-started` before starting the target Agent Turn, settles and flushes nested `segment-ended` afterward, and returns the exact settled Turn read.
- Nested Segments use the existing flat start/end Events and strict LIFO stack. Do not add Segment IDs, parent fields, or a new Event kind.
- A nested Turn bypasses Director and creates no Director Point. After it returns, the outer Agent Turn remains open and continues ReAct.
- The target Character must be idle; recursive same-Character execution and parallel nested Turns are not required.
- Keep existing top-level `act` behavior restricted to an empty Segment stack.

### Role-play Director

At each Director Point, scan `readSettledTurns()` from durable history:

1. With no top-level Turn, act as `dm` with the sole text Instruction `开始演出。`.
2. After a completed ordinary Character Turn, act as `dm` with its complete Character Turn Projection.
3. While the current top-level DM adjudication lacks a valid terminal result, act as `dm` again with only a positive description of the validation failure. Do not repeat the ordinary Character Turn Projection already present in the DM Session.
4. Permit at most three consecutive top-level DM Turns for one adjudication. After the third invalid Turn, throw so the Theater Main Loop stops.
5. After one successful `recommend_next_character`, act as the named ordinary Character with its accumulated visible `voice_over` contents.
6. After one successful `end_performance`, return `complete`.

The Director performs an O(n) scan in the initial implementation. Add no persisted phase, pending recommendation, retry counter, Character inbox, or projection watermark.

### Top-level DM adjudication

- One adjudication contains one or more successful `voice_over` calls followed by exactly one successful `recommend_next_character` or `end_performance`.
- Successful `voice_over` calls remain facts across repair DM Turns and count toward the same adjudication.
- Repair Turns add only missing work; they do not roll back or repeat prior facts.
- A recommendation's `character` controls scheduling. Its `reason` is retained for Agent observability only and is not business input or Character Instruction content.
- A terminal Tool validates that at least one successful `voice_over` exists since the preceding successful terminal Tool. Invalid calls return `isError` and leave the DM ReAct Turn open.
- A successful terminal Tool calls `ToolRunContext.concludeTurn()`.

### Character Turn Projection

Role-play owns one pure projector over `CharacterTurnRead.events`.

- Preserve direct assistant text, Tool calls, and Tool results in original semantic order.
- Exclude the incoming Instruction, reasoning, Turn/Step boundaries, Session sequence, call IDs, and presentation metadata.
- Render direct text as:

```text
[alice尝试说话/行动]
content
```

- Render a perception call as `【alice】询问：content`.
- Render its successful result as:

```text
[alice感知/回忆结果]
content
```

- Concatenate ReAct steps without a JSON envelope, “本回合指令”, or defensive prompt text.
- The first nested DM Turn receives the outer Turn prefix through the current `perceive_or_recall` call.
- The next top-level DM Turn receives the completed ordinary Turn.

### Character-visible facts

When a recommendation selects Character `C`, build one Instruction from every successful `voice_over` segment whose `visibleTo` contains `C` and which occurred after `C`'s previous settled top-level Turn. For `C`'s first action, scan from Performance creation.

- Preserve chronological segment order and empty strings.
- Do not add wrapper text or recommendation `reason`.
- Append the Instruction only when `C` is selected; do not write background messages into inactive Character Sessions.
- If `end_performance` completes the Performance, pending visible facts remain in durable DM history and are not force-written into inactive Character Sessions.

## Tool Contract

The first version has exactly these Role-play Tools:

```ts
perceive_or_recall({ content: string }) -> { content: string }
perception_result({ content: string })
voice_over({ segments: Array<{ visibleTo: string[]; content: string }> })
recommend_next_character({ character: string; reason: string })
end_performance({})
```

### Availability and validation

| Character Turn | Accepted Role-play Tools |
| --- | --- |
| ordinary top-level | `perceive_or_recall` |
| DM top-level | `voice_over`, `recommend_next_character`, `end_performance` |
| DM nested | `perception_result` |

- Keep each Character's Tool catalog static. Validate the current Turn kind at execution time through `TheaterToolContext`.
- A wrong-mode call returns `isError` and produces no fact.
- Validate DM identity, ordinary Character IDs, recommendation target, argument types, and exact known fields at the Tool boundary.
- Every `voice_over` call must contain segments whose `visibleTo` union covers every ordinary Character. Each `visibleTo` entry must name an ordinary Character; `content` may be an empty string.
- Successful `voice_over` facts are derived from the accepted call arguments paired with a non-error Tool Result.

### `perceive_or_recall`

- Permit one call per outer ordinary Character Turn. Detect it from that open Turn's Session Events; do not store a counter.
- A second call returns `isError`, starts no nested Turn, and lets the outer Character continue ReAct.
- The first call runs nested `dm` with the current outer Turn Projection prefix.
- A successful `perception_result` returns `{ content }` as the outer Tool result and concludes the nested DM Turn.
- If a nested DM Turn ends without exactly one successful `perception_result`, run another nested DM Turn with only the validation failure, up to three total attempts.
- After three failures, cancel the outer Character Agent Turn so its Segment settles abnormally and the Theater Main Loop stops. A normal Tool throw alone is insufficient because DSH converts it into an error Tool Result and continues ReAct.

## Durable Example

The Performance Session remains a flat Event stream; indentation below shows derived nesting only:

```text
segment-started(dm)       # initial top-level DM
segment-ended(dm)
segment-started(alice)    # outer ordinary Turn
  segment-started(dm)     # nested perception Turn
  segment-ended(dm)
segment-ended(alice)
segment-started(dm)       # top-level adjudication
segment-ended(dm)
```

The corresponding histories are:

```text
Alice Session
└─ user visible voice-overs
   → assistant direct text
   → perceive_or_recall call/result
   → assistant continuation
   → turn/end

DM Session
├─ initial Turn: 开始演出 → voice_over → recommend
├─ nested Turn: outer prefix → perception_result
└─ top-level Turn: complete outer projection → voice_over → recommend/end
```

## Testing

Use public Theater and Role-play integration seams with real Session, Agent Loop, Agent Preset, Tool runtime, and mocked model responses.

- Prove a zero-Stage preset can create, run, resume, and fork a Performance.
- Prove `readSettledTurns()` returns exact top-level Character Session slices and outcomes in Performance order while omitting nested Turns.
- Prove nested Segment Events are durable and LIFO, Director is not invoked between nested start/end, and the outer Character continues after the Tool result.
- Prove the natural-language projection includes all direct text and perception call/results in order while excluding the incoming Instruction and execution-only Events.
- Prove the initial DM Turn, top-level recommendation, Character instruction delivery, next top-level DM adjudication, and `end_performance` path.
- Prove Character-specific `voice_over` visibility, multiple pending voice-overs, and empty content.
- Prove successful voice-overs survive a top-level DM repair Turn and that only failure context is sent on repair.
- Prove top-level adjudication stops after three invalid DM Turns.
- Prove one successful nested `perception_result` returns to the same outer ReAct Turn.
- Prove a second `perceive_or_recall` returns an error without opening another nested Segment.
- Prove three nested DM Turns without a valid result cancel the outer Turn and stop the Main Loop.
- Prove a fork from a settled Director Point preserves the DM/ordinary Character watermarks and re-derives pending visible facts without copied Transcript or cache state.
- Do not add tests whose purpose is to assert that legacy code was deleted; test only the new public behavior.

## Acceptance Criteria

- [x] Theater supports Performance presets with zero Stages without changing Stage behavior for Stage-backed Performances.
- [x] `CharacterTurnRead`, `DirectorContext.readSettledTurns()`, and the expanded Theater Tool runtime are public, minimal, and documented.
- [x] Nested Character Turns are durably LIFO, bypass Director, return exact settled Turn reads, and preserve the outer ReAct Turn.
- [x] A new Role-play package provides the confirmed Director and five Tool contracts.
- [x] Role-play uses no Stage, shared Transcript, persistent scheduler cursor, Character inbox, or projection cache.
- [x] Initial DM, ordinary Character, nested DM, top-level DM repair, recommendation, and completion flows match this spec.
- [x] Character Turn Projection uses the confirmed legacy-style natural-language format and complete-Turn semantics.
- [x] `voice_over` facts, Character-specific visibility, empty content, accumulated delivery, and inactive Session behavior match this spec.
- [x] Duplicate perception, three-attempt nested failure, three-attempt top-level failure, and wrong-mode Tool calls have the confirmed outcomes.
- [x] Resume and fork reconstruct Director behavior exclusively from durable Performance and Character Session records.
- [x] Public integration tests cover the success, retry, failure, visibility, resume, and fork paths listed above.
- [x] Implementation completion includes a line-by-line audit proving that every decision in [[docs/traces/discussion/2026-09-01-role-play-scheduling|the Role-play scheduling discussion trace]] is implemented or explicitly identified there as out of scope.

## Resolution

Implemented in `packages/theater` and the new `packages/theater-role-play`. The V3 preset loads the shared scene, private Character cards, opening, system guidance, and prompt headings from its package-local `preset/v3.yml`. Verification: TypeScript project build plus 51 Vitest tests, including seven Role-play integration cases for success, repair, nested/top-level failure, duplicate and wrong-mode calls, visibility, fork, and cold resume. The implementation decision and discussion audit are recorded in `docs/traces/implementations/2026-09-01-stage-free-role-play.md`.

## Out of Scope

- A Role-play Stage, State Machine, Stage Ops, shared/merged Transcript, or separate scheduling aggregate.
- `speak_or_action`, `action_result`, `d20`, generic auxiliary Tools, or user phase/Character override.
- Dynamic Tool registration by Turn kind.
- A separate Projector contribution, persistent projection, pending-fact inbox, retry record, or Director Decision Event.
- Stable Segment IDs, parent/depth fields, parallel nested Turns, or same-Character recursion.
- UI transcript rendering, user-facing recommendation controls, and scenario/character authoring UX.
- Compatibility adapters for the old `agents-chat` Role-play state or messages.

## Discussion Trace

- [[docs/traces/discussion/2026-09-01-role-play-scheduling|Role-play 调度重写讨论记录]]

## Related Architecture Records

- [[docs/adr/0003-manage-tool-triggered-nested-character-turns|ADR 0003: Manage Tool-triggered nested Character Turns in Theater]]
- [[docs/adr/0004-adjudicate-role-play-turns-through-dm-tools|ADR 0004: Adjudicate role-play Turns through DM Tools]]
- [[docs/adr/0005-run-role-play-without-a-stage|ADR 0005: Run role-play without a Stage]]
