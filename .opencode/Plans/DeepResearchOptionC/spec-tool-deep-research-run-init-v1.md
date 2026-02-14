# spec-tool-deep-research-run-init-v1 (P01-02)

## Tool name
`deep_research_run_init`

## Purpose
Create a new Option C deep-research run directory (artifact-first substrate) and write initial `manifest.json` + `gates.json` skeleton.

## Constraints
- No OpenCode core changes.
- Must be deployable as a **global custom tool** under `~/.config/opencode/tools/` (see OpenCode Custom Tools docs).

## Inputs (args)
| Arg | Type | Required | Notes |
|---|---:|:---:|---|
| `query` | string | ✅ | original user query (verbatim) |
| `mode` | string | ✅ | `quick|standard|deep` |
| `sensitivity` | string | ✅ | `normal|restricted|no_web` |
| `run_id` | string | ❌ | if omitted, tool generates one |
| `root_override` | string | ❌ | absolute path override for run root (tests/debug only) |

## Default run root (cross-session persistence)
By default (when `root_override` is not provided), the tool MUST create run roots under:
- `PAI_DR_RUNS_ROOT` if set, otherwise
- `~/.config/opencode/research-runs/<run_id>`

## Outputs (return value)
Return JSON (stringified or object, depending on tool conventions) with:
| Field | Type | Required | Notes |
|---|---:|:---:|---|
| `run_id` | string | ✅ | final run id |
| `root` | string | ✅ | absolute run root |
| `paths` | object | ✅ | canonical subpaths (wave1, citations, summaries, etc.) |
| `created` | boolean | ✅ | whether a new directory was created |
| `manifest_path` | string | ✅ | absolute path |
| `gates_path` | string | ✅ | absolute path |

## Error contract (mandatory)
On success:
```json
{ "ok": true, "run_id": "...", "root": "...", "manifest_path": "...", "gates_path": "...", "paths": { } }
```

On expected failures:
```json
{ "ok": false, "error": { "code": "PATH_NOT_WRITABLE", "message": "...", "details": {} } }
```

## Side effects
- Creates directory structure under a cross-session persistent runs root.
- Writes `manifest.json` (schema `manifest.v1`) with `status=created`, `stage.current=init`.
- Writes `gates.json` (schema `gates.v1`) with all gates `not_run`, `revision=1`, and a placeholder `inputs_digest`.

## Idempotency
- If `run_id` is provided and run root exists:
  - MUST NOT overwrite existing artifacts.
  - returns `created=false` and the existing paths.

## Failure modes
| Error | When | Required behavior |
|---|---|---|
| `INVALID_ARGS` | invalid mode/sensitivity/run_id | return error with details |
| `PATH_NOT_WRITABLE` | cannot create run root | return error |
| `ALREADY_EXISTS_CONFLICT` | root exists but manifest missing/corrupt | return error + guidance |
| `SCHEMA_WRITE_FAILED` | cannot write manifest/gates | return error |

## Acceptance criteria
- Creates full run directory skeleton deterministically.
- Produces `manifest.json` and `gates.json` conforming to Phase 00 schemas.
- Returns absolute paths so orchestrator can reference artifacts.

## Evidence
This spec defines:
- args, outputs, side effects, idempotency, and failure modes.

## References
- OpenCode custom tools global location:
  - `/Users/zuul/Projects/opencode/packages/web/src/content/docs/custom-tools.mdx`
- Phase 00 schemas:
  - `spec-manifest-schema-v1.md`
  - `spec-gates-schema-v1.md`
