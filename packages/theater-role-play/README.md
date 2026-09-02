# Theater Role-play

Stage-free Role-play scheduling for `@darwintree/dsh-theater`.

The default plugin registers the five Role-play Tool factories. `./director`
contributes the durable-history Director, and `./v3` loads its scene, cast,
system guidance, and prompt headings from the package-local `preset/v3.yml`.

Preview the assembled DM system prompt without starting a model or Performance:

```sh
pnpm --filter @darwintree/dsh-theater-role-play preview:system-prompt
```

Pass a Character ID to preview that Character instead:

```sh
pnpm --filter @darwintree/dsh-theater-role-play preview:system-prompt -- saber
```
