# Issue tracker: dot-issues

Issues and specs for this repository live as Markdown files under `.issues/` and are managed with the installed `dot-issues` skill.

Do not create a parallel `.scratch/` tracker.

## Rules

- Run the bundled CLI with its explicit skill path:
  `bun {dot-issues-skill-path}/scripts/index.ts <command>`.
- Treat each issue's `id` as its stable identifier.
- Let the CLI manage YAML front matter.
- Edit an issue body directly only when metadata is unchanged, then run `touch`.
- Prefer Obsidian wiki links between issue documents.

## Workflow

Before creating an issue:

1. Run `labels sync`.
2. Run `list` or `search --query "<text>"` to avoid duplicates.
3. Use existing registry labels when possible.

Create an issue with `new`. Use `--allow-new-label` only when a required label is missing.

Read an issue with `show --id <uuid>`.

Change status, priority, title, or labels with `modify-metadata`.

After editing only the Markdown body, run `touch --id <uuid>`.

When an issue is fully resolved, record the resolution in its body and run `archive --id <uuid>`.

When another skill says “publish to the issue tracker,” create a `dot-issues` entry under `.issues/`. When it says “fetch the relevant ticket,” locate it with `show`, `list`, or `search`.
