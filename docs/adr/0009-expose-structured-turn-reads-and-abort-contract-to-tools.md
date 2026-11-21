---
status: accepted
---

# Expose structured Turn reads and abort contract to Tools

Stage-free Performances continue to rely solely on durable Character Turns and Performance Segment ordering without introducing a separate persisted Fact store or synthetic protocol Stage (reaffirming ADR-0005). To keep domain Tools encapsulated from DSH internals, Theater provides Tools with a shared read-only structured view of both the current open Turn and settled top-level Turns (matching `DirectorContext`) alongside an explicit Turn-abort contract for fatal nested failures, replacing direct Tool access to `Agent`/`Session` events and `agent.cancel()`.

## Considered Options

- **Current-Turn-only Tool reads**: moves cross-turn protocol validation (such as checking prior `voice_over` calls across DM repair turns) exclusively to the Director, forcing an extra full LLM repair turn instead of immediate in-turn error feedback.
- **Separate persisted Domain Fact layer or protocol Stage**: decouples Tool schemas from domain facts but introduces a second write model that ADR-0005 explicitly avoided.
