---
# This section is managed by the CLI. Do not edit manually.
id: "c6c1fe56-188c-4e0c-8f34-a3a68d42207e"
title: "Implement Stage service and Gomoku state machine"
status: "open"
priority: "high"
labels: ["READY-FOR-AGENT"]
created_at: "2026-08-18T09:29:00Z"
updated_at: "2026-08-18T09:34:00Z"
---
## Problem Statement

`dsh-theater-new` 目前只有用于验证插件接入的 greet 骨架，没有可以承载游戏状态、持久化操作或冷恢复的 Stage。Gomoku tool 如果直接持有棋盘，会把领域规则、Session 持久化和 tool 生命周期绑在一起，也无法在 Agent Session 恢复后可靠地重建棋局。

当前还没有通用的 tool-to-stageId 解析机制。因此本切片需要先提供一个可用的单 Session、单 Stage 合同，同时保持 Stage ID 独立于 Agent identity 和具体 State Machine 种类，为后续多 Stage 路由留下明确边界。

## Solution

提供一个具体的 Cordis Stage Service，作为 `ctx.stages` 暴露。Service 以 Stage ID 路由到同一个 live State Machine 对象，并负责 Session 配置、accepted Op 持久化、flush、replay、read 和 completion；State Machine 只持有 live state 与确定性的领域转换规则。

新增 Gomoku State Machine 与全局 tool。当前 tool 从调用 Agent 的 Session 推导 `${sessionId}-stage`，首次使用时懒创建或恢复对应 Stage。用户执黑、Agent 执白；Agent 先记录用户描述的黑棋，再选择并记录自己的白棋，最后自然回复用户。

## User Stories

1. As a Theater plugin developer, I want a concrete `ctx.stages` Service, so that tools can use one stable runtime boundary for durable game state.
2. As a game plugin developer, I want Stage persistence separated from game rules, so that my State Machine remains deterministic and reusable.
3. As a game plugin developer, I want to identify a live State Machine by Stage ID, so that routing does not depend on Agent identity.
4. As a tool author, I want to call `interact(stageId, op)`, so that I do not manipulate State Machine objects directly.
5. As a tool author, I want to read a Stage snapshot, so that I can render the latest game state after an accepted Op.
6. As a tool author, I want to query Stage completion, so that I can stop proposing moves after the game ends.
7. As a plugin author, I want the same live State Machine object retained for a Stage ID, so that state is not accidentally forked through object copies.
8. As an operator, I want Stage configuration persisted in the Agent Session, so that a restarted process restores the same game rules.
9. As an operator, I want accepted Ops flushed before success is reported, so that reported success has passed the durability checkpoint.
10. As an operator, I want cold replay to execute persisted Ops in order, so that restored state matches the previous live state.
11. As a maintainer, I want State Machine kind and version persisted separately from Stage ID, so that a unique instance can be restored with the compatible implementation.
12. As a maintainer, I want persisted resolved config to be authoritative, so that later plugin configuration changes do not silently rewrite an existing game.
13. As a maintainer, I want rejected requests excluded from the Stage Op log, so that the durable log contains only transitions that advanced state.
14. As an observer, I want an accepted Op to optionally retain observational outcome data, so that diagnostics can be enriched without changing replay semantics.
15. As a game plugin developer, I want domain rejection represented separately from runtime failure, so that illegal play can be corrected without being treated as a system fault.
16. As a Gomoku user, I want to describe where I placed my black stone, so that I can play through natural-language interaction.
17. As a Gomoku user, I want the Agent to record my move before choosing its white move, so that the board respects the action I requested.
18. As a Gomoku user, I want illegal coordinates, occupied cells, wrong Stone Color, and post-game moves rejected, so that the board remains valid.
19. As a Gomoku user, I want wins and draws detected, so that the game reaches a correct terminal state.
20. As a Gomoku user, I want to see the complete updated board, winner, and completion state, so that I can understand the result of each move.
21. As an Agent, I want tool results returned to the next model step, so that I can record the user move, choose my own move, and then answer accurately.
22. As an Agent, I want the Gomoku tool not to conclude the turn, so that I can continue after each tool result.
23. As a tool author, I want execution without an Agent to fail clearly, so that Stage ownership is never inferred from missing context.
24. As a plugin user, I want the default 15×15 board and five-in-a-row rule, so that Gomoku works without extra configuration.
25. As a plugin user, I want board size and win length validated when configured, so that malformed games fail before play begins.
26. As a maintainer, I want required Stage Session Event types registered for the Service lifecycle, so that Stage events remain recoverable and non-surface.
27. As a maintainer, I want the Stage and Gomoku packages independently buildable, so that Dice can later reuse Stage without coupling its rules to Gomoku.
28. As a future Dice developer, I want State Machine kind separated from Stage ID, so that another game implementation can share the Stage Service.
29. As a future routing developer, I want the temporary Session-derived Stage ID isolated in the tool, so that a general resolver can replace it later.
30. As an implementation agent, I want explicit non-goals, so that I do not add concurrency, disposal, retry, or multi-Stage machinery speculatively.

## Implementation Decisions

