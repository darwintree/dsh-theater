---
# This section is managed by the CLI. Do not edit manually.
id: "fcdf7978-b950-4bd7-8908-4f8c0d5a1e36"
title: "Implement Performance Session Theater and two-Character Gomoku"
status: "open"
labels: ["READY-FOR-AGENT"]
created_at: "2026-08-24T14:35:00Z"
updated_at: "2026-08-24T14:41:00Z"
---
## Problem Statement

The rewrite repository currently contains a durable Stage service, the Gomoku State Machine, and a Single-Agent Gomoku demo, but it does not yet contain the Theater abstraction required to run a Performance with multiple independent Character Sessions. The earlier agents-chat loop is too specialized, while the completed dsh-theater demo includes aggregation, Projection, Definition, and reaction machinery that no longer matches the agreed product model.

The missing abstraction must make Performance-level fork a first-class durable operation. It must preserve the relevant prefix of every Character Session and every Performance-owned Stage without exposing independent Character forks, reconstructing a workflow call stack, copying Character Events into a shared transcript, or depending on a pinned runtime composition.

## Solution

Add a minimal Theater composition layer whose public durable root is a Performance Session. A Theater-capable Agent Preset contributes the Director, fixed Character roster, Character Agent Preset assignments, and Stage assembly. The Performance Session is not driven by an Agent Loop; an automatically driven Director examines durable state whenever Character Agent Loops are idle and decides the next action.

Character actions execute in separate Character Sessions and are bracketed by durable Character Segments in the Performance Session. Empty Segment-stack positions are Director Points and are the only legal Performance fork positions. Each completed Segment records the Character Session watermark needed to derive all Character Sessions together when the Performance is forked.

Demonstrate the abstraction with a Two-Character Gomoku Performance. The black and white Characters alternate automatically against one shared Performance-owned Gomoku Stage, using a read-only board Tool and color-bound placement Tools. Keep Single-Agent Gomoku as a direct Stage demo rather than a Theater Performance.

## User Stories

