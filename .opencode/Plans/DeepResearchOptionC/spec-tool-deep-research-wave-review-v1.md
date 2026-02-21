# spec-tool-deep-research-wave-review-v1 (P03-09)

## Tool name
`deep_research_wave_review`

> Export: `wave_review` in `.opencode/tools/deep_research_cli.ts`.

## Purpose
Provide a **deterministic, offline reviewer-enforcement scaffold** for Wave outputs.

Given:
- `perspectives.json` (`perspectives.v1`) and
- a set of Wave output markdown files (one per perspective),

this tool runs **contract checks equivalent to** `deep_research_wave_output_validate` for each perspective, then emits a **bounded PASS/FAIL report** plus **retry directives**.

This tool is deterministic and offline: **no agent calls / no web fetches**.

## Inputs (args)
| Arg | Type | Required | Notes |
|---|---:|:---:|---|
| `perspectives_path` | string | ✅ | absolute path to `perspectives.json` (`perspectives.v1`) |
| `outputs_dir` | string | ✅ | absolute directory containing markdown outputs, named `<perspective_id>.md` |
| `perspective_ids` | string[] | ❌ | optional subset; if omitted, validate all perspectives in file |
| `max_failures` | number | ❌ | bounds the *report verbosity*; default `25` (must be `1..500`) |
| `report_path` | string | ❌ | if provided, absolute path to write a JSON report (atomic write) |

### Output file resolution
For each `perspective_id`, the tool resolves the markdown path as:
`<outputs_dir>/<perspective_id>.md`.

No globbing is allowed (to preserve determinism).

## Outputs
On successful execution (even if the review **fails**), return:

| Field | Type | Required | Notes |
|---|---:|:---:|---|
| `ok` | boolean | ✅ | always `true` when the tool executed normally |
| `pass` | boolean | ✅ | `true` iff **every** validated perspective passed its contract |
| `perspectives_path` | string | ✅ | echo |
| `outputs_dir` | string | ✅ | echo |
| `validated` | number | ✅ | count of perspectives validated |
| `failed` | number | ✅ | count of perspectives that failed |
| `results` | array | ✅ | sorted by `perspective_id` |
| `retry_directives` | array | ✅ | bounded list (see boundedness rules) |
| `report` | object | ✅ | bounded summary for humans + machines |
| `report_path` | string\|null | ✅ | absolute path if written, else `null` |

### `results[]` entry shape (v1)
Each entry corresponds to one perspective:
```json
{
  "perspective_id": "p1",
  "markdown_path": "/abs/.../wave-1/p1.md",
  "pass": true,
  "metrics": { "words": 842, "sources": 9, "missing_sections": [] },
  "failure": null
}
```

If a perspective fails contract validation, `pass=false` and `failure` MUST mirror the `deep_research_wave_output_validate` error shape:
```json
{
  "code": "MISSING_REQUIRED_SECTION",
  "message": "Missing section: Sources",
  "details": { "section": "Sources" }
}
```

### `retry_directives[]` shape (v1)
Each directive tells the orchestrator how to retry for one perspective:
```json
{
  "perspective_id": "p1",
  "action": "retry",
  "change_note": "Add missing required section 'Sources' and ensure each source is a bullet URL",
  "blocking_error_code": "MISSING_REQUIRED_SECTION"
}
```

## Review algorithm (v1)
1. Read + schema-validate `perspectives.json` (`perspectives.v1`).
2. Determine the set of perspective ids:
   - if `perspective_ids` provided: validate those (must exist in perspectives), else validate all.
3. Sort selected perspective ids lexicographically.
4. For each `perspective_id` in that order:
   - resolve `markdown_path = <outputs_dir>/<perspective_id>.md`
   - run contract validation **equivalent to** `deep_research_wave_output_validate(perspectives_path, perspective_id, markdown_path)`
   - record metrics/failure.
5. Compute `pass = (failed === 0)`.
6. Emit bounded `retry_directives` for failed entries.
7. If `report_path` is provided, atomically write the returned report JSON to that path.

## Determinism rules
1. No agent calls / no web fetches.
2. No filesystem globbing.
3. Sort all perspective ids before validation.
4. Output arrays (`results`, `retry_directives`) MUST be in lexicographic `perspective_id` order.
5. Output MUST NOT include timestamps (fixture-testable, byte-stable JSON for fixed inputs).
6. Boundedness MUST be enforced (see below) to avoid unbounded error spam.

