# Domain docs

This repository uses a single-context domain-document layout.

## Before exploring

Read these when they exist:

- `CONTEXT.md` at the repository root.
- Relevant accepted records under `docs/adr/`.

If either is absent, proceed silently. Create domain documentation only when real terminology or decisions need recording.

## Layout

- `CONTEXT.md` defines the domain glossary and model.
- `docs/adr/` contains accepted architectural decisions.

Use the vocabulary defined in `CONTEXT.md`. If work contradicts an accepted ADR, surface the conflict explicitly instead of silently overriding it.