1. As a Performance creator, I want to start a Performance from a Theater-capable preset, so that its complete static composition is selected by one preset ID.
2. As a Performance creator, I want the Performance Session to be the public durable root, so that I have one stable entry point for reading, resuming, and forking a branch.
3. As a Performance creator, I want the Performance Session to remain a normal DSH Session without an Agent Loop, so that orchestration is not forced through an Agent conversation model.
4. As a deployment operator, I want a Theater-capable preset to declare its Theater dependency explicitly, so that an unsupported deployment reports the preset as broken or unavailable instead of silently degrading it.
5. As a preset author, I want one Theater assembly contribution in the standing preset scope, so that the Director, Characters, Agent Presets, and Stages are assembled through existing DSH preset composition.
6. As a preset author, I want preset mounting to remain free of per-Performance state, so that standing plugin instances can be shared safely across Performances.
7. As a Theater integrator, I want a fixed Character roster at Performance creation, so that Character identity and durable Session layout cannot drift during a branch.
8. As a Theater integrator, I want each Character's actual Agent Preset assignment fixed with the roster, so that resume and fork preserve the same Character capabilities.
9. As a Character observer, I want each Character to have its own Character Session, so that its model-visible history can be read without a synthetic shared transcript.
10. As a Character observer, I want Character Session IDs derived deterministically from Performance Session ID and Character ID, so that Theater does not need a separate durable ID mapping.
11. As a Character operator, I do not want independent Character Session fork or preset-switch operations, so that a Character cannot diverge from the Performance branch that gives its history meaning.
12. As a Director author, I want the Director to run automatically while the Performance can advance, so that no external main loop is required to alternate Characters.
13. As a Director author, I want the Director contract to describe what happens when Character Agent Loops are idle rather than claim exclusive scheduling authority, so that later Character-to-Character invocation remains conceptually possible.
14. As a Director author, I want to derive the next action from durable Performance, Stage, and Character state, so that restart and fork do not depend on retained local execution state.
15. As a Director author, I want Director-local work after a fork point to be recomputable, so that a fork can resume cleanly even when a small amount of work is repeated.
16. As a Theater integrator, I want a durable Character Segment boundary around every Character Agent Loop invocation, so that Character activity has an unambiguous settlement boundary.
17. As a Theater integrator, I want a Segment start persisted and flushed before the Character receives its Instruction, so that Character history never advances outside a durable open Segment.
18. As a Theater integrator, I want Segment starts and ends validated in strict LIFO Character order, so that the durable Segment stack cannot become ambiguous.
19. As a Theater integrator, I want a Segment end written only after Character work, relevant Stage writes, and Theater-managed settlement are flushed, so that an empty Segment stack is a safe fork boundary.
20. As a Performance observer, I want abnormal Character completion to produce a durable Segment end, so that the resulting Director Point remains inspectable and forkable.
21. As a Performance operator, I want an aborted or failed Segment to stop and propagate the current Director invocation error, so that failures are visible rather than silently advanced.
22. As a Performance operator, I want restart or fork to retry from the durable Director Point after a failed Segment, so that recovery does not require restoring a call stack.
23. As a Director author, I want a normally completed Character action that made no legal move reconsidered without an artificial retry counter, so that domain state alone continues to determine whose action is next.
24. As a fork caller, I want to identify a candidate Performance prefix with an exclusive Performance Session sequence, so that the fork request has a stable cursor.
25. As a fork caller, I want Theater to reject cursors whose durable Character Segment stack is not empty, so that forks cannot expose partially settled Character work.
26. As a fork caller, I want the initial fully flushed Performance state to be a Director Point, so that I can fork before the first Character acts.
27. As a fork caller, I want each Segment end to preserve the acting Character's exclusive Session watermark, so that Character histories can be truncated consistently with the selected Performance prefix.
28. As a fork caller, I want Characters that have not acted at the selected point to fork from watermark zero, so that initial Character Sessions are derived correctly.
29. As a fork caller, I want all Character Sessions derived together with the Performance fork, so that a branch is internally consistent.
30. As a fork caller, I want work after the selected Director Point excluded from the new branch, so that the fork can make a different durable continuation.
31. As a Performance observer, I want Character Events to remain only in their Character Sessions, so that the Performance Session does not duplicate transcripts.
32. As a Performance observer, I want Performance reads to expose Stage state, runtime status, and forkable positions, so that the public surface reflects Theater concerns rather than merged conversation content.
33. As a Character, I want my action Instruction persisted only in my Character Session, so that the Performance Session does not copy opaque model input.
34. As a Character, I do not want Stage Ops projected into my context, so that durable Stage internals remain opaque.
35. As a Stage integrator, I want Stage identity scoped by owning Session and Stage ID, so that separate Sessions may safely use the same Stage ID.
36. As a Stage integrator, I want Stage configuration and accepted Stage Ops written to the owning Session, so that Stage replay follows its durable owner regardless of which Character invoked the Tool.
37. As a Character author, I want to register a Character-owned Stage through the existing Stage API, so that Theater does not need a speculative declaration layer.
38. As a Two-Character Gomoku observer, I want black and white to use distinct Character Sessions and one shared Gomoku Stage, so that each model has independent history while the board remains authoritative.
39. As the black Character, I want my placement Tool bound to black, so that I submit only coordinates and cannot claim white authority.
40. As the white Character, I want my placement Tool bound to white, so that I submit only coordinates and cannot claim black authority.
41. As a Gomoku Character, I want a read-only board Tool that returns the authoritative full board, so that I can choose a move without Projection.
42. As a Gomoku Character, I want the board Tool call and result recorded in my Character Session without producing a Stage Op, so that reads remain observable but do not mutate the game.
43. As a Gomoku Character, I want a legal placement to conclude my current Agent turn, so that the Director can dispatch the next color immediately.
44. As a Gomoku Character, I want an illegal placement to return a normal rejection without concluding my turn, so that I can retry within the same action.
45. As a Gomoku Director, I want to read the Stage's current player to select black or white, so that turn order is derived from the board rather than duplicated state.
46. As a Gomoku Director, I want to stop normally when the Stage is terminal, so that the Stage remains the only source of win, draw, and completion truth.
47. As a Gomoku observer, I want the Director's Instruction to provide the previous action, bound color, and requirement to read the board before moving, so that each Character receives the minimal context needed to act.
48. As a maintainer, I want the existing Gomoku State Machine reused unchanged, so that Theater orchestration does not duplicate game rules.
49. As a maintainer, I want Single-Agent Gomoku retained as a direct Stage demo, so that the simple mode remains available without pretending it is a Theater Performance.
50. As a maintainer, I want cold resume and fork to load the current preset generation, so that compatible Director or prompt updates can take effect without snapshot machinery.
51. As a maintainer, I want incompatible current composition rejected before driving a historical Performance, so that changed rosters, Character Agent Presets, or Stage configuration cannot corrupt durable history.
52. As a maintainer, I want historical Performance data to remain readable when current composition is incompatible, so that an unavailable runtime does not erase observability.
53. As a maintainer, I want only non-parallel Tool Calls guaranteed in the current implementation, so that the first Theater version does not invent a broader concurrency model.
54. As a tester, I want Theater behavior exercised through its public service with real DSH composition and mocked model responses, so that tests validate durable product behavior rather than internal helper calls.

