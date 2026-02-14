# spec-tool-deep-research-gate-c-compute-v1 (P04-07)

## Tool name
`deep_research_gate_c_compute`

## Purpose
Compute Gate C metrics deterministically from citation artifacts and produce a gate update payload compatible with `deep_research_gates_write`.

## Inputs (args)
| Arg | Type | Required | Notes |
|---|---:|:---:|---|
| `manifest_path` | string | ✅ | absolute |
| `citations_path` | string | ❌ | absolute; default: `<runRoot>/citations/citations.jsonl` |
| `extracted_urls_path` | string | ❌ | absolute; default: `<runRoot>/citations/extracted-urls.txt` |
| `reason` | string | ✅ | audit |

## Outputs
| Field | Type | Required |
|---|---:|:---:|
| `ok` | boolean | ✅ |
| `gate_id` | string | ✅ | fixed: `C` |
| `status` | string | ✅ | `pass|fail` |
| `metrics` | object | ✅ | Gate C metric names |
| `update` | object | ✅ | patch for `deep_research_gates_write` |
| `inputs_digest` | string | ✅ |

## Metric definitions
Gate C metric names, formulas, and thresholds MUST match `spec-gate-thresholds-v1.md` exactly.

## Update payload shape (v1)
`update` MUST be:
```json
{
  "C": {
    "status": "pass",
    "checked_at": "<iso>",
    "metrics": {"validated_url_rate": 0.95, "invalid_url_rate": 0.05, "uncategorized_url_rate": 0.0},
    "artifacts": ["citations/citations.jsonl", "citations/extracted-urls.txt"],
    "warnings": [],
    "notes": "..."
  }
}
```

## Determinism rules
1. No web fetches, no agent/model calls.
2. Treat `citations.jsonl` as a set keyed by `normalized_url`.
3. `inputs_digest` derived from canonicalized `(normalized_url,status)` plus extracted URL set.

## Error contract (mandatory)
On success:
```json
{ "ok": true, "gate_id": "C", "status": "pass", "metrics": {"validated_url_rate": 1, "invalid_url_rate": 0, "uncategorized_url_rate": 0}, "update": {"C": {"status": "pass", "checked_at": "...", "metrics": {}, "artifacts": [], "warnings": [], "notes": "..."}}, "inputs_digest": "sha256:..." }
```

On expected failures:
```json
{ "ok": false, "error": { "code": "NOT_FOUND", "message": "citations.jsonl missing", "details": {} } }
```

## Side effects
- None required (returns update payload).
- Best-effort audit append (`kind=gate_c_compute`) to `<runRoot>/logs/audit.jsonl`.

## Failure modes
| Error | When |
|---|---|
| `INVALID_ARGS` | required args empty; any path not absolute |
| `NOT_FOUND` | required file missing |
| `INVALID_JSONL` | citations.jsonl malformed |
| `SCHEMA_VALIDATION_FAILED` | records fail schema |

## Acceptance criteria
- Same input artifacts produce identical metric outputs.
- `update` contains only fields allowed by `deep_research_gates_write`.

## References
- `spec-gate-thresholds-v1.md`
- `spec-tool-deep-research-gates-write-v1.md`
