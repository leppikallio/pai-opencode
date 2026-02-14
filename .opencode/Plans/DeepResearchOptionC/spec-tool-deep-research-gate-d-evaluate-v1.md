# spec-tool-deep-research-gate-d-evaluate-v1 (P05-03)

## Tool name
`deep_research_gate_d_evaluate`

## Purpose
Compute Gate D metrics deterministically and return a `deep_research_gates_write` update payload.

## Inputs (args)
| Arg | Type | Required | Notes |
|---|---:|:---:|---|
| `manifest_path` | string | ✅ | absolute |
| `summary_pack_path` | string | ❌ | absolute; default: `<runRoot>/summaries/summary-pack.json` |
| `summaries_dir` | string | ❌ | absolute; default: `<runRoot>/summaries/` |
| `reason` | string | ✅ | audit |

## Metrics (authoritative)
Gate D metrics and thresholds MUST match `spec-gate-thresholds-v1.md` exactly:
- `summary_count / expected`
- `max_summary_kb`
- `total_summary_pack_kb`

## Outputs
| Field | Type | Required |
|---|---:|:---:|
| `ok` | boolean | ✅ |
| `gate_id` | string | ✅ | fixed: `D` |
| `status` | string | ✅ | `pass|fail` |
| `metrics` | object | ✅ |
| `update` | object | ✅ | patch for `deep_research_gates_write` |
| `inputs_digest` | string | ✅ |

## Determinism rules
1. No web fetches, no agent/model calls.
2. Summary ids MUST be derived from `summary-pack.json` entries.
3. Sizes computed as UTF-8 byte lengths; KB = `bytes / 1024`.

## Error contract (mandatory)
On success:
```json
{ "ok": true, "gate_id": "D", "status": "pass", "metrics": {"summary_count_ratio": 1.0, "max_summary_kb": 4.2, "total_summary_pack_kb": 32.0}, "update": {"D": {"status": "pass", "checked_at": "...", "metrics": {}, "artifacts": [], "warnings": [], "notes": "..."}}, "inputs_digest": "sha256:..." }
```

## Side effects
- None required.
- Best-effort audit append (`kind=gate_d_evaluate`) to `<runRoot>/logs/audit.jsonl`.

## References
- `spec-gate-thresholds-v1.md` (Gate D)
- `spec-tool-deep-research-gates-write-v1.md`
