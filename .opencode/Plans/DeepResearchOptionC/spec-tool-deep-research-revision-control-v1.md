# spec-tool-deep-research-revision-control-v1 (P05-10)

## Tool name
`deep_research_revision_control`

## Purpose
Enforce a bounded review→revise loop:
- bounded by `manifest.limits.max_review_iterations`,
- explicit escalation reason when the bound is hit,
- deterministic stage-machine decision output.

## Inputs (args)
| Arg | Type | Required | Notes |
|---|---:|:---:|---|
| `manifest_path` | string | ✅ | absolute |
| `gates_path` | string | ✅ | absolute |
| `review_bundle_path` | string | ✅ | absolute |
| `current_iteration` | number | ✅ | 1-indexed |
| `reason` | string | ✅ | audit |

## Outputs
On success:
| Field | Type | Required | Notes |
|---|---:|:---:|---|
| `ok` | boolean | ✅ | |
| `action` | string | ✅ | `advance|revise|escalate` |
| `next_stage` | string | ✅ | stage-machine target |
| `notes` | string | ✅ | bounded |

## Rules (v1)
1. If `review_bundle.decision=PASS` and Gate E hard metrics pass → `action=advance`.
2. If `review_bundle.decision=CHANGES_REQUIRED` and `current_iteration < max_review_iterations` → `action=revise`.
3. If `current_iteration >= max_review_iterations` → `action=escalate` with explicit reason.

## References
- `spec-stage-machine-v1.md`
- `spec-manifest-schema-v1.md`
