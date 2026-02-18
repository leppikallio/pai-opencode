# TickUntilStop Workflow

Resume-safe loop that dispatches by current manifest stage until progress stops.

## Inputs

- `manifest` absolute path
- `gates` absolute path
- `driver`: `fixture` or `live`
- `reason`

## Dispatch Contract

- `init|wave1` -> live tick path for `--driver live`, fixture tick for `--driver fixture`
- `pivot|citations` -> post-pivot orchestration path
- `summaries|synthesis|review` -> post-summaries orchestration path

## Steps

1. Loop one tick at a time:

```bash
bun "pai-tools/deep-research-option-c.ts" tick --manifest "<manifest_abs>" --gates "<gates_abs>" --reason "loop tick" --driver <fixture|live>
```

2. After each tick, run triage when blocked:

```bash
bun "pai-tools/deep-research-option-c.ts" triage --manifest "<manifest_abs>"
```

3. Stop when terminal status reached or a typed blocker is emitted (the CLI prints the blocker artifact path when present).

## Validation Contract

- [ ] Every tick results in either stage advancement or a typed stop artifact (the CLI prints the halt artifact path).
- [ ] Watchdog checks are enforced pre/post tick.
- [ ] Manifest mutations happen only through lifecycle tools (`stage_advance` / `manifest_write`).

## Notes

- Keep temporary summaries and diagnostics in scratchpad.
- Use explicit flags; do not depend on env var toggles.
