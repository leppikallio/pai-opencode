# spec-run-metrics-dictionary-v1 (P06-01)

## Purpose
Define the **metrics dictionary** for Option C run observability.

All metrics in this spec are computed **deterministically** from:
- `logs/telemetry.jsonl` (per `spec-run-telemetry-schema-v1.md`)
- the stage list / timeout table specs for validation

## Non-goals (important)
- **Gate A–F metric formulas are not defined here.** Gate thresholds and formulas remain the source of truth in `spec-gate-thresholds-v1.md`.
- This file defines **telemetry-derived run/stage metrics only** (counts, durations, outcomes).

## Metric naming
- Dot-separated, lower snake case segments.
- Prefer stable dimensions embedded as suffix keys when materializing JSON (offline-first), e.g.:
  - `stage.duration_s.by_stage_id.wave1`
  - `stage.retries_total.by_stage_id.wave1`

## Metric types
| Type | Meaning |
|---|---|
| `counter` | monotonically increasing integer |
| `duration_s` | integer seconds |
| `enum` | one of a fixed set of strings |

## Metric definitions (v1)

### Run-level
| Metric | Type | Unit | Compute rule |
|---|---|---|---|
| `run.status` | enum | n/a | last `run_status.status` in telemetry stream |
| `run.duration_s` | duration_s | s | `ts(last run_status) - ts(first run_status where status="running")` |
| `run.stages_started_total` | counter | count | count of `stage_started` events |
| `run.stages_finished_total` | counter | count | count of `stage_finished` events |
| `run.stage_timeouts_total` | counter | count | count of `watchdog_timeout` events |
| `run.failures_total` | counter | count | count of `stage_finished` where `outcome IN {"failed","timed_out"}` |

### Stage-level (materialized by `stage_id`)
Let `S` be the set of valid stage ids from `spec-stage-machine-v1.md`.

| Metric | Type | Unit | Compute rule |
|---|---|---|---|
| `stage.attempts_total.by_stage_id.<stage>` | counter | count | max `stage_attempt` observed in `stage_started` for that `stage_id` |
| `stage.retries_total.by_stage_id.<stage>` | counter | count | count of `stage_retry_planned` events for that `stage_id` |
| `stage.failures_total.by_stage_id.<stage>` | counter | count | count of `stage_finished` where `stage_id=<stage>` and `outcome IN {"failed","timed_out"}` |
| `stage.timeouts_total.by_stage_id.<stage>` | counter | count | count of `watchdog_timeout` events where `stage_id=<stage>` |

### Stage attempt durations (optional but deterministic)
For each `(stage_id, stage_attempt)` pair:
- `attempt.duration_s = stage_finished.elapsed_s`

This spec standardizes the materialized aggregate:
| Metric | Type | Unit | Compute rule |
|---|---|---|---|
| `stage.duration_s.by_stage_id.<stage>` | duration_s | s | sum of `stage_finished.elapsed_s` for that stage_id across all attempts |

## Validation rules
1. Every `watchdog_timeout.timeout_s` MUST equal the stage timeout seconds in `spec-watchdog-v1.md` for that stage.
2. Every `stage_finished.elapsed_s` MUST be an integer.
3. `run.stages_started_total` MUST equal `run.stages_finished_total` unless the run is currently `running`.

## Example

Using the example telemetry stream in `spec-run-telemetry-schema-v1.md`, the derived metrics (JSON) are:

```json
{
  "run": {
    "duration_s": 689,
    "failures_total": 2,
    "stage_timeouts_total": 1,
    "stages_finished_total": 4,
    "stages_started_total": 4,
    "status": "failed"
  },
  "stage": {
    "attempts_total": {
      "by_stage_id": {
        "citations": 1,
        "finalize": 0,
        "init": 1,
        "pivot": 0,
        "review": 0,
        "summaries": 0,
        "synthesis": 0,
        "wave1": 2,
        "wave2": 0
      }
    },
    "duration_s": {
      "by_stage_id": {
        "citations": 600,
        "finalize": 0,
        "init": 8,
        "pivot": 0,
        "review": 0,
        "summaries": 0,
        "synthesis": 0,
        "wave1": 75,
        "wave2": 0
      }
    },
    "failures_total": {
      "by_stage_id": {
        "citations": 1,
        "finalize": 0,
        "init": 0,
        "pivot": 0,
        "review": 0,
        "summaries": 0,
        "synthesis": 0,
        "wave1": 1,
        "wave2": 0
      }
    },
    "retries_total": {
      "by_stage_id": {
        "citations": 0,
        "finalize": 0,
        "init": 0,
        "pivot": 0,
        "review": 0,
        "summaries": 0,
        "synthesis": 0,
        "wave1": 1,
        "wave2": 0
      }
    },
    "timeouts_total": {
      "by_stage_id": {
        "citations": 1,
        "finalize": 0,
        "init": 0,
        "pivot": 0,
        "review": 0,
        "summaries": 0,
        "synthesis": 0,
        "wave1": 0,
        "wave2": 0
      }
    }
  }
}
```
