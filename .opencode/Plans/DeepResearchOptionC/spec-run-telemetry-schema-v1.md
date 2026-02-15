# spec-run-telemetry-schema-v1 (P06-01)

## Purpose
Define the **deterministic, offline-first telemetry event stream** for an Option C Deep Research run.

This spec focuses on **stage lifecycle observability**:
- stage start/stop
- retries (bounded)
- failures
- watchdog timeouts

## File
Per-run canonical location (relative to `manifest.artifacts.root`):
- `logs/telemetry.jsonl`

Format:
- **JSONL** (one JSON object per line)
- UTF-8, LF newlines

## Alignment constraints
This telemetry schema MUST align with:
- Stage IDs: `spec-stage-machine-v1.md` (and `spec-manifest-schema-v1.md`)
- Timeout policy: `spec-watchdog-v1.md`

## Stage IDs (v1)
`stage_id` MUST be one of:
- `init`
- `wave1`
- `pivot`
- `wave2`
- `citations`
- `summaries`
- `synthesis`
- `review`
- `finalize`

## Determinism rules

### Stream ordering
1. The stream MUST be append-only.
2. Each event MUST have a unique, strictly increasing `seq` (integer).
3. Consumers MUST treat `seq` as the **authoritative ordering**.
4. If events are ever re-materialized from a store that does not preserve order, the consumer MUST sort by `seq` ascending.

### Canonical JSON serialization (offline-first)
When writing JSON lines, the producer MUST serialize objects with **deterministic key order**:
- Keys are written in **lexicographic (byte) order** at every object level.
- Arrays preserve insertion order.
- Numbers:
  - integers are written as JSON numbers with no leading zeros (except `0`)
  - no NaN/Infinity
- Timestamps are RFC3339 with `Z` (UTC), e.g. `2026-02-14T12:00:00Z`.

## Event schema

### Common fields (all events)
| Field | Type | Required | Notes |
|---|---:|:---:|---|
| `schema_version` | string | ✅ | fixed: `telemetry.v1` |
| `run_id` | string | ✅ | must match `manifest.run_id` |
| `seq` | number | ✅ | strictly increasing per run |
| `ts` | string | ✅ | RFC3339 UTC timestamp |
| `event_type` | string | ✅ | see Event types |

### Event types (v1)

#### `run_status`
Records a run status transition.

Additional fields:
| Field | Type | Required | Notes |
|---|---:|:---:|---|
| `status` | string | ✅ | `created|running|paused|failed|completed|cancelled` (matches manifest) |
| `message` | string | ❌ | short, human-readable |

#### `stage_started`
Records entry into a stage.

Additional fields:
| Field | Type | Required | Notes |
|---|---:|:---:|---|
| `stage_id` | string | ✅ | must be a valid stage id |
| `stage_attempt` | number | ✅ | 1-based counter per `stage_id` |
| `inputs_digest` | string | ✅ | digest used for stage decision/run |

#### `stage_finished`
Records the terminal outcome of a stage attempt.

Additional fields:
| Field | Type | Required | Notes |
|---|---:|:---:|---|
| `stage_id` | string | ✅ | |
| `stage_attempt` | number | ✅ | matches the started attempt |
| `outcome` | string | ✅ | `succeeded|failed|timed_out|cancelled` |
| `elapsed_s` | number | ✅ | integer seconds for this attempt |
| `failure_kind` | string | ❌ | if `outcome != succeeded`: `timeout|tool_error|invalid_output|gate_failed|unknown` |
| `retryable` | boolean | ❌ | if failed and retry is possible under policy |
| `message` | string | ❌ | short description |

#### `stage_retry_planned`
Records a bounded retry decision for a stage.

Additional fields:
| Field | Type | Required | Notes |
|---|---:|:---:|---|
| `stage_id` | string | ✅ | |
| `from_attempt` | number | ✅ | attempt number that failed |
| `to_attempt` | number | ✅ | next attempt number that will be run |
| `retry_index` | number | ✅ | 1-based retry counter per stage |
| `change_summary` | string | ✅ | MUST describe the material change |

#### `watchdog_timeout`
Records watchdog enforcement when a stage exceeds its max wall-clock time.

Additional fields:
| Field | Type | Required | Notes |
|---|---:|:---:|---|
| `stage_id` | string | ✅ | |
| `timeout_s` | number | ✅ | MUST equal the stage timeout in `spec-watchdog-v1.md` |
| `elapsed_s` | number | ✅ | integer seconds elapsed at timeout |
| `checkpoint_relpath` | string | ✅ | canonical: `logs/timeout-checkpoint.md` |

