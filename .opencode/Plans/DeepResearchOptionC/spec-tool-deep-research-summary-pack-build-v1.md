# spec-tool-deep-research-summary-pack-build-v1 (P05-01)

## Tool name
`deep_research_summary_pack_build`

## Purpose
Create the bounded synthesis input artifacts:
- `summaries/summary-pack.json` (schema `summary_pack.v1`), and
- per-perspective bounded summaries (`summaries/<perspective_id>.md`).

This tool prevents synthesis from reading raw Wave dumps directly.

## Inputs (args)
| Arg | Type | Required | Notes |
|---|---:|:---:|---|
| `manifest_path` | string | ✅ | absolute |
| `perspectives_path` | string | ❌ | absolute; default: `<runRoot>/perspectives.json` |
| `citations_path` | string | ❌ | absolute; default: `<runRoot>/citations/citations.jsonl` |
| `mode` | string | ❌ | `fixture|generate`; default `fixture` for entity tests |
| `fixture_summaries_dir` | string | ❌ | required for `mode=fixture`; absolute dir containing `<perspective_id>.md` |
| `summary_pack_path` | string | ❌ | absolute; default: `<runRoot>/summaries/summary-pack.json` |
| `summaries_dir` | string | ❌ | absolute; default: `<runRoot>/summaries/` |
| `reason` | string | ✅ | audit |

## Outputs
| Field | Type | Required |
|---|---:|:---:|
| `ok` | boolean | ✅ |
| `summary_pack_path` | string | ✅ |
| `summaries_dir` | string | ✅ |
| `summary_count` | number | ✅ |
| `inputs_digest` | string | ✅ |

## Artifact requirements
### `summaries/summary-pack.json`
- MUST conform to `summary_pack.v1` (see `spec-router-summary-schemas-v1.md`).
- MUST reference summaries using run-root-relative paths.
- MUST NOT contain raw wave output content.

### `summaries/<perspective_id>.md`
- MUST be <= `manifest.limits.max_summary_kb`.
- MUST use citation syntax `[@<cid>]` where possible.
- MUST NOT contain raw URLs.

## Size enforcement (Gate D alignment)
The tool MUST enforce:
- per-summary size cap = `manifest.limits.max_summary_kb`.
- total summaries cap = `manifest.limits.max_total_summary_kb`.

## Citation hygiene
- If any raw URL appears in a summary output, the tool MUST fail with `RAW_URL_NOT_ALLOWED`.
- If a `[@<cid>]` appears but `<cid>` is not present in `citations.jsonl` with status `valid|paywalled`, the tool MUST fail with `UNKNOWN_CID`.

## Determinism rules
- `mode=fixture` MUST be deterministic.
- Perspective ids MUST be processed in lexicographic order.
- `inputs_digest` MUST be computed from:
  - manifest + perspectives digests,
  - citations digest (set of `cid` where status in `valid|paywalled`),
  - and summary fixture file bytes (fixture mode).

## Error contract (mandatory)
On success:
```json
{ "ok": true, "summary_pack_path": "...", "summaries_dir": "...", "summary_count": 6, "inputs_digest": "sha256:..." }
```

On expected failures:
```json
{ "ok": false, "error": { "code": "SIZE_CAP_EXCEEDED", "message": "summary p3.md exceeds max_summary_kb", "details": {"perspective_id":"p3"} } }
```

## Side effects
- Atomically writes summary pack and per-perspective summaries.
- Best-effort audit append (`kind=summary_pack_build`) to `<runRoot>/logs/audit.jsonl`.

## Failure modes
| Error | When |
|---|---|
| `INVALID_ARGS` | required args empty; any path not absolute |
| `NOT_FOUND` | required file missing |
| `SCHEMA_VALIDATION_FAILED` | manifest/perspectives/summary_pack schema fails |
| `RAW_URL_NOT_ALLOWED` | raw URL present in output summary |
| `UNKNOWN_CID` | summary references cid not present in validated pool |
| `SIZE_CAP_EXCEEDED` | summary or total exceeds caps |
| `WRITE_FAILED` | cannot write |

## Acceptance criteria
- Entity tests can build a summary pack purely from fixtures, offline.
- Output is bounded and Gate D-ready.

## References
- `spec-router-summary-schemas-v1.md` (`summary_pack.v1`)
- `spec-gate-thresholds-v1.md` (Gate D)
- `deep-research-option-c-phase-05-executable-backlog.md`