- Add an independent Stage package and an independent Gomoku package. Dice is not implemented in this change. If those packages are sufficient, retain the existing Theater greet scaffold unchanged.
- Stage is one concrete Cordis Service exposed as `ctx.stages`; do not split an abstract definition from a separate provider.
- A Stage ID uniquely identifies one live State Machine instance. Stage Service methods do not accept agentId.
- The current Gomoku tool derives its Stage ID as `${sessionId}-stage`. The general tool-to-stageId resolver is tracked separately.
- The live registry stores the exact State Machine object for each Stage ID. Copying the State Machine is not permitted.
- The public Stage interaction method is `interact(stageId, op)`. Stage also exposes `read(stageId)` as a detached JSON snapshot and `completed(stageId)` as a boolean.
- The global Gomoku tool lazily ensures that a Stage exists by using the Stage ID, the calling Agent Session, and Gomoku construction capability. The concrete factory interface is an implementation decision and is not part of this spec.
- A State Machine owns live state and deterministic domain rules only. It does not read Context or Session, append events, or flush persistence.
- State Machine transitions use `transition(op)`. The same canonical Op is used for live transitions and replay; there is no separate Interaction and committed Operation model.
- An accepted transition atomically advances state and may return an optional JSON observational outcome. A domain-rejected transition returns a reason without changing state. Program faults throw.
- The calling Agent Session is the authority for Stage persistence.
- Stage configuration records include Stage ID, State Machine kind, version, and resolved config. Plugin config is only initial input; persisted resolved config is authoritative after creation.
- Stage Op records include Stage ID, canonical Op, and an optional observational outcome. They do not include cause.
- Only accepted Ops are persisted. Domain-rejected requests and runtime failures do not append Stage Op events.
- Replay executes persisted Ops in Session order through the same deterministic transition and does not depend on the optional outcome.
- Before transition, the Stage Service snapshots the Op as detached JSON. After an accepted transition, it appends the Stage Op, flushes the Session, and only then returns accepted.
- A flush failure rejects `interact()`. The Service does not promise rollback of already advanced live state and does not define retry, deduplication, or idempotency.
- Required Stage Session Event types use the lifecycle-counted registration behavior from the previous Stage implementation; deepseek-harness is not modified.
- Gomoku Ops carry place-stone intent, Stone Color, and integer coordinates. Stone Color is a game value, not a DSH Character or Agent identity.
- Gomoku begins with black and enforces integer coordinates, bounds, occupancy, black/white rotation, game completion, five-in-a-row wins, draws, winner, last move, and move count.
- Gomoku defaults to a 15×15 board and win length 5, while retaining validated board-size and win-length configuration.
- The user always plays black and the Agent always plays white in this slice.
- The Gomoku tool requires `exec.agent`, derives the temporary Stage ID, ensures or restores the Stage, interacts with it, and renders the complete current board and terminal information.
- Domain rejection is a normal tool result with a reason. The Gomoku tool does not call `concludeTurn()`.

## Testing Decisions

- Good tests assert externally visible contracts: returned transition results, Session events, durability boundaries, restored snapshots, rendered tool results, and AgentLoop continuation. They must not assert private Map layout, factory shape, helper calls, or other replaceable implementation details.
- Use the pure Gomoku State Machine seam for exhaustive deterministic rule tests: initial black turn, valid rotation, integer and bounds checks, occupied cells, wrong Stone Color, terminal rejection, horizontal/vertical/diagonal wins, and draw detection.
- Use the public `ctx.stages` seam with real Session objects for Stage integration tests: first ensure, unique configuration, accepted interaction, domain rejection, runtime failure, detached read, completion, flush-before-success, event registration, and ordered replay.
- Use a cold persistence/resume seam to prove that persisted kind, version, config, and accepted Ops reconstruct the same State Machine without re-executing rejected or failed requests.
- Use the AgentLoop plus ToolRuntime seam for the highest-level Gomoku behavior: missing Agent failure, temporary Stage ID derivation, user black move, Agent white move in a later model step, full-board rendering, and natural completion without `concludeTurn()`.
- Reuse the previous Stage create/open/replay and Agent resume tests as behavioral prior art, the previous Gomoku state tests as rule prior art, and the current greet integration test as AgentLoop/MockLlm pipeline prior art.
- Do not add concurrency, disposal, or retry tests because those contracts are outside this spec.
- [x] Before closing the issue, perform a line-by-line audit of the Stage slice discussion trace and confirm that every recorded decision is implemented or explicitly excluded as recorded.

## Out of Scope

- Dice State Machine and Dice tools.
- The concrete State Machine factory interface.
- Concurrent interactions with the same Stage.
- Stage or Session disposal and live registry cleanup.
- Retry, deduplication, idempotency, or safe-retry protocols.
- A general tool-to-stageId resolver.
- Multiple Stages per Session before that resolver exists.
- Changes to deepseek-harness Session Header or persistence schemas outside registered Stage events.
- A migration path for events produced by the previous repository.

## Further Notes

- The general resolver is tracked by [[20260818_open_provide-tool-to-stageid-resolution|Provide tool-to-stageId resolution]].
- The [Stage slice discussion trace](../docs/traces/discussion/2026-08-18-stage-slice.md) is the complete record of resolved questions.
- The accepted Stage ID ADR records the durable identity and accepted-Op persistence boundary.
