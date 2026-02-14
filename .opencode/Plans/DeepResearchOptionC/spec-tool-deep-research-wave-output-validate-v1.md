# spec-tool-deep-research-wave-output-validate-v1 (P03-05)

## Tool name
`deep_research_wave_output_validate`

## Purpose
Validate a single Wave output markdown file for **contract compliance** (Gate B input).

This tool is deterministic and offline: **no web fetches, no agent calls**.

## Inputs (args)
| Arg | Type | Required | Notes |
|---|---:|:---:|---|
| `perspectives_path` | string | ✅ | absolute path to `perspectives.json` (`perspectives.v1`) |
| `perspective_id` | string | ✅ | selects the contract to validate against |
| `markdown_path` | string | ✅ | absolute path to the wave output markdown |

## Outputs
| Field | Type | Required | Notes |
|---|---:|:---:|---|
| `ok` | boolean | ✅ | |
| `perspective_id` | string | ✅ | echo |
| `markdown_path` | string | ✅ | echo |
| `words` | number | ✅ | whitespace token count |
| `sources` | number | ✅ | parsed source count |
| `missing_sections` | array | ✅ | list of missing required section titles |

## Validation rules (v1)
Given the selected perspective’s `prompt_contract`:
1. Required sections: every title in `must_include_sections[]` must appear as a markdown heading (`#`..`######`).
2. Word cap: total word count MUST be `<= max_words`.
3. Sources section:
   - If `must_include_sections` includes `Sources`, parse the content under the `Sources` heading.
   - Each source must be a bullet line containing an `http(s)://` URL.
   - Total sources MUST be `<= max_sources`.

## Error contract (mandatory)
On success:
```json
{ "ok": true, "perspective_id": "p1", "markdown_path": "/abs/.../wave-1/p1.md", "words": 842, "sources": 9, "missing_sections": [] }
```

On expected failures:
```json
{ "ok": false, "error": { "code": "MISSING_REQUIRED_SECTION", "message": "Missing section: Sources", "details": {"section":"Sources"} } }
```

## Side effects
- None required. (This tool validates and returns a JSON report only.)

## Failure modes
| Error | When |
|---|---|
| `INVALID_ARGS` | any arg empty or path not absolute |
| `NOT_FOUND` | `perspectives_path` or `markdown_path` missing |
| `INVALID_JSON` | `perspectives.json` unreadable JSON |
| `SCHEMA_VALIDATION_FAILED` | `perspectives.json` fails `perspectives.v1` |
| `PERSPECTIVE_NOT_FOUND` | `perspective_id` not present in `perspectives[]` |
| `MISSING_REQUIRED_SECTION` | a required section heading is missing |
| `TOO_MANY_WORDS` | word count exceeds `max_words` |
| `TOO_MANY_SOURCES` | source count exceeds `max_sources` |
| `MALFORMED_SOURCES` | Sources section present but contains non-bullet or URL-less entries |

## Acceptance criteria
- Deterministic results for a fixed `perspectives.json` + markdown file.
- Produces Gate B-ready metrics: word count, source count, missing sections.
- Fails with specific error codes for missing sections/cap violations.

## References
- `spec-router-summary-schemas-v1.md` (`perspectives.v1` contract source)
- `spec-stage-machine-v1.md` (Gate B blocks `wave1 → pivot` transition)
