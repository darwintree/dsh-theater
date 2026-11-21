---
name: stage-op-design
description: Design and review Stage Ops for dsh-stage State Machines. Use when defining new Stage Op schemas, implementing or reviewing StateMachine.transition(op), deciding domain-rejected vs throw boundaries, or evolving Op versions.
---

Rules for designing and reviewing **Stage Ops** in `dsh-stage`. Grounded in the terminology in `CONTEXT.md` and the durability contract in `docs/adr/0002-scope-stage-identity-by-owning-session.md`.

## Canonical model (`Live = Replay`)

One canonical Stage Op drives both live `transition(op)` and cold/fork replay. Do not split a request command model from a committed event model.

- Model `transition(op)` as semantically pure: `(current state, Stage Op) -> (next state, result)`. It observes only resolved initial `config`, live state, and the incoming `op`—never Context, Session, Agent, wall clock, or ambient RNG.
- Represent only state-advancing domain transitions as Ops. Queries that observe state without mutating it belong on `read()`, never as no-op Stage Ops.
- Keep every Op lossless JSON (must survive `snapshotJsonValue` without loss—no `undefined`, `NaN`, `Infinity`, `Date`, `Map`, `Set`, or class instances).

## Determinism for randomness and time

Never read `Math.random()`, `crypto.random*`, or `Date.now()` inside `transition(op)`. When a domain requires randomness or time, choose one of two replay-equivalent patterns:

1. **Externalized value in the Op** (default): resolve the nondeterministic value before `interact()` and carry the realized fact as an explicit Op field (e.g. `{ type: 'roll-resolved', dice: [3, 5] }`, `{ type: 'tick', timestampMs: ... }`). Keeps the State Machine free of PRNG state and makes every persisted Op self-contained.
2. **Seeded PRNG in `config`**: persist an explicit seed in resolved Stage `config` and advance a deterministic PRNG inside live state so the Op stays a pure intent (e.g. `{ type: 'roll' }`). Choose this when the caller must not know or influence the draw ahead of time.

## Domain-only payload and granularity

A Stage Op names a domain action and domain values—nothing else.

- **Carry domain values only**: represent roles with domain concepts (e.g. `color: 'black'`, `seat`, `faction`), keeping DSH Agent/Character/Session IDs, Tool names, `cause` metadata, UI copy, and derived post-state snapshots out of the Op.
- **Explicit discriminated union**: give every Op a literal discriminant tag (prefer `type`, e.g. `{ type: 'place-stone', color, x, y }`) with flat, self-describing JSON fields.
- **Atomic transition granularity**: size one Op to one indivisible invariant-preserving transition. Avoid bundling multiple independently validated actions into one composite Op, and avoid splitting a single rule-bound transition into partial Ops that leave invalid intermediate state.

## Outcome boundary (`accepted` vs `domain-rejected` vs `throw`)

Separate domain rules from contract faults strictly:

| Condition | Result | State & persistence |
|---|---|---|
| Valid Op schema and legal in current state | `{ kind: 'accepted', outcome? }` | Atomically advances live state; persisted as `stage/op` and flushed before returning |
| Valid Op schema, illegal under current domain rules (wrong turn, occupied cell, out of bounds, already `completed`) | `{ kind: 'domain-rejected', reason }` | Live state unchanged; not persisted; `reason` explains the violated rule |
| Contract fault: non-object input, unknown Op tag, missing required field, wrong field type, or non-JSON value | `throw` | Live state unchanged; not persisted |

Never downgrade schema/contract faults into `domain-rejected`: a malformed Op indicates a broken caller or corrupted replay log and must fail loudly.

## Observational `outcome` discipline

`outcome` on an `accepted` result is optional, detached lossless JSON for immediate observability (e.g. rolled faces from a seeded PRNG, damage delta, or triggered effect summary).

- Replay executes `transition(op)` from `op` alone and ignores `outcome`.
- Store every fact required by subsequent transitions or `read()` inside State Machine state, never exclusively in `outcome`.
- Omit `outcome` when `read()` already gives callers everything they need.

## Schema evolution and versioning

`StageService` enforces exact `(machine, version)` matching when replaying persisted Stages.

- **Same `version`** (backward-compatible only): you may add a new Op variant or an optional field whose absence preserves identical replay behavior for all historical Ops.
- **Bump `version`** (breaking): required whenever you rename/remove an Op tag, change field types or semantics, tighten validation so previously accepted Ops could reject on replay, or alter state transition outcomes for existing Ops.

## Verification checklist

Before finalizing a Stage Op design or `transition(op)` review, confirm every Op variant passes all checks:

1. **Replay equivalence**: replaying resolved `config` + accepted Ops alone reproduces identical live state and `completed`, without reading `outcome` or external sources.
2. **Lossless JSON**: both `op` and optional `outcome` are plain lossless JSON with an explicit discriminant tag.
3. **Domain purity**: no DSH identities, Tool names, `cause`, UI strings, or redundant derived snapshots appear in the Op.
4. **Atomicity**: each Op leaves the machine in a valid state on `accepted`, and untouched on `domain-rejected` or `throw`.
5. **Strict fault split**: schema/type/unknown-tag errors `throw`; only valid-schema rule violations return `domain-rejected`.
6. **Version safety**: existing persisted Ops replay identically under the current `version`, or `version` has been bumped.
