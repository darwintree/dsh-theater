---
status: accepted
---

# Treat persisted Performance configuration as authoritative

A Performance's durable `theater/configured` record captures its Characters (`systemPrompt`, `model`, resolved Tool configurations) and declared Stages at creation time and serves as the authoritative configuration across `resume` and `fork`, matching `Stage`'s persisted-config model. On `resume` and `fork`, Theater checks only structural compatibility (Character IDs, declared Stage IDs with State Machine kind/version, and availability of required Tool and State Machine factories) rather than byte-for-byte equality with the current preset. Runtime advancement pacing and the plugged-in `Director` are excluded from durable identity, so a Performance may replace its `Director` across `create`, `resume`, and `fork` (for example, switching between automatic and human-driven control), while `fork` inherits the source's persisted configuration snapshot verbatim.

## Considered Options

- **Structural compatibility with live preset override**: lets prompt or model edits silently mutate resumed Performances, weakening historical continuity across resume and fork.
- **Strict byte-for-byte preset equality**: breaks existing Performances whenever prompt wording, model choice, or runtime defaults change, while still failing to lock non-serializable Director logic.
