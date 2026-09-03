# Theater Role-play

Stage-free Role-play scheduling for `@darwintree/dsh-theater`.

The default plugin registers the seven Role-play Tool factories. `./director`
contributes the durable-history Director, and `./v3` loads its scene, cast,
system guidance, and prompt headings from the package-local `preset/v3.yml`.
Its scene title names the Performance Session and prefixes each Character
Session title, for example `王之酒宴 · Saber`.

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
