# RunLiveWave1ToPivot Workflow

Run live Wave 1 collection and stop when the run reaches `stage.current=pivot`.

## Inputs

- Query string
- Optional: `--run-id`

## Steps

1. Initialize run:

```bash
bun "Tools/deep-research-option-c.ts" init "<query>" --mode standard --sensitivity normal
```

2. Tick with the live driver until `status` output shows `stage.current: pivot`:

```bash
bun "Tools/deep-research-option-c.ts" tick --manifest "<manifest_abs>" --gates "<gates_abs>" --reason "live wave1 tick" --driver live
```

3. If progress stalls, inspect blockers:

```bash
bun "Tools/deep-research-option-c.ts" triage --manifest "<manifest_abs>"
```

## Validation Contract

- [ ] `wave-1/wave1-plan.json` exists.
- [ ] Every perspective in `perspectives.json` has per-perspective ingestion (`wave-1/<perspective_id>.md` produced and ingested).
- [ ] `wave-review.json` reports `decision=PASS` and `retry_directives=[]`.
- [ ] `gates.json` has `gates.B.status=pass`.
- [ ] `manifest.stage.current` advanced to `pivot`.

## Notes

- Keep operator notes in scratchpad only.
- Do not use env vars; pass all controls through CLI flags.
