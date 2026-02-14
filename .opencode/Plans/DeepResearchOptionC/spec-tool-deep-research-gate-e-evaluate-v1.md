# spec-tool-deep-research-gate-e-evaluate-v1 (P05-07)

## Tool name
`deep_research_gate_e_evaluate`

## Purpose
Compute Gate E metrics deterministically and return a `deep_research_gates_write` update payload.

## Inputs (args)
| Arg | Type | Required | Notes |
|---|---:|:---:|---|
| `manifest_path` | string | ✅ | absolute |
| `synthesis_path` | string | ❌ | absolute; default: `<runRoot>/synthesis/final-synthesis.md` |
| `citations_path` | string | ❌ | absolute; default: `<runRoot>/citations/citations.jsonl` |
| `reason` | string | ✅ | audit |

## Metrics (authoritative)
Gate E metric names, formulas, and thresholds MUST match `spec-gate-thresholds-v1.md` exactly.

## Deterministic checks (v1)
- `uncited_numeric_claims`:
  - count numeric claims that appear without a nearby `[@<cid>]` citation.
- `report_sections_present`:
  - percentage of required headings present (exact string match).
- `citation_utilization_rate` and `duplicate_citation_rate`:
  - computed from `[@<cid>]` mentions.

## Outputs
Returns:
- `metrics` snapshot,
- `warnings[]` for soft metric failures,
- `update` payload for `deep_research_gates_write`.

## References
- `spec-gate-thresholds-v1.md` (Gate E)
- `spec-reviewer-rubrics-v1.md` (Gate E evidence)
