# spec-tool-deep-research-wave1-plan-v1 (P03-03)

## Tool name
`deep_research_wave1_plan`

## Purpose
Generate a deterministic **Wave 1 execution plan artifact** from:
- the run `manifest.json` and
- `perspectives.json` (`perspectives.v1`).

This tool must **not** execute web research or spawn agents. It only plans.

## Inputs (args)
| Arg | Type | Required | Notes |
|---|---:|:---:|---|
| `manifest_path` | string | ✅ | absolute path to `manifest.json` |
| `perspectives_path` | string | ❌ | absolute; default: `<runRoot>/<perspectives_file>` from manifest |
| `reason` | string | ✅ | audit reason |

## Outputs
| Field | Type | Required | Notes |
|---|---:|:---:|---|
| `ok` | boolean | ✅ | |
| `plan_path` | string | ✅ | absolute path to plan artifact |
| `inputs_digest` | string | ✅ | `sha256:<hex>` of the validated inputs |
| `planned` | number | ✅ | number of planned perspectives |

## Wave plan artifact (`wave1-plan.json`, v1)
Written to: `<runRoot>/<wave1_dir>/wave1-plan.json`.

Shape:
```json
{
  "schema_version": "wave1_plan.v1",
  "run_id": "dr_...",
  "generated_at": "<iso>",
  "inputs_digest": "sha256:...",
  "entries": [
    {
      "perspective_id": "p1",
      "agent_type": "ClaudeResearcher",
      "output_md": "wave-1/p1.md",
      "prompt_md": "..."
    }
  ]
}
```

Determinism rules:
1. Entries MUST be sorted by `perspective_id` (lexicographic).
2. Prompt text MUST be generated from a fixed template + manifest query + perspective contract.
3. No timestamps inside `prompt_md`.

## Error contract (mandatory)
On success:
```json
{ "ok": true, "plan_path": "/abs/.../wave-1/wave1-plan.json", "inputs_digest": "sha256:...", "planned": 3 }
```

On expected failures:
```json
{ "ok": false, "error": { "code": "WAVE_CAP_EXCEEDED", "message": "too many perspectives for wave1", "details": {"cap":6,"count":9} } }
```

## Side effects
- Reads + validates `manifest.v1` and `perspectives.v1`.
- Atomically writes `wave1-plan.json`.
- Best-effort audit append (`kind=wave1_plan`) to `<runRoot>/logs/audit.jsonl`.

## Failure modes
| Error | When |
|---|---|
| `INVALID_ARGS` | `manifest_path` empty/not absolute, `reason` empty |
| `NOT_FOUND` | `manifest_path` or `perspectives_path` missing |
| `INVALID_JSON` | either file is unreadable JSON |
| `SCHEMA_VALIDATION_FAILED` | manifest/perspectives schema fails |
| `WAVE_CAP_EXCEEDED` | `perspectives.length > manifest.limits.max_wave1_agents` |
| `WRITE_FAILED` | cannot write `wave1-plan.json` |

## Acceptance criteria
- Same inputs produce byte-identical `wave1-plan.json` (except `generated_at`).
- Enforces `max_wave1_agents` as a hard cap.
- Produces stable ordering and deterministic prompt templates for contract tests.

## References
- `spec-router-summary-schemas-v1.md` (schema `perspectives.v1`)
- `spec-manifest-schema-v1.md` (limits + canonical paths)
- `spec-stage-machine-v1.md` (`init` requires `perspectives.json` exists before `wave1`)