## Implementation Decisions

- Theater is a composition layer. It assembles a Performance, Director, Characters, Sessions, and Stages and owns their durable orchestration boundaries; it does not own domain scheduling algorithms or game rules.
- A Performance Session is an ordinary DSH Session and the public durable root of one Performance branch. It does not bind an Agent Loop and does not write the Agent-specific preset field in its Session header.
- Performance creation records the selected preset ID, fixed Character roster, actual Character Agent Preset assignments, and Stage configuration in Theater-owned durable configuration data.
- Theater uses the existing Agent Presets roster, discovery, preset ID, and standing Cordis composition. It does not introduce a Theater Definition, Definition provider, registry, preset kind, or parallel preset product surface.
- A Theater plugin mounted by a preset registers exactly one stateless Theater assembly contribution in that preset's standing scope. Creating or mounting the preset does not create a Performance.
- Theater resolves a preset ID, loads its standing scope, and requires exactly one Theater assembly contribution when creating, resuming, or forking a Performance.
- Theater-capable presets may depend explicitly on Theater. If Theater is missing, the entire preset is broken or unavailable under existing Agent Preset health semantics; there is no ordinary-Agent fallback.
- Standing preset plugin instances contain no per-Performance state. Runtime state belongs only to Performance Sessions, Character Sessions, and Stages.
- There are no per-Performance runtime arguments in this version. Static assembly inputs come from preset rows.
- Preset composition is neither snapshotted nor pinned. Cold resume and fork use the current preset generation.
- Before driving a historical Performance, the current contribution must be compatible with the durable Character roster, Character Agent Preset assignments, and Stage configuration. Incompatibility rejects driving but does not prevent historical reads.
- Character roster and Character Agent Preset assignments are fixed at Performance creation. Character Sessions persist their actual Agent Preset through the existing Agent mechanism and may not switch independently.
- Character Session IDs are deterministically derived from Performance Session ID and Character ID; no durable Character-to-Session mapping is added.
- Performance is the only public fork boundary. Character Sessions have no independent Theater fork operation.
- The Director is an automatically driven, long-lived control routine that determines the next step when Character Agent Loops are idle. Its general structure and algorithm remain domain-owned rather than part of the Theater contract.
- Director restart and fork use state re-entry. A fresh invocation reconstructs its next action from durable Performance, Stage, and Character state; Workflow Replay and call-stack restoration are not used.
- A Director Point is any Performance Session prefix whose durable Character Segment stack is empty. The initial Point is established only after the Performance Session, Character Sessions, and configured Stages are created and flushed.
- A fork cursor is an exclusive Performance Session sequence. Theater validates that the selected prefix is a Director Point before deriving the branch.
- Character Segments are internal durable orchestration boundaries, not public resources. They have no stable Segment ID.
- Segment events pair through strict LIFO order plus Character validation. The Segment stack is reconstructed from Performance Session events.
- Theater appends and flushes theater/segment-started before writing the Instruction to the Character Session or starting its Agent Loop.
- Theater appends and flushes theater/segment-ended only after the Character Session, relevant owning Stage Sessions, and all Theater-managed postprocessing are durable. There is no separate end-reaction phase after this event.
- Every Segment end records the acting Character and the exclusive characterSessionSeq observed after the Character Session flush.
- To fork, Theater scans the selected Performance prefix and takes each Character's latest recorded watermark; a Character with no completed Segment uses zero. It then derives all Character Sessions together with the Performance branch.
- A failed or aborted Character invocation still settles and flushes its Segment end, creating a forkable Director Point. The current Director invocation then stops and propagates the error; restart or fork may retry from the Point.
- A normally completed Segment that produces no accepted domain action returns to Director decision. Gomoku therefore dispatches the same Character again while the board's current player remains unchanged; no retry counter or failure state is added.
- Performance Session does not copy Character Events or Character Instructions and does not expose a merged transcript. Character history is read from each Character Session.
- Instruction is opaque Theater input persisted only to its target Character Session. Projection is absent from the current design.
- Performance's product read surface consists of Stage state, runtime status, forkable Director Points, and references to separately readable Character Sessions.
- Stage identity is the pair of owning Session and Stage ID. StageService live routing must be Session-scoped rather than globally keyed by Stage ID.
- stage/configured and stage/op are always appended to the owning Session. A Character Tool may operate a Performance-owned Stage, but the accepted Stage Op remains in the Performance Session.
- Character-owned Stages use the existing Stage API with the Character Session as owner. No Theater-specific Stage declaration layer is added.
- Stage Ops are opaque to Characters and do not participate in Projection.
- The existing Gomoku State Machine and its deterministic move, turn, win, draw, rejection, and replay behavior remain the domain authority.
- Single-Agent Gomoku remains a direct Stage demo and is not implemented as a Theater Performance.
- Two-Character Gomoku uses Character IDs black and white, two Character Sessions, and one Performance-owned Gomoku Stage.
- Gomoku's Director reads the current board state to decide which color acts next and stops normally when the Stage is complete. No separate Performance completion state is persisted.
- Gomoku Instructions contain the previous action, the acting Character's bound color, and a requirement to read the board before placing a stone. Theater does not enforce Tool invocation order.
- read_board returns the authoritative complete board. Its Tool call and result are recorded in the calling Character Session, but the read produces no Stage Op.
- Each Character receives a color-bound place_stone(x, y) Tool. The model does not submit color.
- An accepted placement uses native ToolRunContext.concludeTurn() to finish the Character action. A domain-rejected placement does not conclude the turn and permits retry.
- Current execution must not run Tool Calls in parallel. No broader Character, Performance branch, or scheduling concurrency contract is introduced.
- The accepted Stage routing ADR must be superseded because global Stage-ID live routing conflicts with the new Session-scoped Stage identity. The replacement retains the existing rule that only accepted canonical Stage Ops are durable.

