# Workflow: RunWave1WithTaskDriver

Run Wave 1 autonomously with the Task-backed `runAgent` driver (E1 option A), then gate to pivot.

## Preconditions

- Live driver is Task-backed (not operator-input/manual draft editing).
- `manifest.json`, `gates.json`, and the Wave 1 plan artifact exist under the run root.

## Inputs

- `manifest_path` (absolute)
- `gates_path` (absolute)
- `reason`

## Steps

1. Start from a valid run initialized for live execution.

2. Execute one live tick with autonomous driver path:

```bash
bun "pai-tools/deep-research-option-c.ts" tick --manifest "<manifest_abs>" --gates "<gates_abs>" --reason "wave1 live tick" --driver live
```

3. For each planned perspective, ensure the driver wrote output markdown and metadata sidecar, then ingest via `wave_output_ingest` and validate via `wave_output_validate`.

4. Run `wave_review` and inspect decision:
   - If PASS/no directives: continue to Gate B derive + gates write.
   - If retry directives exist: run bounded retry loop and record retry with `retry_record` (`gate_id=B`).

5. When Gate B is pass and no retry directive remains, stage advances to `pivot`.

## Retry directive interpretation

- Retry directives are stored in `retry-directives.json` under the Wave 1 artifact directory.
- `RETRY_REQUIRED` means Wave 1 must rerun affected perspectives before pivot.
- `RETRY_CAP_EXHAUSTED` means escalation is required; do not force pivot.

## Validation contract

- [ ] `wave1-plan.json` exists in the Wave 1 artifact directory and planned count matches produced outputs.
- [ ] Every planned perspective output passes `wave_output_validate`.
- [ ] `wave-review.json` exists in the Wave 1 artifact directory and includes all planned perspective IDs.
- [ ] Any retry path records `retry_record` for Gate B.
- [ ] On success, `gates.B.status=pass` and `manifest.stage.current=pivot`.