## Boundedness rules
- `results[]` MUST include **one entry per validated perspective**.
- `retry_directives[]` MUST be capped to `max_failures` entries.
- `report.failures_sample[]` MUST be capped to `max_failures` perspective ids.
- Any freeform message fields produced by this tool MUST be truncated to 200 characters.

## Error contract (mandatory)
Fatal/tooling failures return the standard error envelope:

```json
{ "ok": false, "error": { "code": "INVALID_ARGS", "message": "outputs_dir must be absolute", "details": { "outputs_dir": "./rel" } } }
```

Non-fatal contract failures **do not** use the fatal error envelope; they return `{ ok: true, pass: false, ... }` with per-perspective `failure` entries.

## Side effects
- None required.
- Optional: if `report_path` is set, atomically writes the review report JSON.

## Failure modes
| Error | When |
|---|---|
| `INVALID_ARGS` | any required arg empty; any path not absolute; `max_failures` out of range |
| `NOT_FOUND` | `perspectives_path` missing; `outputs_dir` missing/not a dir |
| `INVALID_JSON` | `perspectives.json` unreadable JSON |
| `SCHEMA_VALIDATION_FAILED` | `perspectives.json` fails `perspectives.v1` |
| `PERSPECTIVE_NOT_FOUND` | `perspective_ids` includes id not present in perspectives |
| `OUTPUT_NOT_FOUND` | expected markdown output file missing for a selected perspective |
| `WRITE_FAILED` | `report_path` set but cannot write |

## Example output — success
```json
{
  "ok": true,
  "pass": true,
  "perspectives_path": "/abs/run/perspectives.json",
  "outputs_dir": "/abs/run/wave-1",
  "validated": 2,
  "failed": 0,
  "results": [
    {
      "perspective_id": "p1",
      "markdown_path": "/abs/run/wave-1/p1.md",
      "pass": true,
      "metrics": { "words": 842, "sources": 2, "missing_sections": [] },
      "failure": null
    },
    {
      "perspective_id": "p2",
      "markdown_path": "/abs/run/wave-1/p2.md",
      "pass": true,
      "metrics": { "words": 910, "sources": 2, "missing_sections": [] },
      "failure": null
    }
  ],
  "retry_directives": [],
  "report": {
    "failures_sample": [],
    "failures_omitted": 0,
    "notes": "All perspectives passed wave output contract validation."
  },
  "report_path": null
}
```

## Example output — failure
```json
{
  "ok": true,
  "pass": false,
  "perspectives_path": "/abs/run/perspectives.json",
  "outputs_dir": "/abs/run/wave-1",
  "validated": 2,
  "failed": 1,
  "results": [
    {
      "perspective_id": "p1",
      "markdown_path": "/abs/run/wave-1/p1.md",
      "pass": false,
      "metrics": { "words": 777, "sources": 0, "missing_sections": ["Sources"] },
      "failure": {
        "code": "MISSING_REQUIRED_SECTION",
        "message": "Missing section: Sources",
        "details": { "section": "Sources" }
      }
    },
    {
      "perspective_id": "p2",
      "markdown_path": "/abs/run/wave-1/p2.md",
      "pass": true,
      "metrics": { "words": 910, "sources": 2, "missing_sections": [] },
      "failure": null
    }
  ],
  "retry_directives": [
    {
      "perspective_id": "p1",
      "action": "retry",
      "change_note": "Add missing required section 'Sources' and include only bullet URL entries.",
      "blocking_error_code": "MISSING_REQUIRED_SECTION"
    }
  ],
  "report": {
    "failures_sample": ["p1"],
    "failures_omitted": 0,
    "notes": "1/2 perspectives failed contract validation; retry directives emitted."
  },
  "report_path": null
}
```

## Acceptance criteria
- Deterministic results for a fixed `perspectives.json` + outputs directory.
- Contract checks per perspective are equivalent to `deep_research_wave_output_validate`.
- Produces a bounded report + retry directives without any agent/web usage.

## References
- `spec-tool-deep-research-wave-output-validate-v1.md` (per-perspective contract)
- `spec-router-summary-schemas-v1.md` (`perspectives.v1`)