## Testing Decisions

- Use one primary public integration seam: the Theater Service running in a Cordis context with real SessionStore, AgentLoop, AgentPresets, StageService, and mocked LLM responses. Do not add a test-only Theater interface.
- Exercise multiple externally visible scenarios through that seam: Performance creation from a preset, automatic black/white rotation, Instruction persistence, Character Segment durability, legal and illegal Tool behavior, terminal completion, and separate Character histories.
- Exercise fork through the same seam at the initial Director Point and at later settled Points. Assert that the Performance prefix, Stage state, Character Session watermarks, lineage, and subsequent divergent continuation all match the selected cursor.
- Exercise invalid fork attempts at an open Segment prefix and verify rejection before any child branch is created.
- Exercise abnormal Segment completion and verify that the Segment is durably ended, the Point is forkable, the current Director invocation fails, and a restart or fork can re-enter from durable state.
- Exercise a normally completed no-move action and verify that Director dispatches the same color again without a retry counter.
- Exercise cold resume with a compatible current preset generation and rejection with an incompatible roster, Character Agent Preset assignment, or Stage configuration while preserving historical reads.
- Exercise two Sessions using the same Stage ID so the test fails if live Stage routing remains globally keyed only by Stage ID.
- Assert only external durable behavior: Session events and ownership, flushed boundaries, Stage snapshots, public runtime status, public forkable positions, Character Session histories, Tool results, and Director outcomes. Do not assert private helper calls or internal object layout.
- Retain the existing Gomoku State Machine rule tests and Stage Service transition/replay tests. Add focused cases there only where Session-scoped Stage identity changes an existing public Stage contract.
- Prior art is the current mock-LLM Gomoku Agent integration test, current Stage Service persistence/replay tests, DSH SessionStore fork tests, and DSH Agent Presets standing-mount tests. The completed dsh-theater public integration tests are behavioral reference only; their copied Character Events, Projection, Definition registry, stable Segment IDs, and end-reaction phase must not be reproduced.

