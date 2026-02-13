# spec-tool-deep-research-manifest-write-v1 (P01-03)

## Tool name
`deep_research_manifest_write`

## Purpose
Safely write updates to `manifest.json` with:
- atomic write,
- `revision` increment,
- schema validation.

## Inputs (args)
| Arg | Type | Required | Notes |
|---|---:|:---:|---|
| `manifest_path` | string | ✅ | absolute path to manifest.json |
| `patch` | object | ✅ | partial update to merge into manifest |
| `expected_revision` | number | ❌ | if provided, enforce optimistic concurrency |
| `reason` | string | ✅ | short reason for audit trail |

## Outputs
| Field | Type | Required | Notes |
|---|---:|:---:|---|
| `ok` | boolean | ✅ | |
| `new_revision` | number | ✅ | updated revision |
| `updated_at` | string | ✅ | ISO timestamp |

## Error contract (mandatory)
On success, return:
```json
{ "ok": true, "new_revision": 2, "updated_at": "..." }
```

On expected failures, return:
```json
{ "ok": false, "error": { "code": "SCHEMA_VALIDATION_FAILED", "message": "...", "details": { "path": "stage.current" } } }
```

The tool must not throw for expected failures; only throw for truly unexpected internal errors.

## Rules
1. Load existing manifest.
2. If `expected_revision` provided, fail if mismatch.
3. Reject patches that attempt to change immutable fields:
   - `schema_version`, `run_id`, `created_at`, `updated_at`, `revision`, or any `artifacts.*`
4. Apply merge patch.
   - Patch semantics: **JSON Merge Patch (RFC 7396)**.
   - Arrays are replaced wholesale (no element-wise merge).
5. Validate against `manifest.v1` invariants.
6. Increment `revision` by exactly 1 from the current persisted manifest revision and update `updated_at`.
7. Atomic write (write temp + rename).
8. Append audit event to `logs/audit.jsonl` under the run root.

## Failure modes
| Error | When |
|---|---|
| `NOT_FOUND` | manifest_path missing |
| `INVALID_JSON` | manifest unreadable |
| `REVISION_MISMATCH` | optimistic lock failure |
| `SCHEMA_VALIDATION_FAILED` | invariants/type mismatch |
| `WRITE_FAILED` | cannot write |

## Acceptance criteria
- Revision increments exactly by 1 per successful write.
- Invalid patches never corrupt manifest.
- Validation errors identify failing field/path.
- Audit reason is persisted to `logs/audit.jsonl`.

## Evidence
This spec defines the atomic write + revision + validation contract.

## References
- `spec-manifest-schema-v1.md`
- `spec-schema-validation-v1.md`
