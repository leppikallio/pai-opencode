# spec-tool-deep-research-fixture-replay-v1 (P06-04)

## Tool name
`deep_research_fixture_replay`

## Purpose
Offline harness that:
1) validates a `fixture_bundle.v1` bundle is well-formed,
2) re-computes Gate E evidence reports **offline** from bundle inputs,
3) compares recomputed reports to the bundled reports,
4) emits a **single deterministic machine-readable report** for regression tests.

Non-goals:
- Do not modify Gate formulas/thresholds.
- Do not write into / mutate the input fixture bundle.
- Do not perform any network access.

## Inputs (args)
| Arg | Type | Required | Notes |
|---|---:|:---:|---|
| `bundle_path` | string | ✅ | directory path OR archive path that unpacks to a bundle root |
| `expected_bundle_schema` | string | ❌ | default: `fixture_bundle.v1` |
| `strict` | boolean | ❌ | default: `true`; if true, missing required files => error |
| `compare_mode` | string | ❌ | default: `hash_and_schema`; `hash_only|hash_and_schema|full_json_diff` |

## Required bundle inputs
Bundle MUST conform to `spec-tool-deep-research-fixture-bundle-v1.md`.

At minimum, replay uses:
- `bundle.json`
- `manifest.json`
- `gates.json`
- `citations/citations.jsonl`
- `synthesis/final-synthesis.md`
- `reports/gate-e-numeric-claims.json`
- `reports/gate-e-citation-utilization.json`
- `reports/gate-e-sections-present.json`
- `reports/gate-e-status.json`

## Outputs (return value)
Return JSON object:
| Field | Type | Required | Notes |
|---|---:|:---:|---|
| `ok` | boolean | ✅ | success flag |
| `schema_version` | string | ✅ | fixed: `fixture_replay.report.v1` |
| `bundle_path` | string | ✅ | the resolved bundle root used |
| `bundle_id` | string | ✅ | from `bundle.json.bundle_id` |
| `run_id` | string | ✅ | from `bundle.json.run_id` |
| `status` | string | ✅ | `pass|fail` |
| `checks` | object | ✅ | per-artifact checks; deterministic order |
| `summary` | object | ✅ | counts + top-level boolean flags |

### `checks` object
Required fields:
- `gate_e_reports`:
  - `recomputed_sha256`: map `relpath -> sha256:<hex>` (keys sorted)
  - `bundled_sha256`: map `relpath -> sha256:<hex>` (keys sorted)
  - `matches`: map `relpath -> boolean` (keys sorted)
  - `mismatches`: array of relpaths (sorted lexicographically)

## Error contract (mandatory)
On success:
```json
{ "ok": true, "schema_version": "fixture_replay.report.v1", "status": "pass", "bundle_id": "...", "run_id": "...", "checks": {}, "summary": {} }
```

On expected failures:
```json
{ "ok": false, "error": { "code": "BUNDLE_INVALID", "message": "...", "details": { "missing": ["..."], "invalid": ["..."] } } }
```

## Determinism rules
1. **No web**: MUST be safe under `PAI_DR_NO_WEB=1`.
2. Canonical path set: all bundle-relative paths are compared using `/` separators.
3. JSON canonicalization:
   - When recomputing reports, serialize JSON with **lexicographic key order** at every object level.
   - Arrays MUST use deterministic ordering as defined in `spec-tool-deep-research-gate-e-reports-v1.md`.
4. Hashing:
   - sha256 is computed over the exact on-disk bytes of each file.
5. Output report ordering:
   - All object keys are lexicographically ordered.
   - All relpath arrays are lexicographically sorted.

## Recompute rules (Gate E)
Recompute Gate E reports from inputs using:
- `spec-tool-deep-research-gate-e-reports-v1.md` (authoritative report schemas + parsing rules)

The tool MUST recompute at least:
- `gate-e-numeric-claims.json`
- `gate-e-citation-utilization.json`
- `gate-e-sections-present.json`
- `gate-e-status.json`

## Example output (JSON)
```json
{
  "ok": true,
  "schema_version": "fixture_replay.report.v1",
  "bundle_id": "p05-synthesis-template-pass",
  "bundle_path": "/abs/path/fixtures/runs/p05-synthesis-template-pass",
  "run_id": "dr_20260214_001",
  "status": "pass",
  "checks": {
    "gate_e_reports": {
      "bundled_sha256": {
        "reports/gate-e-citation-utilization.json": "sha256:aaaaaaaa",
        "reports/gate-e-numeric-claims.json": "sha256:bbbbbbbb",
        "reports/gate-e-sections-present.json": "sha256:cccccccc",
        "reports/gate-e-status.json": "sha256:dddddddd"
      },
      "matches": {
        "reports/gate-e-citation-utilization.json": true,
        "reports/gate-e-numeric-claims.json": true,
        "reports/gate-e-sections-present.json": true,
        "reports/gate-e-status.json": true
      },
      "mismatches": [],
      "recomputed_sha256": {
        "reports/gate-e-citation-utilization.json": "sha256:aaaaaaaa",
        "reports/gate-e-numeric-claims.json": "sha256:bbbbbbbb",
        "reports/gate-e-sections-present.json": "sha256:cccccccc",
        "reports/gate-e-status.json": "sha256:dddddddd"
      }
    }
  },
  "summary": {
    "files_compared_total": 4,
    "files_matched_total": 4,
    "files_mismatched_total": 0
  }
}
```

## Failure modes
| Code | When |
|---|---|
| `INVALID_ARGS` | missing/invalid `bundle_path` or options |
| `BUNDLE_INVALID` | required files missing/invalid schema versions |
| `REPORT_RECOMPUTE_FAILED` | unable to recompute reports from bundle inputs |
| `COMPARE_FAILED` | compare_mode failure (e.g., JSON parse error in bundled report) |

## References
- `spec-tool-deep-research-fixture-bundle-v1.md`
- `spec-tool-deep-research-gate-e-reports-v1.md`
- `deep-research-option-c-phase-06-executable-backlog.md` (P06-04)