## Acceptance Criteria

- [ ] A Theater-capable preset supplies exactly one stateless Theater assembly contribution through existing Agent Preset composition.
- [ ] A Performance can be created, automatically driven, cold-resumed, and forked through the public Theater Service.
- [ ] Performance Session, fixed Character Sessions, Character Agent Preset assignments, and configured Stages are durable and reconstructable.
- [ ] Character Segment start/end ordering and flush boundaries make every advertised Director Point safe to fork.
- [ ] Performance fork derives all Character Sessions at their recorded exclusive watermarks and rejects non-Director-Point cursors.
- [ ] Stage routing is Session-scoped and accepted Stage Ops are persisted only in the owning Session.
- [ ] Two-Character Gomoku alternates black and white automatically, supports board reads and color-bound legal/illegal placements, and stops from Stage terminal state.
- [ ] Single-Agent Gomoku remains a non-Theater direct Stage demo.
- [ ] Compatible current preset generations resume historical Performances; incompatible composition refuses driving without preventing historical reads.
- [ ] The accepted global-Stage-ID routing ADR is superseded by the Session-scoped Stage identity decision.
- [ ] The confirmed public integration seam covers create, drive, failure, resume, fork, and Stage ownership behavior without a new test-only abstraction.
- [ ] Implementation completion includes a line-by-line audit proving that every decision in the linked 2026-08-24 Performance Session and Director discussion trace is implemented or explicitly identified as out of scope by that trace.

## Out of Scope

- Projection of any kind, including ownership, sources, watermarks, persistence, or Stage-Op projection.
- A shared or merged Performance transcript.
- User input, waiting-for-user protocols, or interactive Director UX for Two-Character Gomoku.
- Independent Character Session fork, independent Character Agent Preset switching, or Character Session public lifecycle operations.
- Character-to-Character invocation in the current implementation, although the Director contract must not make it conceptually impossible.
- Parallel Tool Calls and any broader concurrent Character, Director, or Performance branch execution model.
- Workflow Replay, durable call-stack restoration, or resuming a suspended Director invocation.
- Stable Character Segment IDs, public Segment resources, or a separate Segment end-reaction phase.
- A Theater Definition, Definition provider, registry, preset kind, composition snapshot, pinned preset generation, or per-Performance runtime arguments.
- Runtime roster mutation, Character addition/removal, or Character-owned Stage declaration abstractions.
- Enforcing that read_board was called before place_stone.
- A separate Performance completion event when the Stage already represents terminal state.
- A fallback that lets a Theater-capable preset run as an ordinary Agent preset without Theater support.
- Generalizing the existing Agent Preset header, event, picker, API, or documentation semantics to Performance Sessions.

## Further Notes

- Product and architecture decisions are authoritative in [[docs/traces/discussion/2026-08-24-performance-session-director|Performance Session 与 Director 讨论记录]].
- The repository is the rewrite branch; the sibling completed demo is a reference implementation, not a compatibility target.
- [[docs/adr/0001-route-durable-state-machines-by-stage-id|ADR 0001]] conflicts with Session-scoped Stage identity and must be superseded as part of this change.
