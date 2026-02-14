# spec-tool-deep-research-citations-extract-urls-v1 (P04-01)

## Tool name
`deep_research_citations_extract_urls`

## Purpose
Extract candidate source URLs from Wave output markdown artifacts into a single deterministic list, plus bounded provenance.

This tool:
- does **not** validate URLs (Gate C validator does),
- does **not** fetch the web, and
- does **not** call agents/models.

## Inputs (args)
| Arg | Type | Required | Notes |
|---|---:|:---:|---|
| `manifest_path` | string | ✅ | absolute path to `manifest.json` (`manifest.v1`) |
| `include_wave2` | boolean | ❌ | default `true` |
| `extracted_urls_path` | string | ❌ | absolute; default: `<runRoot>/citations/extracted-urls.txt` |
| `found_by_path` | string | ❌ | absolute; default: `<runRoot>/citations/found-by.json` |
| `reason` | string | ✅ | audit |

## Outputs
| Field | Type | Required | Notes |
|---|---:|:---:|---|
| `ok` | boolean | ✅ | |
| `run_id` | string | ✅ | from manifest |
| `extracted_urls_path` | string | ✅ | absolute |
| `found_by_path` | string | ✅ | absolute |
| `total_found` | number | ✅ | before dedupe |
| `unique_found` | number | ✅ | after dedupe |
| `inputs_digest` | string | ✅ | `sha256:<hex>` |

## Extraction rules (v1)
1. Load + schema-validate `manifest.v1`.
2. Resolve run root from `manifest.artifacts.root`.
3. Determine wave dirs:
   - include `<runRoot>/<wave1_dir>/` always.
   - include `<runRoot>/<wave2_dir>/` only if `include_wave2=true` and directory exists.
4. For each wave dir, scan markdown files for URLs:
   - Only extract URLs found in the `## Sources` section.
   - Accept only `http://` and `https://` URLs.
   - Ignore everything else.

## Provenance artifact (`found-by.json`, v1)
Written as JSON:
```json
{
  "schema_version": "found_by.v1",
  "run_id": "dr_...",
  "items": [
    {
      "url_original": "https://example.com/x",
      "wave": "wave-1",
      "perspective_id": "p1",
      "source_line": "- https://example.com/x",
      "ordinal": 1
    }
  ]
}
```

Boundedness:
- Keep at most 20 provenance items per unique `url_original`.

## Determinism rules
1. No web fetches and no agent/model calls.
2. `extracted-urls.txt` MUST be sorted lexicographically, one URL per line.
3. `found-by.json.items[]` MUST be sorted by `(url_original asc, wave asc, perspective_id asc, ordinal asc)`.
4. `inputs_digest` MUST be derived from:
   - manifest fields required to resolve wave dirs, and
   - the list of scanned files (paths only),
   excluding timestamps.

## Error contract (mandatory)
On success:
```json
{ "ok": true, "run_id": "dr_...", "extracted_urls_path": "...", "found_by_path": "...", "total_found": 12, "unique_found": 9, "inputs_digest": "sha256:..." }
```

On expected failures:
```json
{ "ok": false, "error": { "code": "NOT_FOUND", "message": "manifest_path missing", "details": {"manifest_path":"..."} } }
```

## Side effects
- Atomically writes `extracted-urls.txt` and `found-by.json`.
- Best-effort audit append (`kind=citations_extract_urls`) to `<runRoot>/logs/audit.jsonl`.

## Failure modes
| Error | When |
|---|---|
| `INVALID_ARGS` | required args empty; any path not absolute |
| `NOT_FOUND` | manifest missing; wave dir missing |
| `INVALID_JSON` | manifest unreadable |
| `SCHEMA_VALIDATION_FAILED` | manifest fails `manifest.v1` |
| `WRITE_FAILED` | cannot write output artifacts |

## Acceptance criteria
- A fixed wave artifact set yields byte-identical outputs.
- No URLs are extracted from outside `## Sources`.

## References
- `spec-manifest-schema-v1.md`
- `spec-router-summary-schemas-v1.md` (perspective IDs)
- `deep-research-option-c-phase-04-executable-backlog.md`
