# Theater Role-play

Stage-free Role-play scheduling for `@darwintree/dsh-theater`.

The default plugin registers the seven Role-play Tool factories. `./director`
contributes the durable-history Director, and `./v3` loads its scene, cast,
system guidance, and prompt headings from the package-local `preset/v3.yml`.
Its scene title names the Performance Session and prefixes each Character
Session title, for example `王之酒宴 · Saber`.

`preset/v3.yml` maps every Character ID, including `dm`, to its own DSH
provider, model, and optional reasoning effort. Provider routes and credentials
remain deployment settings owned by the mounted LLM adapter.

## Viewing headless runs in the GUI

When a separate headless process advances a Performance that the GUI has
already opened, restart the GUI service and reload the browser to see the
saved progress. The DSH Host prefers its attached in-memory Session when
reading history, and its follow stream listens to process-local Session
events. External writes do not update that attached Session or notify the
stream, so reloading the browser alone can return the same stale history.
Restarting releases the attached Session and allows a fresh persisted read.

This is a workaround for cross-process synchronization, not a requirement
for every new Session: list requests scan persistence, and unattached
Sessions can be read from disk. List activity timestamps track creation or
user-authored messages, so automatic Character Turns need not move a row
to the top. Stop the headless runner before reopening the saved run for
inspection. Cross-process refresh is currently deferred.

## Character visibility and prompt preview

Ordinary Character text is projected to other ordinary Characters as an
escaped `<character_message character="id">...</character_message>` element
when they are next selected. `think` and `perceive_or_recall` calls are shown
as parameter-free `<character_tool>` elements; their parameters and results
remain visible only to the source Character and DM. Successful DM `warn` calls
are broadcast to every ordinary Character as escaped `<dm_warning>` elements.

Preview the assembled DM system prompt without starting a model or Performance:

```sh
pnpm --filter @darwintree/dsh-theater-role-play preview:system-prompt
```

Pass a Character ID to preview that Character instead:

```sh
pnpm --filter @darwintree/dsh-theater-role-play preview:system-prompt -- saber
```
