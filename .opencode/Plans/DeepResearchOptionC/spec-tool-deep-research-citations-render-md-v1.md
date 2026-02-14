# spec-tool-deep-research-citations-render-md-v1 (P04-09)

## Tool name
`deep_research_citations_render_md`

## Purpose
Render a deterministic, human-readable citations report from `citations.jsonl`.

## Inputs (args)
| Arg | Type | Required | Notes |
|---|---:|:---:|---|
| `manifest_path` | string | ✅ | absolute |
| `citations_path` | string | ❌ | absolute; default: `<runRoot>/citations/citations.jsonl` |
| `output_md_path` | string | ❌ | absolute; default: `<runRoot>/citations/validated-citations.md` |
| `reason` | string | ✅ | audit |

## Outputs
| Field | Type | Required |
|---|---:|:---:|
| `ok` | boolean | ✅ |
| `output_md_path` | string | ✅ |
| `rendered` | number | ✅ |
| `inputs_digest` | string | ✅ |

## Rendering requirements (v1)
For each citation record, include:
- `cid` (required)
- `url` (required; redacted form if needed)
- `status` (required)
- optional `title`/`publisher` when present

## Determinism rules
1. Sort by `normalized_url` ascending.
2. Do not emit timestamps.

## Error contract (mandatory)
On success:
```json
{ "ok": true, "output_md_path": ".../citations/validated-citations.md", "rendered": 9, "inputs_digest": "sha256:..." }
```

On expected failures:
```json
{ "ok": false, "error": { "code": "NOT_FOUND", "message": "citations.jsonl missing", "details": {} } }
```

## Side effects
- Atomically writes `validated-citations.md`.
- Best-effort audit append (`kind=citations_render_md`) to `<runRoot>/logs/audit.jsonl`.

## Failure modes
| Error | When |
|---|---|
| `NOT_FOUND` | citations.jsonl missing |
| `INVALID_JSONL` | malformed |
| `WRITE_FAILED` | cannot write |

## References
- `spec-citation-schema-v1.md`
