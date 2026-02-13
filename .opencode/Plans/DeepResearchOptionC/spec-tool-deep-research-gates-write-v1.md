# spec-tool-deep-research-gates-write-v1 (P01-04)

## Tool name
`deep_research_gates_write`

## Purpose
Write updates to `gates.json` deterministically and enforce gate lifecycle rules.

## Inputs (args)
| Arg | Type | Required | Notes |
|---|---:|:---:|---|
| `gates_path` | string | ✅ | absolute path to gates.json |
| `update` | object | ✅ | gate status/metrics updates (see shape below) |
| `inputs_digest` | string | ✅ | digest of inputs used to compute the update |
| `expected_revision` | number | ❌ | optimistic concurrency check |
| `reason` | string | ✅ | audit reason |

## Outputs
| Field | Type | Required |
|---|---:|:---:|
| `ok` | boolean | ✅ |
| `new_revision` | number | ✅ |
| `updated_at` | string | ✅ |

## Error contract (mandatory)
On success:
```json
{ "ok": true, "new_revision": 2, "updated_at": "..." }
```

On expected failures:
```json
{ "ok": false, "error": { "code": "UNKNOWN_GATE_ID", "message": "...", "details": {} } }
```

## Update shape (v1)
`update` MUST be of the form:
```json
{
  "A": { "status": "pass", "checked_at": "...", "metrics": {}, "artifacts": [], "warnings": [], "notes": "..." },
  "B": { "status": "pass", "checked_at": "...", "metrics": {}, "artifacts": [], "warnings": ["..."], "notes": "..." }
}
```
Only these fields are allowed in each gate patch: `status`, `checked_at`, `metrics`, `artifacts`, `warnings`, `notes`.

## Rules
1. Load existing gates.json.
2. If `expected_revision` provided, fail if mismatch.
3. Apply update (only for known gate IDs).
3. Enforce lifecycle:
   - hard gates cannot be `warn`
   - `checked_at` must be set on updates (must not be null)
   - `class` cannot change after creation
4. Set top-level `inputs_digest` to the provided value.
5. Increment top-level `revision` by 1 and set `updated_at`.
6. Validate against `gates.v1`.
7. Atomic write.
8. Append audit event to `logs/audit.jsonl` under the run root.

## Failure modes
| Error | When |
|---|---|
| `NOT_FOUND` | gates_path missing |
| `INVALID_JSON` | unreadable |
| `UNKNOWN_GATE_ID` | update references non-existent gate |
| `LIFECYCLE_RULE_VIOLATION` | hard gate set to warn, etc. |
| `WRITE_FAILED` | cannot write |

## Acceptance criteria
- Gate lifecycle constraints enforced.
- Hard gate failures block downstream stages (enforced by stage machine, not here).
- Audit reason is persisted to `logs/audit.jsonl`.

## Evidence
This spec defines gate update constraints and atomic write semantics.

## References
- `spec-gates-schema-v1.md`
- `spec-gate-thresholds-v1.md`
