# TickUntilStop Workflow

Resume-safe loop that dispatches by current manifest stage until progress stops.

## Inputs

- `manifest` absolute path
- `gates` absolute path (optional override; defaults to manifest-derived `state/gates.json`)
- `driver`: `fixture | task | live`
- `reason`

## Dispatch Contract

- `init|wave1` -> task/live tick path for `--driver task|live`, fixture tick for `--driver fixture`
- `pivot|citations` -> post-pivot orchestration path
- `summaries|synthesis|review` -> post-summaries orchestration path

## CLI command forms (copy/paste)

```bash
# Repo checkout (this repository)
bun ".opencode/pai-tools/deep-research-cli.ts" <command> [flags]
```

```bash
# Runtime install (~/.config/opencode)
cd "$HOME/.config/opencode"
bun "pai-tools/deep-research-cli.ts" <command> [flags]
```

## Steps

1. Loop one tick at a time:

```bash
bun ".opencode/pai-tools/deep-research-cli.ts" tick --manifest "<manifest_abs>" --reason "loop tick" --driver task --json

# Runtime install (~/.config/opencode)
cd "$HOME/.config/opencode"
bun "pai-tools/deep-research-cli.ts" tick --manifest "<manifest_abs>" --reason "loop tick" --driver task --json
```

   `--gates "<gates_abs>"` is optional; omit it unless you need to override the manifest-derived gates path.

2. After each tick, run triage when blocked:

```bash
bun ".opencode/pai-tools/deep-research-cli.ts" triage --manifest "<manifest_abs>"

# Runtime install (~/.config/opencode)
cd "$HOME/.config/opencode"
bun "pai-tools/deep-research-cli.ts" triage --manifest "<manifest_abs>"
```

3. Stop when terminal status reached or a typed blocker is emitted (the CLI prints the blocker artifact path when present).
   When present, execute `halt.next_commands[]` before the next tick.

## Validation Contract

- [ ] Every tick results in either stage advancement or a typed stop artifact (the CLI prints the halt artifact path).
- [ ] Watchdog checks are enforced pre/post tick.
- [ ] Manifest mutations happen only through lifecycle tools (`stage_advance` / `manifest_write`).

## Notes

- Keep temporary summaries and diagnostics in scratchpad.
- Use explicit flags; do not depend on env var toggles.
