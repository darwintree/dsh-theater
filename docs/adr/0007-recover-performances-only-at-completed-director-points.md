---
status: accepted
---

# Recover Performances only at completed Director Points

Only a top-level Character Turn settled with `outcome: 'completed'` produces a new `Director Point` and forkable position. Any non-completed top-level Turn (`aborted` or `error`) halts the Theater Main Loop into a durable failed state rather than invoking the Director, and `resume` refuses to silently re-enter `active` across either an unclosed Segment (top-level or nested, refining ADR-0003) or a failed Turn. Recovery from process crashes or runtime Turn failures always proceeds by forking from the last valid `Director Point`, which preserves the failed record for inspection while cleanly rolling back partial Character Turns and Stage Ops.

## Considered Options

- **In-place retry or auto-closing interrupted Segments**: leaves partial Stage Ops or half-finished ReAct side effects on the same timeline and risks infinite retry loops on infrastructure errors.
- **Durable continuation for nested Turns**: requires serializing suspended Tool execution frames across restarts, adding disproportionate runtime complexity to Theater.
