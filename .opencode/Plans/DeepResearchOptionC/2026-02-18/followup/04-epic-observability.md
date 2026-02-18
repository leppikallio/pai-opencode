# Epic E4 — Tick ledger + telemetry defaults

## Why
Architect raw-2: there is no canonical tick ledger; telemetry tools exist but aren’t integrated into operator loops by default.

## Outcomes
- `logs/ticks.jsonl` tick ledger: one structured entry per tick (start/end/outcome/inputs_digest/artifact pointers).
- Default telemetry + periodic run metrics emission.

## Deliverables
- Tick ledger schema v1 + append utility.
- Wire into operator loop (`tick`/`run`) and/or orchestrator wrappers.
- Wire `telemetry_append` + `run_metrics_write` with stable event names.

## Tests / Verification
- Entity test asserts tick ledger entries are written.

## Validator gates
- Architect PASS, QA PASS.
