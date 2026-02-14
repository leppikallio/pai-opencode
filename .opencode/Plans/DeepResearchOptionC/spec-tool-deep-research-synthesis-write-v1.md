# spec-tool-deep-research-synthesis-write-v1 (P05-05)

## Tool name
`deep_research_synthesis_write`

## Purpose
Write `synthesis/draft-synthesis.md` from bounded inputs:
- `summaries/summary-pack.json`, and
- validated citations pool (`citations.jsonl`).

The tool MUST NOT ingest raw wave output markdown.

## Inputs (args)
| Arg | Type | Required | Notes |
|---|---:|:---:|---|
| `manifest_path` | string | ✅ | absolute |
| `summary_pack_path` | string | ❌ | absolute; default: `<runRoot>/summaries/summary-pack.json` |
| `citations_path` | string | ❌ | absolute; default: `<runRoot>/citations/citations.jsonl` |
| `mode` | string | ❌ | `fixture|generate`; default `fixture` for entity tests |
| `fixture_draft_path` | string | ❌ | required for `mode=fixture`; absolute markdown file |
| `output_path` | string | ❌ | absolute; default: `<runRoot>/synthesis/draft-synthesis.md` |
| `reason` | string | ✅ | audit |

## Output requirements
- Must be markdown.
- Must use citation syntax `[@<cid>]`.
- Must include the required report sections used by Gate E.

## Required report sections (v1)
Gate E requires these headings to exist exactly (case-sensitive):
- `## Summary`
- `## Key Findings`
- `## Evidence`
- `## Caveats`

## Determinism rules
- `mode=fixture` MUST be deterministic.

## Error contract (mandatory)
On success:
```json
{ "ok": true, "output_path": ".../synthesis/draft-synthesis.md", "inputs_digest": "sha256:..." }
```

## Side effects
- Atomically writes the draft synthesis markdown.
- Best-effort audit append (`kind=synthesis_write`) to `<runRoot>/logs/audit.jsonl`.

## References
- `spec-gate-thresholds-v1.md` (Gate E)
- `deep-research-option-c-phase-05-executable-backlog.md`
