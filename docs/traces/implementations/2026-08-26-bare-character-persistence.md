# Implementation Trace: Bare Character persistence

Date: 2026-08-26
Source: 2026-08-26 Performance preset implementation discussion
Language: Chinese

## Entries

### 1. Persist an otherwise empty Character Session

Type: unresolved-implementation-decision

Context:
The agreed design removes Character Agent Presets. DSH persistence does not
store a Session that has no events, so a Character that has not acted cannot be
cold-resumed and its fork lineage is not durable. The design did not specify a
replacement persistence marker.

Decision:
Write one `theater/character-configured` event containing only `characterId` in
every Character Session. A fork reuses a seeded marker when
present or writes a new marker when forking from a zero watermark. Resume
requires the marker.

Reason:
This is the smallest durable Theater-owned fact that makes bare Character
Sessions persist without reintroducing Agent Presets or duplicating Tool plans,
which remain authoritative in the Performance Session's `theater/configured`.

Follow-up:
None.
