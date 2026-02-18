# Tick Ledger Schema v1

Status: ACTIVE

File: `logs/ticks.jsonl` (append-only JSONL)
Schema version: `tick_ledger.v1`

## Required fields

- `schema_version` (string)
- `run_id` (string)
- `ts` (RFC3339 UTC timestamp)
- `tick_index` (positive integer)
- `phase` (`start` | `finish`)
- `stage_before` (string)
- `stage_after` (string)
- `status_before` (string)
- `status_after` (string)
- `result.ok` (boolean)
- `result.error.code` (optional string)
- `inputs_digest` (string | null)
- `artifacts` (object)
  - expected keys when available:
    - `manifest_path`
    - `gates_path`
    - `telemetry_path`
    - `metrics_path`

## Notes

- Ledger writes are append-only.
- Ledger timestamps are operational only and must not be used in gate/input digests.
