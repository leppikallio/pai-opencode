# spec-router-summary-schemas-v1 (P00-A03)

## Purpose
Defines the canonical schema for:
- router output (`perspectives.json`) and
- synthesis input (`summary-pack.json`).

This is the primary anti-context-exhaustion mechanism: synthesis reads a bounded summary pack.

---

## 1) `perspectives.json` (router output)

### File
- Path (per run, default): `~/.config/opencode/research-runs/<run_id>/perspectives.json`
- Format: JSON

### Fields (v1)
| Field | Type | Required | Notes |
|---|---:|:---:|---|
| `schema_version` | string | ✅ | fixed: `perspectives.v1` |
| `run_id` | string | ✅ | |
| `created_at` | string | ✅ | ISO |
| `perspectives` | array | ✅ | list of perspective objects |

### Perspective object
| Field | Type | Required | Notes |
|---|---:|:---:|---|
| `id` | string | ✅ | e.g. `p1` |
| `title` | string | ✅ | short label |
| `track` | string | ✅ | `standard|independent|contrarian` |
| `agent_type` | string | ✅ | must be one of existing runtime agents |
| `prompt_contract` | object | ✅ | size/tool constraints |
| `expected_platforms` | array | ❌ | optional coverage targets |

### `prompt_contract`
| Field | Type | Required | Notes |
|---|---:|:---:|---|
| `max_words` | number | ✅ | output size cap |
| `max_sources` | number | ✅ | sources cap |
| `tool_budget` | object | ✅ | e.g. search calls |
| `must_include_sections` | array | ✅ | enforce parseable structure |

### Minimal example
```json
{
  "schema_version": "perspectives.v1",
  "run_id": "dr_20260213_001",
  "created_at": "2026-02-13T12:05:00Z",
  "perspectives": [
    {
      "id": "p1",
      "title": "Technical overview",
      "track": "standard",
      "agent_type": "ClaudeResearcher",
      "prompt_contract": {
        "max_words": 900,
        "max_sources": 12,
        "tool_budget": { "search_calls": 4, "fetch_calls": 6 },
        "must_include_sections": ["Findings", "Sources", "Gaps"]
      },
      "expected_platforms": ["docs", "github", "blog"]
    }
  ]
}
```

---

## 2) `summary-pack.json` (bounded synthesis input)

### File
- Path (per run, default): `~/.config/opencode/research-runs/<run_id>/summaries/summary-pack.json`
- Format: JSON

### Fields
| Field | Type | Required | Notes |
|---|---:|:---:|---|
| `schema_version` | string | ✅ | fixed: `summary_pack.v1` |
| `run_id` | string | ✅ | |
| `generated_at` | string | ✅ | ISO |
| `limits` | object | ✅ | max sizes used |
| `summaries` | array | ✅ | per-perspective summary pointers |
| `total_estimated_tokens` | number | ✅ | estimate to enforce context budget |

Note: Gate D must be enforced using **byte/KB size** limits from `manifest.limits`, not tokenizer estimates.

### Summary entry
| Field | Type | Required | Notes |
|---|---:|:---:|---|
| `perspective_id` | string | ✅ | links to perspectives.json |
| `source_artifact` | string | ✅ | path to wave output |
| `summary_md` | string | ✅ | path to bounded markdown summary |
| `key_claims` | array | ✅ | atomic claims with citation ids |

### Key claim
| Field | Type | Required | Notes |
|---|---:|:---:|---|
| `claim` | string | ✅ | |
| `citation_cids` | array | ✅ | references `citations.jsonl` |
| `confidence` | number | ✅ | 0–100 |

### Minimal example
```json
{
  "schema_version": "summary_pack.v1",
  "run_id": "dr_20260213_001",
  "generated_at": "2026-02-13T12:40:00Z",
  "limits": { "max_summary_kb": 5, "max_total_summary_kb": 60 },
  "summaries": [
    {
      "perspective_id": "p1",
      "source_artifact": "wave-1/p1.md",
      "summary_md": "summaries/p1.summary.md",
      "key_claims": [
        { "claim": "X uses Y for Z.", "citation_cids": ["cid_abc"], "confidence": 85 }
      ]
    }
  ],
  "total_estimated_tokens": 4200
}
```

## Evidence (P00-A03)
This file defines both JSON schemas and includes concrete examples + size enforcement fields.
