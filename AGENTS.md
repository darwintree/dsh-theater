# Repository guidance

This repository is a DSH-native rewrite of Agent Theater.

## Architectural rules

- `packages/theater` owns generic orchestration and never imports a domain package.
- Domain packages depend on `@darwintree/dsh-theater`, never the reverse.
- DSH `Session` is the only durable log primitive. Do not introduce a parallel persistence layer.
- Shared performance facts are stored as identified `user/message` entries in a dedicated performance session, using the typed `theater` message source.
- Character model history remains in each character's own DSH agent session.
- Domain state is a pure fold over committed performance facts.
- Side-effecting tools commit and flush the performance fact before reporting success to the calling agent.
- Do not depend on `pi-ai` or `pi-agent-core`.

## First milestone

The initial milestone contains the Theater scenario registry, session-backed performance facts, and a Gomoku domain package. Agent creation, turn delivery, resume orchestration, and nested calls are subsequent milestones.