## Producer obligations
1. Emit `run_status`:
   - `created` once
   - `running` once (first transition into active execution)
   - one terminal status: `failed|completed|cancelled`
2. For every stage attempt:
   - exactly one `stage_started`
   - exactly one `stage_finished`
3. If a stage exceeds its timeout:
   - emit `watchdog_timeout`
   - emit `stage_finished` with `outcome = timed_out` and `failure_kind = timeout`
   - emit terminal `run_status` = `failed`

## Consumer obligations
1. Ignore unknown fields (forward-compatible).
2. Reject unknown `stage_id` values (schema enforcement).
3. Compute metrics using only the event stream + deterministic rules (see `spec-run-metrics-dictionary-v1.md`).

## Example

Valid `logs/telemetry.jsonl` example (JSONL; one event per line):

```jsonl
{"event_type":"run_status","run_id":"dr_20260214_001","schema_version":"telemetry.v1","seq":1,"status":"created","ts":"2026-02-14T12:00:00Z"}
{"event_type":"run_status","message":"orchestrator started","run_id":"dr_20260214_001","schema_version":"telemetry.v1","seq":2,"status":"running","ts":"2026-02-14T12:00:01Z"}

{"event_type":"stage_started","inputs_digest":"sha256:111111","run_id":"dr_20260214_001","schema_version":"telemetry.v1","seq":3,"stage_attempt":1,"stage_id":"init","ts":"2026-02-14T12:00:02Z"}
{"elapsed_s":8,"event_type":"stage_finished","outcome":"succeeded","run_id":"dr_20260214_001","schema_version":"telemetry.v1","seq":4,"stage_attempt":1,"stage_id":"init","ts":"2026-02-14T12:00:10Z"}

{"event_type":"stage_started","inputs_digest":"sha256:222222","run_id":"dr_20260214_001","schema_version":"telemetry.v1","seq":5,"stage_attempt":1,"stage_id":"wave1","ts":"2026-02-14T12:00:11Z"}
{"elapsed_s":20,"event_type":"stage_finished","failure_kind":"invalid_output","message":"Gate B hard threshold not met","outcome":"failed","retryable":true,"run_id":"dr_20260214_001","schema_version":"telemetry.v1","seq":6,"stage_attempt":1,"stage_id":"wave1","ts":"2026-02-14T12:00:31Z"}
{"change_summary":"retry with reduced agent fan-out and stricter output validator","event_type":"stage_retry_planned","from_attempt":1,"retry_index":1,"run_id":"dr_20260214_001","schema_version":"telemetry.v1","seq":7,"stage_id":"wave1","to_attempt":2,"ts":"2026-02-14T12:00:32Z"}
{"event_type":"stage_started","inputs_digest":"sha256:333333","run_id":"dr_20260214_001","schema_version":"telemetry.v1","seq":8,"stage_attempt":2,"stage_id":"wave1","ts":"2026-02-14T12:00:33Z"}
{"elapsed_s":55,"event_type":"stage_finished","outcome":"succeeded","run_id":"dr_20260214_001","schema_version":"telemetry.v1","seq":9,"stage_attempt":2,"stage_id":"wave1","ts":"2026-02-14T12:01:28Z"}

{"event_type":"stage_started","inputs_digest":"sha256:444444","run_id":"dr_20260214_001","schema_version":"telemetry.v1","seq":10,"stage_attempt":1,"stage_id":"citations","ts":"2026-02-14T12:01:29Z"}
{"checkpoint_relpath":"logs/timeout-checkpoint.md","elapsed_s":600,"event_type":"watchdog_timeout","run_id":"dr_20260214_001","schema_version":"telemetry.v1","seq":11,"stage_id":"citations","timeout_s":600,"ts":"2026-02-14T12:11:29Z"}
{"elapsed_s":600,"event_type":"stage_finished","failure_kind":"timeout","message":"timeout after 600s","outcome":"timed_out","retryable":false,"run_id":"dr_20260214_001","schema_version":"telemetry.v1","seq":12,"stage_attempt":1,"stage_id":"citations","ts":"2026-02-14T12:11:29Z"}

{"event_type":"run_status","message":"stage citations timed out; manifest.status set to failed","run_id":"dr_20260214_001","schema_version":"telemetry.v1","seq":13,"status":"failed","ts":"2026-02-14T12:11:30Z"}
```
