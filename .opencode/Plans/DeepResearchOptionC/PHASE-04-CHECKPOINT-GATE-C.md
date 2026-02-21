# Phase 04 Checkpoint — Gate C Signoff

Date: 2026-02-14

## Scope
Phase 04 — Citation and evidence services (**Gate C**) for Deep Research Option C.

Goal: make citation extraction/normalization/validation and Gate C scoring **offline-first**, **deterministic**, and **fixture-testable**, while preserving the semantic model for real-world runs:
- `valid` and `paywalled` count as validated (paywalled is **caution but usable**).
- `invalid`, `blocked`, and `mismatch` count as invalid.
- Every extracted URL must have exactly one status.

## Phase 04 backlog status (P04-01..P04-X1)
Source backlog: `deep-research-option-c-phase-04-executable-backlog.md`

| ID | Backlog item | Status | Evidence |
|---|---|---|---|
| P04-01 | URL extraction contract | ✅ Done | `spec-tool-deep-research-citations-extract-urls-v1.md` |
| P04-02 | Tool: citations_extract_urls | ✅ Done | `.opencode/tools/deep_research_cli.ts` (`export const citations_extract_urls`) + entity test `deep_research_citations_extract_urls.test.ts` |
| P04-03 | Normalize + cid contract | ✅ Done | `spec-tool-deep-research-citations-normalize-v1.md` + `spec-citation-schema-v1.md` |
| P04-04 | Tool: citations_normalize | ✅ Done | `.opencode/tools/deep_research_cli.ts` (`export const citations_normalize`) + entity test `deep_research_citations_normalize.test.ts` |
| P04-05 | Validation contract (OFFLINE vs ONLINE, ladder) | ✅ Done | `spec-tool-deep-research-citations-validate-v1.md` (Bright Data → Apify ladder + paywalled semantics) |
| P04-06 | Tool: citations_validate (OFFLINE fixtures) | ✅ Done | `.opencode/tools/deep_research_cli.ts` (`export const citations_validate`) + entity test `deep_research_citations_validate.test.ts` |
| P04-07 | Gate C compute contract | ✅ Done | `spec-tool-deep-research-gate-c-compute-v1.md` + `spec-gate-thresholds-v1.md` |
| P04-08 | Tool: gate_c_compute | ✅ Done | `.opencode/tools/deep_research_cli.ts` (`export const gate_c_compute`) + entity test `deep_research_gate_c_compute.test.ts` |
| P04-09 | Tool: citations_render_md | ✅ Done | `.opencode/tools/deep_research_cli.ts` (`export const citations_render_md`) + entity test `deep_research_citations_render_md.test.ts` |
| P04-T* | Phase 04 entity tests + fixtures | ✅ Done | `bun test tests` (see Evidence) + fixtures under `.opencode/tests/fixtures/citations/phase04/` |
| P04-X1 | Phase 04 checkpoint + Gate C signoff | ✅ Done | This document |

## Gate C criteria (Phase 04)
Gate C is defined in:
- `spec-gate-thresholds-v1.md` (Gate C formulas + thresholds)
- `spec-reviewer-rubrics-v1.md` (Gate C evidence checklist)
- `spec-stage-machine-v1.md` (citations → summaries blocked unless Gate C pass)

**Criteria:**
1. Deterministic citation pipeline exists and is fixture-testable offline.
2. `paywalled` is supported as “validated enough but caution” and counts toward `validated_url_rate`.
3. Gate C metrics match the formulas in `spec-gate-thresholds-v1.md`.

## Evidence

### Tests (full suite)
Command (run in `.opencode/`):
```bash
bun test tests
37 pass, 0 fail
```

### Targeted Phase 04 entity tests (run at repo root)
```bash
bun test ./.opencode/tests/entities/deep_research_citations_phase04.test.ts
2 pass, 0 fail

bun test ./.opencode/tests/entities/deep_research_gate_c_compute.test.ts
1 pass, 0 fail
```

### Fixture pointers (Gate C boundary case)
- Extracted URLs set (10 URLs):
  - `.opencode/tests/fixtures/citations/phase04/gate-c/extracted-urls.txt`
- Citations pool including `paywalled` + boundary invalid rate:
  - `.opencode/tests/fixtures/citations/phase04/gate-c/citations.jsonl`

## Notes / follow-ups
1. `citations_validate` ONLINE mode currently produces stub statuses (no network calls); the escalation ladder is specified in docs and intentionally not executed in-tool yet.
2. Provenance (`found_by.agent_type`) is currently defaulted to `"unknown"` unless richer provenance is provided.

## Signoff
Gate C for Phase 04 is **PASSED** for the offline-first deterministic tooling + tests, with ONLINE ladder implementation tracked as follow-up work.
