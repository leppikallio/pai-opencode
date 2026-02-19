# spec-tool-deep-research-citations-validate-v1 (P04-05)

## Tool name
`deep_research_citations_validate`

## Purpose
Validate normalized URLs and produce `citations/citations.jsonl` conforming to `spec-citation-schema-v1.md`.

OFFLINE mode is deterministic and fixture-driven.
ONLINE mode is optional and uses strict URL safety rules plus a progressive escalation ladder.

## Inputs (args)
| Arg | Type | Required | Notes |
|---|---:|:---:|---|
| `manifest_path` | string | ✅ | absolute |
| `url_map_path` | string | ❌ | absolute; default: `<runRoot>/citations/url-map.json` |
| `citations_path` | string | ❌ | absolute; default: `<runRoot>/citations/citations.jsonl` |
| `offline_fixtures_path` | string | ❌ | absolute JSON (required in OFFLINE mode) |
| `reason` | string | ✅ | audit |

## Mode selection
- Mode selection is resolved from run artifacts, not process environment.
- Primary source: `run-config.json` (`effective.citations.mode`).
- Fallback source: `manifest.query.sensitivity` mapping:
  - `no_web` -> `offline`
  - `restricted` -> `online` (restricted ladder/caps)
  - `normal` -> `online`

Thoroughness is controlled by:
- `run-config.json` (`effective.citations.validation_tier=basic|standard|thorough`).
- If absent, use init-captured defaults from manifest/settings snapshots.

## Status semantics (v1)
Allowed statuses:
- `valid`: reachable and sufficient content fetched to populate metadata/snippet.
- `paywalled`: reachable but access barrier prevents full content; still a plausible/reputable source.
- `blocked`: plausibly valid but inaccessible after escalation.
- `mismatch`: reachable but clearly wrong/unrelated content.
- `invalid`: malformed/disallowed URL or definitive dead link.

Downstream rules:
- Synthesis MAY cite `valid` and `paywalled`.
- Synthesis MUST NOT cite `invalid`, `blocked`, or `mismatch`.

## URL safety (SSRF) policy (ONLINE mode)
The tool MUST enforce:
1. Allow only `http` and `https`.
2. Deny any URL containing userinfo.
3. Deny localhost and private-network targets (direct IP or resolved IP):
   - IPv4: `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`.
   - IPv6: `::1/128`, `fc00::/7`, `fe80::/10`.
4. Redirect validation:
   - max 5 hops,
   - validate every hop against this same policy.
5. Timeouts/size caps (defaults, v1):
   - <= 5s per hop,
   - <= 2 MB body.

## Redaction policy (all modes)
The tool MUST NOT store or log credential-bearing URLs.

Required:
- strip userinfo (and mark record `invalid`),
- redact sensitive query parameter values (case-insensitive key contains):
  `token`, `key`, `api_key`, `access_token`, `auth`, `session`, `password`.

## ONLINE escalation ladder (Bright Data → Apify)
Before assigning `blocked`, the tool MUST attempt:
1. Direct fetch (SSRF-safe)
2. Bright Data progressive scrape (Four-tier) per the `bright-data` skill
3. Apify retrieval fallback (e.g., `apify/rag-web-browser`)

If all three fail to retrieve meaningful content:
- assign `blocked` (not `invalid`) unless URL is clearly malformed or violates safety rules.

## Determinism requirements
- OFFLINE mode MUST be deterministic and fixture-driven.
- All output records MUST be written sorted by `normalized_url`.

## Outputs
| Field | Type | Required |
|---|---:|:---:|
| `ok` | boolean | ✅ |
| `run_id` | string | ✅ |
| `citations_path` | string | ✅ |
| `mode` | string | ✅ | `offline|online` |
| `validated` | number | ✅ | records written |
| `inputs_digest` | string | ✅ |

## Error contract (mandatory)
On success:
```json
{ "ok": true, "run_id": "dr_...", "citations_path": "...", "mode": "offline", "validated": 9, "inputs_digest": "sha256:..." }
```

On expected failures:
```json
{ "ok": false, "error": { "code": "INVALID_ARGS", "message": "offline_fixtures_path required in OFFLINE mode", "details": {} } }
```

## Side effects
- Atomically writes `citations.jsonl`.
- Best-effort audit append (`kind=citations_validate`) to `<runRoot>/logs/audit.jsonl`.

## Failure modes
| Error | When |
|---|---|
| `INVALID_ARGS` | required args empty; any path not absolute |
| `NOT_FOUND` | required file missing |
| `INVALID_JSON` | manifest/url-map/fixtures unreadable JSON |
| `SCHEMA_VALIDATION_FAILED` | manifest/url-map/citation records fail schema |
| `WRITE_FAILED` | cannot write citations.jsonl |

## Acceptance criteria
- OFFLINE tests can validate URLs without any network.
- ONLINE mode obeys SSRF + redaction, and uses Bright Data then Apify before `blocked`.

## References
- `spec-citation-schema-v1.md`
- `spec-feature-flags-v1.md`
- `spec-gate-thresholds-v1.md` (Gate C)
- `bright-data` skill
- `apify` skill
