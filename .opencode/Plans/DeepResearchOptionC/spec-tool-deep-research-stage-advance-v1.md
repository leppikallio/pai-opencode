# spec-tool-deep-research-stage-advance-v1 (P02-02)

## Tool name
`deep_research_stage_advance`

## Purpose
Advance the run to the next stage deterministically based on:
- current manifest state,
- required artifacts,
- gate states.

This is the core of the **tool-driven stage machine**.

## Inputs (args)
| Arg | Type | Required | Notes |
|---|---:|:---:|---|
| `manifest_path` | string | ✅ | absolute |
| `gates_path` | string | ✅ | absolute |
| `requested_next` | string | ❌ | optional explicit target stage (validated) |
| `reason` | string | ✅ | audit |

## Outputs
| Field | Type | Required | Notes |
|---|---:|:---:|---|
| `ok` | boolean | ✅ | |
| `from` | string | ✅ | previous stage |
| `to` | string | ✅ | next stage |
| `decision` | object | ✅ | preconditions evaluated |

## Error contract (mandatory)
On success:
```json
{ "ok": true, "from": "wave1", "to": "pivot", "decision": { "allowed": true, "preconditions": [] } }
```

On expected failures:
```json
{ "ok": false, "error": { "code": "GATE_BLOCKED", "message": "Gate C not pass", "details": { "gate": "C" } } }
```

## decision object schema (v1)
`decision` MUST be an object with:
| Field | Type | Required | Notes |
|---|---:|:---:|---|
| `allowed` | boolean | ✅ | whether advance is permitted |
| `evaluated` | array | ✅ | list of evaluated preconditions |
| `inputs_digest` | string | ✅ | digest of artifacts/gates used |

Each `evaluated[]` entry:
| Field | Type | Required | Notes |
|---|---:|:---:|---|
| `kind` | string | ✅ | `gate|artifact|transition` |
| `name` | string | ✅ | e.g. `Gate C`, `summaries/summary-pack.json` |
| `ok` | boolean | ✅ | |
| `details` | object | ✅ | machine-readable context |

## Decision logic (v1)
1. Load manifest + gates.
2. Determine allowed transitions from `spec-stage-machine-v1.md`.
3. Verify preconditions (artifacts exist, required gate pass, etc.).
4. If preconditions fail, return `GATE_BLOCKED` or `MISSING_ARTIFACT`.
5. If ok, update manifest stage history + status and persist via manifest writer.

## Failure modes
| Error | When |
|---|---|
| `INVALID_STATE` | stage not recognized |
| `GATE_BLOCKED` | required hard gate not pass |
| `MISSING_ARTIFACT` | required file/dir missing |
| `REQUESTED_NEXT_NOT_ALLOWED` | requested_next is invalid transition |
| `WRITE_FAILED` | cannot persist |

## Acceptance criteria
- Same manifest+gates inputs produce the same advance decision.
- Transition history appended with timestamp.
- Blocks on Gate C and Gate D before synthesis.

## Evidence
This spec defines inputs/outputs and deterministic decision steps.

## References
- `spec-stage-machine-v1.md`
- `spec-manifest-schema-v1.md`
- `spec-gates-schema-v1.md`
