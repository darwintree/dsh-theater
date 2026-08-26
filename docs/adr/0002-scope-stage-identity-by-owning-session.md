---
status: accepted
---

# Scope Stage identity by owning Session

A Stage is identified by `(owning Session, Stage ID)`, so separate Performance or Character Sessions may use the same Stage ID without colliding in live routing. `stage/configured` and accepted `stage/op` events are always written to that owning Session—even when another Session's Character invokes the Tool—while ADR 0001's accepted-only canonical Op durability rule remains unchanged.
