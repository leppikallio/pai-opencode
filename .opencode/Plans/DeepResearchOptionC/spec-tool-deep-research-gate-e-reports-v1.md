# spec-tool-deep-research-gate-e-reports-v1 (P06-05)

## Purpose
Define the **deterministic, offline-first Gate E evidence reports** that make Gate E mechanically computable and replayable.

This spec defines report schemas and computation rules for:
1) numeric-claim citation compliance (hard metric: `uncited_numeric_claims`)
2) required-sections presence (hard metric: `report_sections_present`)
3) citation utilization + duplicate pressure (soft metrics)

Non-goals:
- Do **not** change Gate E metrics, formulas, names, or thresholds.
- Do **not** perform any network access.

## Inputs (artifacts)
All paths are relative to `manifest.artifacts.root` unless absolute paths are supplied.

Required inputs:
- `synthesis/final-synthesis.md`
- `citations/citations.jsonl`

## Authoritative Gate E definitions (MUST NOT change)

Gate E is defined in:
- `spec-gate-thresholds-v1.md` (formulas + thresholds)
- `spec-reviewer-rubrics-v1.md` (evidence checklist)

### Gate E formulas (EXACT COPY)
The following lines are copied verbatim from `spec-gate-thresholds-v1.md` and MUST match exactly:

- Report citation syntax (required): `[@<cid>]` where `<cid>` is from `citations.jsonl`.
- `validated_cids_count` = count of unique `cid` where `status IN {"valid","paywalled"}`.
- `used_cids_count` = count of unique `<cid>` occurrences in the report.
- `citation_utilization_rate` = `used_cids_count / validated_cids_count`.
- `total_cid_mentions` = total count of `[@<cid>]` mentions in the report.
- `duplicate_citation_rate` = `1 - (used_cids_count / total_cid_mentions)`.

### Gate E warning codes (contract)

Warning strings are treated as part of the regression contract:

- `LOW_CITATION_UTILIZATION` — emitted when `citation_utilization_rate` fails its soft threshold.
- `HIGH_DUPLICATE_CITATION_RATE` — emitted when `duplicate_citation_rate` fails its soft threshold.

Notes:
- Warning emission MUST NOT change Gate E pass/fail (hard metrics decide status).
- Warning list ordering MUST be deterministic (sort lexicographically).

## Deterministic parsing rules (v1)

### A) Citation token extraction

1. Scan `synthesis/final-synthesis.md` for exact citation syntax:
   - pattern: `\[@([A-Za-z0-9_:-]+)\]`
2. Extract `<cid>` from group 1 and trim it.
3. A mention counts only if extracted cid is non-empty.

Notes:
- Matching is case-sensitive.
- This matches the existing Phase 05 `deep_research_gate_e_evaluate` entity tests.

### B) Validated cid set

From `citations/citations.jsonl`:
- parse each JSONL line into an object
- `validated_cids = unique(cid) where status in {"valid","paywalled"}`

## Required report sections (v1)

Gate E hard metric requires `report_sections_present = 100%`.

This implementation uses the required headings list (case-sensitive, exact line match):
- `## Summary`
- `## Key Findings`
- `## Evidence`
- `## Caveats`

Presence rule:
- a heading is present if the markdown contains the exact line.

Computation:
- `report_sections_present = floor(100 * present / required)`

## Numeric-claim checker (v1)

Goal: count numeric claims that lack an in-paragraph citation.

Heuristic (deterministic, offline, v1):
- Scan each non-empty line (excluding code fences) for numeric tokens matching:
  - `-?\d+(?:\.\d+)?%?`
- Ignore:
  - ordered list markers at the start of a line: `^\s*\d+\.\s+`
- A numeric token is considered **cited** if the same paragraph (blank-line delimited) contains at least one `[@<cid>]` token.

Outputs must include findings with stable ordering for reproducibility.

## Output artifacts (canonical)
Reports are written under:
- `reports/` directory

All outputs MUST be deterministic:
- stable JSON key order (lexicographic)
- stable array ordering (as specified)
- newline-terminated files

### 1) `reports/gate-e-numeric-claims.json`

Schema: `gate_e.numeric_claims_report.v1`

Required fields:
- `schema_version`
- `metrics.uncited_numeric_claims` (number)
- `findings[]` ordered by `(line asc, col asc)`

### 2) `reports/gate-e-sections-present.json`

Schema: `gate_e.sections_present_report.v1`

Required fields:
- `schema_version`
- `required_headings[]` (fixed list above)
- `present_headings[]` (sorted lexicographically)
- `missing_headings[]` (sorted lexicographically)
- `metrics.report_sections_present` (number)

### 3) `reports/gate-e-citation-utilization.json`

Schema: `gate_e.citation_utilization_report.v1`

Required fields:
- `schema_version`
- `metrics.validated_cids_count`
- `metrics.used_cids_count`
- `metrics.total_cid_mentions`
- `metrics.citation_utilization_rate`
- `metrics.duplicate_citation_rate`
- `cids.validated_cids[]` (sorted lexicographically)
- `cids.used_cids[]` (sorted lexicographically)

Division-by-zero rules:
- if `validated_cids_count == 0`, set `citation_utilization_rate = 0`
- if `total_cid_mentions == 0`, set `duplicate_citation_rate = 1`

### 4) `reports/gate-e-status.json`

Schema: `gate_e.status_report.v1`

Purpose:
- Provide a single deterministic summary of Gate E outcome for harness/regression use.
- MUST NOT redefine any Gate E formulas or thresholds.

Required fields:
- `schema_version`
- `status` (string): `pass|fail`
- `warnings` (array of strings; MAY be empty; MUST be present; sorted lexicographically)
- `hard_metrics` (object):
  - `uncited_numeric_claims` (number)
  - `report_sections_present` (number)
- `soft_metrics` (object):
  - `citation_utilization_rate` (number)
  - `duplicate_citation_rate` (number)

## Worked example (minimal)

Given:
- validated cids: 5
- report uses 3 unique cids
- total cid mentions: 6

Then:
- `citation_utilization_rate = 3 / 5 = 0.6`
- `duplicate_citation_rate = 1 - (3 / 6) = 0.5`

If the report contains one numeric claim in a paragraph with no citation token, then:
- `uncited_numeric_claims = 1`

## References
- `spec-gate-thresholds-v1.md` (Gate E formulas + thresholds)
- `spec-reviewer-rubrics-v1.md` (Gate E evidence checklist)
- `deep-research-option-c-phase-06-executable-backlog.md` (P06-05)
