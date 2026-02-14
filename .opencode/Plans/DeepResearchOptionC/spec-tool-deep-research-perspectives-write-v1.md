# spec-tool-deep-research-perspectives-write-v1 (P03-01)

## Tool name
`deep_research_perspectives_write`

## Purpose
Validate a `perspectives.v1` payload and atomically write `perspectives.json` for an Option C run.

This tool is **artifact-only** (no web, no agents): it does not generate perspectives; it only validates + persists them.

## Inputs (args)
| Arg | Type | Required | Notes |
|---|---:|:---:|---|
| `perspectives_path` | string | ✅ | absolute path to `perspectives.json` |
| `value` | object | ✅ | must conform to `perspectives.v1` (see references) |
| `reason` | string | ✅ | short audit reason |

## Outputs
| Field | Type | Required | Notes |
|---|---:|:---:|---|
| `ok` | boolean | ✅ | `true` on success |
| `path` | string | ✅ | absolute path written |
| `audit_written` | boolean | ✅ | best-effort audit append result |
| `audit_path` | string | ❌ | absolute path when audit append succeeds |
| `audit_error` | string | ❌ | present when audit append fails |

## Error contract (mandatory)
On success:
```json
{ "ok": true, "path": "/abs/.../perspectives.json", "audit_written": true, "audit_path": "/abs/.../logs/audit.jsonl" }
```

On expected failures:
```json
{ "ok": false, "error": { "code": "SCHEMA_VALIDATION_FAILED", "message": "...", "details": {"path":"$.perspectives[0].prompt_contract.max_words"} } }
```

## Side effects
- Atomically writes JSON to `perspectives_path`.
- Best-effort append of an audit event (`kind=perspectives_write`) to `<runRoot>/logs/audit.jsonl`.

## Idempotency
- Idempotent for identical `value` inputs: re-running writes the same bytes.

## Failure modes
| Error | When |
|---|---|
| `INVALID_ARGS` | `perspectives_path` empty/not absolute, `reason` empty |
| `SCHEMA_VALIDATION_FAILED` | `value` fails `perspectives.v1` validation |
| `WRITE_FAILED` | filesystem write fails (permissions, missing dirs, etc.) |

## Acceptance criteria
- Valid `perspectives.v1` writes to disk with atomic semantics.
- Invalid payload returns `SCHEMA_VALIDATION_FAILED` with an informative `details.path`.
- Tool remains deterministic and testable without network or agent execution.

## Implementation notes (current gaps to call out)
The existing `perspectives_write` implementation (in `.opencode/tools/deep_research.ts`) currently:
- does **not** enforce `perspectives_path` naming/location (it can write anywhere),
- does **not** enforce stable ordering or uniqueness of `perspectives[].id` (recommended upstream),
- treats audit append as **non-fatal** (`ok:true` with `audit_written:false`).

## References
- `spec-router-summary-schemas-v1.md` (schema `perspectives.v1`)
- `spec-stage-machine-v1.md` (`init → wave1` requires `perspectives.json` exists)
