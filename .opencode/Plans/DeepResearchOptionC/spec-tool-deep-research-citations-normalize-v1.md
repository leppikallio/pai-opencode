# spec-tool-deep-research-citations-normalize-v1 (P04-03)

## Tool name
`deep_research_citations_normalize`

## Purpose
Normalize extracted URLs and compute stable `cid` values for each unique `normalized_url`, per `spec-citation-schema-v1.md`.

This tool MUST NOT invent new rules.

## Inputs (args)
| Arg | Type | Required | Notes |
|---|---:|:---:|---|
| `manifest_path` | string | ✅ | absolute |
| `extracted_urls_path` | string | ❌ | absolute; default: `<runRoot>/citations/extracted-urls.txt` |
| `normalized_urls_path` | string | ❌ | absolute; default: `<runRoot>/citations/normalized-urls.txt` |
| `url_map_path` | string | ❌ | absolute; default: `<runRoot>/citations/url-map.json` |
| `reason` | string | ✅ | audit |

## Outputs
| Field | Type | Required |
|---|---:|:---:|
| `ok` | boolean | ✅ |
| `run_id` | string | ✅ |
| `normalized_urls_path` | string | ✅ |
| `url_map_path` | string | ✅ |
| `unique_normalized` | number | ✅ |
| `inputs_digest` | string | ✅ |

## Artifacts written (v1)
1. `citations/normalized-urls.txt`
   - One `normalized_url` per line.
   - Sorted lexicographically.
2. `citations/url-map.json`
   - JSON:
```json
{
  "schema_version": "url_map.v1",
  "run_id": "dr_...",
  "items": [
    { "url_original": "...", "normalized_url": "...", "cid": "cid_<sha256hex>" }
  ]
}
```

## Determinism rules
1. No web fetches and no agent/model calls.
2. Sorting rules:
   - `normalized-urls.txt`: sort by `normalized_url`.
   - `url-map.json.items[]`: sort by `(normalized_url asc, url_original asc)`.

## Error contract (mandatory)
On success:
```json
{ "ok": true, "run_id": "dr_...", "normalized_urls_path": "...", "url_map_path": "...", "unique_normalized": 9, "inputs_digest": "sha256:..." }
```

On expected failures:
```json
{ "ok": false, "error": { "code": "NOT_FOUND", "message": "extracted urls missing", "details": {} } }
```

## Side effects
- Atomically writes `normalized-urls.txt` and `url-map.json`.
- Best-effort audit append (`kind=citations_normalize`) to `<runRoot>/logs/audit.jsonl`.

## Failure modes
| Error | When |
|---|---|
| `INVALID_ARGS` | required args empty; any path not absolute |
| `NOT_FOUND` | required files missing |
| `INVALID_JSON` | manifest unreadable |
| `SCHEMA_VALIDATION_FAILED` | manifest fails schema |
| `WRITE_FAILED` | cannot write |

## Acceptance criteria
- `cid` values match `spec-citation-schema-v1.md`.
- Same input yields byte-identical outputs.

## References
- `spec-citation-schema-v1.md`
- `spec-manifest-schema-v1.md`
