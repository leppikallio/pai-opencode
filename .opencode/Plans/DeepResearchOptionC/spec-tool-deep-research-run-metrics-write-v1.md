# spec-tool-deep-research-run-metrics-write-v1 (P06-02 helper)

## Tool name
`deep_research_run_metrics_write`

## Purpose
Compute run/stage observability metrics **deterministically** from telemetry and write:
- `metrics/run-metrics.json`

This is the artifact referenced by Phase 06 for replay diagnosis and quality audits.

## Inputs (args)
| Arg | Type | Required | Notes |
|---|---:|:---:|---|
| `run_root` | string | ✅ | absolute run root |
| `telemetry_relpath` | string | ❌ | default: `logs/telemetry.jsonl` |
| `metrics_relpath` | string | ❌ | default: `metrics/run-metrics.json` |
| `schema_version` | string | ❌ | default: `run_metrics.v1` |

## Side effects
Writes (overwrites) deterministic JSON:
- `<run_root>/<metrics_relpath>`

Must create parent dir if missing.

## Outputs (return value)
Return JSON object:
| Field | Type | Required | Notes |
|---|---:|:---:|---|
| `ok` | boolean | ✅ | |
| `path` | string | ✅ | absolute metrics path |
| `schema_version` | string | ✅ | |
| `metrics` | object | ✅ | the computed metrics object |

## Metrics computation rules
Metrics MUST follow `spec-run-metrics-dictionary-v1.md` exactly.

In addition, the output JSON MUST include:
- `run_id` (string)
- `inputs_digest` (string, if available from manifest/gates)

## Determinism rules
1. Parsing:
   - Read telemetry JSONL in `seq` order.
   - If file ordering is not guaranteed, sort events by `seq` ascending.
2. Serialization:
   - JSON keys written in lexicographic order.
   - 2-space indentation recommended; MUST end with trailing newline.
3. Arrays/maps:
   - Any `by_stage_id` maps MUST contain a stable full stage set (missing stages => value `0`).

## Error contract (mandatory)
On success:
```json
{ "ok": true, "path": "/abs/run/metrics/run-metrics.json", "schema_version": "run_metrics.v1", "metrics": {} }
```

On expected failures:
```json
{ "ok": false, "error": { "code": "TELEMETRY_INVALID", "message": "...", "details": {} } }
```

## Example output (JSON)
```json
{
  "ok": true,
  "path": "/abs/run/metrics/run-metrics.json",
  "schema_version": "run_metrics.v1",
  "metrics": {
    "run": { "status": "failed", "duration_s": 689, "failures_total": 2 },
    "stage": { "timeouts_total": { "by_stage_id": { "citations": 1, "wave1": 0 } } }
  }
}
```

## Failure modes
| Code | When |
|---|---|
| `INVALID_ARGS` | run_root missing/invalid |
| `TELEMETRY_MISSING` | telemetry file missing |
| `TELEMETRY_INVALID` | telemetry JSONL corrupt / schema invalid |
| `WRITE_FAILED` | cannot write metrics file |

## References
- `spec-run-metrics-dictionary-v1.md`
- `spec-run-telemetry-schema-v1.md`
- `deep-research-option-c-phase-06-executable-backlog.md` (P06-02)
