# spec-tool-deep-research-quality-audit-v1 (P06-09)

## Tool name
`deep_research_quality_audit`

## Purpose
Scan a set of prior **offline fixture bundles** and flag **quality drift** signals that should trigger investigation.

This tool is offline-first and deterministic so it can be regression-tested.

Examples of drift signals (non-exhaustive):
- Gate E soft-metric warnings trending upward
- citation utilization rate trending downward
- duplicate citation rate trending upward
- recurring missing required sections (should be impossible if Gate E hard metric is enforced)
- telemetry-derived latency envelope regressions (if `metrics/run-metrics.json` present)

## Inputs (args)
| Arg | Type | Required | Notes |
|---|---:|:---:|---|
| `bundle_paths` | string[] | ✅ | list of bundle roots (dirs) |
| `min_bundles` | number | ❌ | default: `1` |
| `include_telemetry_metrics` | boolean | ❌ | default: `true`; uses `metrics/run-metrics.json` when present |
| `schema_version` | string | ❌ | default: `quality_audit.report.v1` |

## Required per-bundle artifacts
For each bundle in `bundle_paths`, the tool reads:
- `bundle.json`
- `reports/gate-e-status.json`
- `reports/gate-e-citation-utilization.json`

Optional (if present and `include_telemetry_metrics=true`):
- `metrics/run-metrics.json`

## Outputs (return value)
Return JSON object:
| Field | Type | Required | Notes |
|---|---:|:---:|---|
| `ok` | boolean | ✅ | |
| `schema_version` | string | ✅ | |
| `bundles_scanned_total` | number | ✅ | |
| `bundles_used_total` | number | ✅ | excludes invalid bundles |
| `findings` | array | ✅ | deterministic order |
| `summary` | object | ✅ | aggregate counters |

### `finding` schema (v1)
Each finding MUST include:
- `code` (string) — stable identifier, e.g. `UTILIZATION_TREND_DOWN`
- `severity` (string) — `info|warn|error`
- `bundle_id` (string)
- `run_id` (string)
- `details` (object) — code-specific data, deterministic key order

## Determinism rules
1. Input ordering:
   - Tool MUST process bundles in lexicographic order of `bundle.json.bundle_id` (tie-break by `run_id`).
2. Finding ordering:
   - Findings MUST be sorted by `(severity desc, code asc, bundle_id asc)`.
3. Stable JSON serialization:
   - Lexicographic key order at every object level.
   - Arrays preserve the deterministic ordering rules above.
4. No web:
   - MUST be safe under `PAI_DR_NO_WEB=1`.

## Example output (JSON)
```json
{
  "ok": true,
  "schema_version": "quality_audit.report.v1",
  "bundles_scanned_total": 3,
  "bundles_used_total": 3,
  "findings": [
    {
      "bundle_id": "p05-synthesis-template-pass",
      "code": "HIGH_DUPLICATE_CITATION_RATE",
      "details": { "duplicate_citation_rate": 0.62, "threshold": 0.5 },
      "run_id": "dr_20260214_001",
      "severity": "warn"
    }
  ],
  "summary": {
    "warnings_total": 1,
    "errors_total": 0
  }
}
```

## Error contract (mandatory)
On expected failures:
```json
{ "ok": false, "error": { "code": "NO_VALID_BUNDLES", "message": "...", "details": { "invalid": ["..."] } } }
```

## Failure modes
| Code | When |
|---|---|
| `INVALID_ARGS` | bundle_paths empty / invalid |
| `BUNDLE_INVALID` | bundle missing required artifacts |
| `NO_VALID_BUNDLES` | all bundles invalid or < min_bundles |
| `PARSE_FAILED` | JSON parse/schema error in a required report |

## References
- `spec-tool-deep-research-fixture-bundle-v1.md`
- `spec-tool-deep-research-gate-e-reports-v1.md` (for warning codes + metrics)
- `spec-run-metrics-dictionary-v1.md` (if telemetry metrics included)
- `deep-research-option-c-phase-06-executable-backlog.md` (P06-09)
