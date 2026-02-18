# RunLiveWave1ToPivot Workflow

Run live Wave 1 collection and stop when the run reaches `stage.current=pivot`.

## Inputs

- Query string
- Optional: `--run-id`

## Steps

1. Initialize run:

```bash
bun "pai-tools/deep-research-option-c.ts" init "<query>" --mode standard --sensitivity normal
```

2. Tick with the live driver until `status` output shows `stage.current: pivot`:

```bash
bun "pai-tools/deep-research-option-c.ts" tick --manifest "<manifest_abs>" --gates "<gates_abs>" --reason "live wave1 tick" --driver live
```

3. If progress stalls, inspect blockers:

```bash
bun "pai-tools/deep-research-option-c.ts" triage --manifest "<manifest_abs>"
```

## Validation Contract

- [ ] The printed `wave1_plan_path` exists.
- [ ] Every planned perspective has an ingested wave output artifact (paths are inside `run_root` and produced by the CLI).
- [ ] A wave review artifact exists and reports `decision=PASS` with no retry directives.
- [ ] The printed `gates_path` has `gates.B.status=pass`.
- [ ] `manifest.stage.current` advanced to `pivot`.

## Notes

- Keep operator notes in scratchpad only.
- Do not use env vars; pass all controls through CLI flags.
