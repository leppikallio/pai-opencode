# spec-citation-schema-v1 (P00-A04)

## Purpose
Defines the canonical **citation record** format (`citations.jsonl`).

This is how we prevent “phantom citations” and enforce:
- validation before synthesis,
- provenance tracking,
- utilization measurement.

## File
- Path (per run, default): `~/.config/opencode/research-runs/<run_id>/citations/citations.jsonl`
- Format: JSON Lines (one record per line)

## Record fields (v1)
| Field | Type | Required | Notes |
|---|---:|:---:|---|
| `schema_version` | string | ✅ | fixed: `citation.v1` |
| `normalized_url` | string | ✅ | canonicalized URL used for cid computation |
| `cid` | string | ✅ | `cid_` + 64-char **lowercase** hex SHA-256 of **UTF-8 bytes** of `normalized_url` |
| `url` | string | ✅ | canonical URL after redirects |
| `url_original` | string | ✅ | as extracted from wave output |
| `status` | string | ✅ | `valid|invalid|mismatch|paywalled|blocked` (see Gate C semantics) |
| `checked_at` | string | ✅ | ISO |
| `http_status` | number | ❌ | if available |
| `title` | string | ❌ | best-effort |
| `publisher` | string | ❌ | best-effort |
| `found_by` | array | ✅ | provenance pointers |
| `evidence_snippet` | string | ❌ | quote or short excerpt |
| `notes` | string | ✅ | diagnostics |

## Gate C semantics (how `status` is used)

Gate C (citation validation integrity) requires that **every extracted URL** has exactly one status.

Status meanings (v1):
- `valid`: URL reachable and content can be fetched sufficiently to extract at least basic metadata/snippet.
- `paywalled`: URL is a legitimate/reputable target but content is behind a paywall or access barrier; treat as **caution** (can be cited, but semantic verification may be limited).
- `blocked`: URL appears legitimate, but validation was blocked by bot-detection or access denial after escalation.
- `mismatch`: URL reachable but content does not match the citation context (wrong page / redirect mismatch).
- `invalid`: URL malformed, dead, or definitively unusable.

Implementation note:
- When using online validation, the validator MUST use a tool escalation ladder (see Phase 04 plan + Bright Data workflow) before setting `blocked` or `invalid`.

Downstream usage policy:
- Synthesis may cite `valid` and `paywalled` sources.
- Synthesis must not cite `invalid`, `blocked`, or `mismatch` sources.
- Final report should mark `paywalled` citations as **caution** (operator-visible).

### `found_by[]` entry
| Field | Type | Required | Notes |
|---|---:|:---:|---|
| `wave` | number | ✅ | 1 or 2 |
| `perspective_id` | string | ✅ | |
| `agent_type` | string | ✅ | |
| `artifact_path` | string | ✅ | path to wave output |

## Normalization + cid rules (deterministic)

### normalized_url
Compute `normalized_url` from `url_original` by applying these steps in order:
1. Parse the URL (must be absolute).
2. Lowercase scheme and host.
3. Remove the fragment (`#...`).
4. Remove tracking query params by exact rules:
   - remove any key starting with `utm_`
   - remove keys: `gclid`, `fbclid`
5. Sort remaining query params lexicographically by key, then by value.
6. Normalize default ports:
   - remove `:80` for `http`, remove `:443` for `https`.
7. Normalize trailing slash:
   - if path is `/`, keep `/`
   - otherwise, remove a trailing `/`.

### cid
Compute:
- `cid = "cid_" + sha256_hex_lower(utf8(normalized_url))`

Where `sha256_hex_lower` returns exactly **64 lowercase hex characters**.

No other normalization is permitted.

## Example records

### Valid
```json
{"schema_version":"citation.v1","normalized_url":"https://example.com/doc","cid":"cid_<sha256>","url":"https://example.com/doc","url_original":"https://example.com/doc?utm_source=x","status":"valid","checked_at":"2026-02-13T12:35:00Z","http_status":200,"title":"Example Doc","publisher":"Example","found_by":[{"wave":1,"perspective_id":"p1","agent_type":"ClaudeResearcher","artifact_path":"wave-1/p1.md"}],"evidence_snippet":"This doc states ...","notes":"ok"}
```

### Invalid
```json
{"schema_version":"citation.v1","normalized_url":"https://dead.example.com","cid":"cid_<sha256>","url":"https://dead.example.com","url_original":"https://dead.example.com","status":"invalid","checked_at":"2026-02-13T12:35:00Z","http_status":404,"title":null,"publisher":null,"found_by":[{"wave":1,"perspective_id":"p2","agent_type":"PerplexityResearcher","artifact_path":"wave-1/p2.md"}],"evidence_snippet":null,"notes":"404"}
```

## Evidence (P00-A04)
This file includes:
- full field table,
- provenance schema,
- normalization rules,
- concrete JSONL examples.
