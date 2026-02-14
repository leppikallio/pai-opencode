# spec-gate-thresholds-v1 (P00-B01)

## Purpose
Defines Gate A–F as **measurable, testable criteria**.

Each gate has:
- classification: hard/soft,
- metrics and thresholds,
- required artifacts,
- pass/fail examples.

## Gate A — Planning completeness (HARD)

### Required artifacts
- `spec-manifest-schema-v1.md`
- `spec-gates-schema-v1.md`
- `spec-router-summary-schemas-v1.md`
- `spec-citation-schema-v1.md`
- `spec-reviewer-rubrics-v1.md`
- `spec-pause-resume-v1.md`

### Pass criteria
- All schemas exist, versioned `v1`, and have at least one valid example.
- Rubrics exist for each gate.
- Pause/resume SOP includes exact read order + checkpoint template.

### Fail example
- `manifest.json` fields defined but no invariants or stage list.

## Gate B — Wave output contract compliance (HARD)

### Required artifacts
- `perspectives.json` (defines required sections per perspective)
- `wave-1/*.md` (and `wave-2/*.md` if Wave 2 ran)
- A deterministic validator report (tool output) computing the metrics below

### Definitions (deterministic)
- A wave output is **parseable** if it contains *all* required sections listed in its perspective’s `prompt_contract.must_include_sections`.
- A required section is present if the wave output contains the exact markdown heading:
  - `## <SectionName>` (case-sensitive match)

### Metrics
| Metric | Threshold |
|---|---:|
| `% outputs parseable (hard)` | >= 80% |
| `% outputs parseable (target)` | >= 95% |
| `% outputs include Sources section (hard)` | >= 80% |
| `% outputs include Sources section (target)` | >= 98% |
| `max outputs missing` | <= 1 per run |

### Pass criteria
- The gate **passes** if hard thresholds pass.
- If target thresholds fail but hard thresholds pass, the gate remains `pass` but emits `warnings[]`.
- Non-conforming outputs trigger controlled retry policy.

## Gate C — Citation validation integrity (HARD)

### Required artifacts
- `citations/citations.jsonl`
- `citations/extracted-urls.txt` (or equivalent extracted list)

### Metrics
| Metric | Threshold |
|---|---:|
| `validated_url_rate` | >= 0.90 |
| `invalid_url_rate` | <= 0.10 |
| `uncategorized_url_rate` | 0.00 |

### Metric formulas (deterministic)
Let `U` = the set of extracted URLs after normalization/deduplication (one entry per `normalized_url`).
Let each `u ∈ U` have exactly one status in `citations/citations.jsonl`.

Allowed statuses (v1):
- `valid|paywalled|invalid|blocked|mismatch`

- `validated_url_rate` = `count(u where status IN {"valid","paywalled"}) / count(U)`
- `invalid_url_rate` = `count(u where status IN {"invalid","blocked","mismatch"}) / count(U)`
- `uncategorized_url_rate` = `count(u where status NOT IN {"valid","paywalled","invalid","blocked","mismatch"}) / count(U)`

Rules:
- The gate MUST FAIL if any extracted URL has missing status (treated as uncategorized).
- `count(U)` MUST be > 0; otherwise the gate fails with reason `NO_URLS_EXTRACTED`.

### Pass criteria
- `citations.jsonl` produced with status for every extracted URL.
- Synthesis stage blocks if gate fails.

## Gate D — Summary pack boundedness (HARD)

### Required artifacts
- `manifest.json` (for limits)
- `summaries/summary-pack.json`
- `summaries/*.md`

### Metrics
| Metric | Threshold |
|---|---:|
| `summary_count / expected` | >= 0.90 |
| `max_summary_kb` | <= `manifest.limits.max_summary_kb` |
| `total_summary_pack_kb` | <= `manifest.limits.max_total_summary_kb` |

### Pass criteria
- Summary pack is the only synthesis input besides validated citations.

## Gate E — Synthesis quality (HARD with warnings)

### Required artifacts
- `synthesis/final-synthesis.md`
- `citations/citations.jsonl` (validated pool)
- A deterministic citation utilization report (tool output)

### Hard metrics
| Metric | Threshold |
|---|---:|
| `uncited_numeric_claims` | 0 |
| `report_sections_present` | 100% |

### Soft metrics
| Metric | Threshold |
|---|---:|
| `citation_utilization_rate` | >= 0.60 |
| `duplicate_citation_rate` | <= 0.20 |

### Soft metric formulas (deterministic)
- Report citation syntax (required): `[@<cid>]` where `<cid>` is from `citations.jsonl`.
- `validated_cids_count` = count of unique `cid` where `status IN {"valid","paywalled"}`.
- `used_cids_count` = count of unique `<cid>` occurrences in the report.
- `citation_utilization_rate` = `used_cids_count / validated_cids_count`.
- `total_cid_mentions` = total count of `[@<cid>]` mentions in the report.
- `duplicate_citation_rate` = `1 - (used_cids_count / total_cid_mentions)`.

### Pass criteria
- Hard metrics pass.
- Soft metric failures must appear as warnings in final output.

## Gate F — Rollout safety (HARD)

### Required artifacts
- `spec-feature-flags-v1.md`
- Rollout playbook + rollback triggers (Phase 07 deliverables)

### Pass criteria
- Feature flags exist for enable/disable and caps.
- Canary plan exists with rollback triggers.
- Fallback to standard research workflow is documented and tested.

## Evidence (P00-B01)
This file defines all gates with:
- required artifacts,
- measurable thresholds,
- pass/fail examples.
