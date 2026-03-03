---
name: linkedin-scraper
description: LinkedIn extraction runbook for OpenCode using exact Apify tool names and strict parameter shapes. USE WHEN user asks to fetch LinkedIn posts, profile data, company activity, or LinkedIn search results.
---

# linkedin-scraper

Use this as the authoritative OpenCode playbook for LinkedIn extraction.

## Exact Tool Names (OpenCode)

Use these names exactly:

- `apify_fetch-actor-details`
- `apify_call-actor`
- `apify_get-actor-output`
- `apify_search-actors` (optional actor discovery)

Do **not** use `mcp__apify__...` or underscore variants like `call_actor`.

## Default Actor Policy (Minimize Ambiguity)

1. **Default for most requests:** `supreme_coder/linkedin-post`
   - Works for post URLs, profile URLs, company URLs, and LinkedIn content-search URLs.
2. Use specialized actors only if explicitly needed:
   - `apimaestro/linkedin-profile-detail` (profile details)
   - `apimaestro/linkedin-company-posts` (company feed focus)
   - `apimaestro/linkedin-profile-posts` (profile posts focus)
   - `harvestapi/linkedin-post-search` (search-specific workflows)

## URL Routing Rules

- `linkedin.com/posts/` → post extraction
- `linkedin.com/in/` → profile-driven extraction
- `linkedin.com/company/` → company-driven extraction
- `linkedin.com/search/results/content/` → search results extraction

All routes can use `supreme_coder/linkedin-post` unless user asks otherwise.

## Canonical Execution Sequence (Strict)

1. Collect LinkedIn URL(s) from the request.
2. Choose actor (default `supreme_coder/linkedin-post`).
3. (Optional) Verify actor schema/pricing with `apify_fetch-actor-details`.
4. Run extraction with `apify_call-actor`.
5. If response includes `datasetId`, fetch full data via `apify_get-actor-output`.
6. Return either raw JSON or transformed markdown, as requested.

## Canonical `apify_call-actor` Input (Default Actor)

```json
{
  "actor": "supreme_coder/linkedin-post",
  "input": {
    "urls": ["https://www.linkedin.com/posts/..."],
    "limitPerSource": 10,
    "deepScrape": true,
    "rawData": false
  },
  "async": false,
  "previewOutput": true
}
```

Notes:
- `urls` is required.
- `scrapeUntil` is optional for date cutoff.
- Prefer `deepScrape: true` for complete engagement metadata.

## Canonical `apify_get-actor-output` Input

```json
{
  "datasetId": "<dataset-id>",
  "offset": 0,
  "limit": 100
}
```

Optional field filtering:

```json
{
  "datasetId": "<dataset-id>",
  "fields": "url,text,author,numLikes,numComments,numShares,postedAtISO",
  "offset": 0,
  "limit": 100
}
```

## Output Contract

Default return fields for each extracted post:
- `url`
- `text`
- `author`
- `numLikes`
- `numComments`
- `numShares`
- `postedAtISO`
- `images` (when present)
- `reactions` (when present)

## Error Contract

- Invalid or unsupported URL → return clear validation failure.
- Empty dataset (deleted/private post) → report as unavailable, do not fabricate content.
- Actor failure or credit issue → return the actor error and next step.

## Live Data Rule

Do not hardcode stale success rates/pricing in responses.
If user asks about cost/reliability, fetch live values with:

- `apify_fetch-actor-details` (`output.pricing=true`, `output.stats=true`)

## References

- Detailed operational templates: `/Users/zuul/.config/opencode/skills/linkedin-scraper/REFERENCE.md`

<negative_constraints>
- MUST NOT use `mcp__apify__...` tool names.
- MUST NOT include non-existent `step: "call"` in `apify_call-actor` input.
- MUST NOT run LinkedIn extraction without at least one validated LinkedIn URL.
- MUST NOT invent post content when extraction returns empty/error.
- MUST NOT report static pricing/success-rate as authoritative without live check.
</negative_constraints>

<output_shape>
- For extraction runs: return `Actor`, `Input Summary`, `Result Count`, `Key Data`, `Errors`.
- Keep response concise and operational.
- If output is empty, explicitly say `No extractable public data returned`.
</output_shape>
