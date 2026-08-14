# dsh-theater

A DSH-native, session-backed rewrite of Agent Theater.

The repository is a pnpm monorepo with a strict dependency boundary:

```text
@darwintree/dsh-theater-gomoku
              ↓
@darwintree/dsh-theater
              ↓
DSH Session / Agent / Tool / LLM services
```

## Packages

| Package | Responsibility |
|---|---|
| `@darwintree/dsh-theater` | Scenario registry, performance-session ownership, and typed shared facts |
| `@darwintree/dsh-theater-gomoku` | Gomoku rules, state fold, turn prompt, and `place_stone` tool |

## Persistence model

A performance uses one ordinary DSH session as its shared source of truth. Every character still has its own DSH agent session for the exact messages and tool protocol seen by that model.

```text
Performance Session
  └─ configured fact, Gomoku moves, later orchestration facts

Black Agent Session
  └─ black model history and black tool call/result pairs

White Agent Session
  └─ white model history and white tool call/result pairs
```

The first implementation stores shared facts as known `user/message` session events with a structured `source.kind === "theater"`. This keeps an out-of-repository plugin compatible with current DSH persistence, whose loader does not yet have a runtime registry for third-party `SessionEventMap` event names.

## Current scope

Implemented in this bootstrap:

- a Cordis `ctx.theater` service;
- scenario registration and lookup;
- creation/opening of a dedicated performance session;
- a merge-extensible `TheaterEventMap` carried by identified DSH messages;
- Gomoku configuration, immutable state transition, replay fold, board rendering, and turn recommendation;
- a DSH-native `place_stone` tool factory with commit-before-success ordering and call-id idempotency;
- unit tests and CI scaffolding.

Deliberately deferred:

- creating and resuming character agents;
- durable turn outbox and exact turn settlement;
- nested character invocation;
- generic tool-message projection;
- UI and transport adapters.

## Development

```bash
corepack enable
pnpm install
pnpm check
```

The workspace currently pins the DSH release-candidate versions used by `deepseek-ai/deepseek-harness`. Update the pins together while that API remains pre-release.

## License

AGPL-3.0-only.
