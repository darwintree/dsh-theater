---
status: accepted
---

# Manage Tool-triggered nested Character Turns in Theater

Theater records a Tool-triggered Character Turn as a nested Character Segment in the Performance Session and settles Segments in LIFO order. Nested Turns bypass the Director, return their completed Turn to the calling Tool, and do not create a Director Point; this preserves an outer Character's ReAct loop while keeping the nested Character Session history, watermarks, resume state, and fork boundaries durable. Theater exposes this through a narrow Tool runtime capability that runs one nested Turn for a named Character and returns the same `{ characterId, outcome, events }` read shape used for settled top-level Turns. The Tool owns any domain-specific validation and retry policy.
