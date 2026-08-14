# 0001: Store performance facts in a DSH Session

Status: accepted

## Decision

Each Theater performance owns one ordinary DSH `Session`. Shared orchestration and domain facts are appended as identified `user/message` entries whose message source contains a typed Theater event envelope.

Character agents keep separate DSH sessions. Their native assistant and tool messages are not copied into the shared session unless a domain deliberately publishes a semantic fact.

## Why a known message event

`SessionEventMap` is type-mergeable, but the current DSH persistence loader uses a generated set of known event names. A third-party package can append a new event name at runtime, yet a later process may refuse to load it because the name is absent from that generated set.

`user/message` is already a durable, known event. Its source vocabulary is merge-extensible, so it can carry a lossless Theater envelope without creating another persistence implementation or requiring a fork of DSH.

## Consequences

- The performance session's surface is also a human-readable shared transcript.
- Domain state is reconstructed from structured message sources, not from display text.
- A future upstream DSH event-type registration seam may allow migration to log-only custom events without changing the domain event vocabulary.
