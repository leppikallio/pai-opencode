# linkedin-scraper Reference (OpenCode Accurate)

This file contains copy-ready, low-ambiguity templates that match current OpenCode Apify tools.

## 1) Tool Interface Cheatsheet (Exact)

### `apify_search-actors`

Required parameters:

```json
{
  "limit": 10,
  "offset": 0,
  "keywords": "LinkedIn posts",
  "category": ""
}
```

### `apify_fetch-actor-details`

Minimal:

```json
{
  "actor": "supreme_coder/linkedin-post"
}
```

Live pricing/stats:

```json
{
  "actor": "supreme_coder/linkedin-post",
  "output": {
    "pricing": true,
    "stats": true,
    "inputSchema": true,
    "description": true
  }
}
```

### `apify_call-actor`

Default extraction:

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

Important:
- Do not send `step: "call"`.
- In UI mode, `async` may be enforced to true by the platform.

### `apify_get-actor-output`

```json
{
  "datasetId": "<dataset-id>",
  "offset": 0,
  "limit": 100
}
```

Field selection example:

```json
{
  "datasetId": "<dataset-id>",
  "fields": "url,text,author,numLikes,numComments,numShares,postedAtISO",
  "offset": 0,
  "limit": 100
}
```

---

## 2) Canonical Runbooks

### Runbook A: Single LinkedIn Post URL

1. Validate URL contains `linkedin.com/posts/`.
2. Call actor:

```json
{
  "actor": "supreme_coder/linkedin-post",
  "input": {
    "urls": ["<post-url>"],
    "limitPerSource": 1,
    "deepScrape": true,
    "rawData": false
  },
  "async": false,
  "previewOutput": true
}
```

3. If full output not returned inline, fetch by `datasetId` via `apify_get-actor-output`.

### Runbook B: Profile URL (Recent Posts)

Use default actor unless user asks profile-details actor explicitly.

```json
{
  "actor": "supreme_coder/linkedin-post",
  "input": {
    "urls": ["<profile-url>"],
    "limitPerSource": 25,
    "deepScrape": true,
    "rawData": false
  },
  "async": false,
  "previewOutput": true
}
```

Optional time window:

```json
{
  "actor": "supreme_coder/linkedin-post",
  "input": {
    "urls": ["<profile-url>"],
    "limitPerSource": 50,
    "scrapeUntil": "2026-01-01",
    "deepScrape": true,
    "rawData": false
  },
  "async": false,
  "previewOutput": true
}
```

### Runbook C: Company URL (Company Posts)

```json
{
  "actor": "supreme_coder/linkedin-post",
  "input": {
    "urls": ["<company-url>"],
    "limitPerSource": 30,
    "deepScrape": true,
    "rawData": false
  },
  "async": false,
  "previewOutput": true
}
```

### Runbook D: LinkedIn Content Search URL

If user provides LinkedIn search URL (`/search/results/content/`):

```json
{
  "actor": "supreme_coder/linkedin-post",
  "input": {
    "urls": ["<linkedin-content-search-url>"],
    "limitPerSource": 100,
    "deepScrape": true,
    "rawData": false
  },
  "async": false,
  "previewOutput": true
}
```

### Runbook E: Explicit Alternate Actor Usage

Use only when user asks for these specifically:

- `apimaestro/linkedin-profile-detail`
- `apimaestro/linkedin-profile-posts`
- `apimaestro/linkedin-company-posts`
- `harvestapi/linkedin-post-search`

Before first use in a task, fetch schema:

```json
{
  "actor": "<actor-id>",
  "output": { "inputSchema": true, "pricing": true, "stats": true }
}
```

Then call with the exact schema requirements returned.

---

## 3) Deterministic Decision Matrix

| Input from user | Actor | Why |
|---|---|---|
| Single post URL | `supreme_coder/linkedin-post` | Lowest-friction default |
| List of mixed LinkedIn URLs | `supreme_coder/linkedin-post` | Handles mixed sources |
| Profile URL + "give profile details" | `apimaestro/linkedin-profile-detail` | Details-focused actor |
| Company URL + "company feed only" | `apimaestro/linkedin-company-posts` | Company-focused feed actor |
| Keyword search workflow | `harvestapi/linkedin-post-search` or default actor with LinkedIn search URL | Search-centric extraction |

Default to `supreme_coder/linkedin-post` when ambiguous.

---

## 4) Standard Response Shape After Extraction

Use this structure to keep outputs predictable:

1. **Actor**: actor id used
2. **Input Summary**: number of URLs, limitPerSource, deepScrape
3. **Result Count**: items returned
4. **Key Data**: compact list of post URL + author + engagement
5. **Errors**: per-URL failures, if any

If no rows are returned, state:
`No extractable public data returned for the provided LinkedIn URL(s).`

---

## 5) Non-Negotiable Accuracy Rules

- Never use `mcp__apify__...` aliases in this runtime documentation.
- Never use underscore forms (`call_actor`, `get_actor_output`, `fetch_actor_details`).
- Never include `step: "call"` in `apify_call-actor` payloads.
- Never claim fixed pricing/success rates without a live `apify_fetch-actor-details` check.
- Never fabricate missing LinkedIn content when output is empty.

---

## 6) Quick Validation Checklist (Before Saying “Done”)

1. Tool names match OpenCode (`apify_*`).
2. `apify_call-actor` payload excludes unsupported keys.
3. `apify_get-actor-output` includes `datasetId`, `offset`, `limit`.
4. Actor IDs are valid (verify via `apify_fetch-actor-details` if uncertain).
5. Response includes explicit error reporting for failed URLs.
