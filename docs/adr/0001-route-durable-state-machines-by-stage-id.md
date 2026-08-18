---
status: accepted
---

# Route durable State Machines by Stage ID

`ctx.stages` routes interactions to a pure live State Machine by its unique Stage ID while the Service owns Session persistence, replay, reads, and completion. Stage IDs are independent of State Machine kind and Agent identity; the current Gomoku tool derives `${sessionId}-stage` until a general resolver is implemented, and only accepted canonical Ops are durable while optional outcomes remain observational. The resolved contracts and deliberate omissions are recorded in the [Stage slice discussion trace](../traces/discussion/2026-08-18-stage-slice.md).
