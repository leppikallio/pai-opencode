# Phase 05 Executable Backlog — Bounded Synthesis, Reviewer Factory, Gate D/E

## Objective

Build the **offline-first, fixture-driven** Phase 05 pipeline that turns validated wave evidence + validated citations into a **bounded summary pack**, then produces a **synthesis draft**, runs a **deterministic reviewer factory**, and converges (or escalates) via a bounded revision loop.

This phase operationalizes:
- **WS-05A** summary pack generators (bounded, size-capped)
- **WS-05B** synthesis writer (summary-pack-only input)
- **WS-05C** reviewer factory (parallel checks + deterministic pass/fail)
- **WS-05D** revision controller (bounded iterations, explicit escalation)

## Dependencies

- Phase 04 citation gate operational:
  - `~/.config/opencode/research-runs/<run_id>/citations/citations.jsonl` exists and Gate C passes.
- Summary pack schema is authoritative (do not reinvent):
  - `spec-router-summary-schemas-v1.md` (`summary_pack.v1`)
- Gate definitions + thresholds are authoritative:
  - `spec-gate-thresholds-v1.md` (must match Gate D + Gate E)
- Reviewer evidence expectations are authoritative:
  - `spec-reviewer-rubrics-v1.md` (Gate D rubric + Gate E rubric)
- Stage machine constraints (ordering + block behavior):
  - `spec-stage-machine-v1.md` (summaries → synthesis requires Gate D pass; review → finalize requires Gate E hard metrics pass)
- Offline-first testing strategy requirement:
  - entity tests must be **fixture-driven** and seconds-fast; no network; no real agent execution in tests.

## Gate

### Gate D — Summary pack boundedness (HARD)

Per-run artifact paths in this system:
- `~/.config/opencode/research-runs/<run_id>/manifest.json`
- `~/.config/opencode/research-runs/<run_id>/summaries/summary-pack.json`
- `~/.config/opencode/research-runs/<run_id>/summaries/*.md`

> ## Gate D — Summary pack boundedness (HARD)
>
> ### Required artifacts
> - `manifest.json` (for limits)
> - `summaries/summary-pack.json`
> - `summaries/*.md`
>
> ### Metrics
> | Metric | Threshold |
> |---|---:|
> | `summary_count / expected` | >= 0.90 |
> | `max_summary_kb` | <= `manifest.limits.max_summary_kb` |
> | `total_summary_pack_kb` | <= `manifest.limits.max_total_summary_kb` |
>
> ### Pass criteria
> - Summary pack is the only synthesis input besides validated citations.

Reviewer evidence expectations (Gate D rubric):
- `summaries/summary-pack.json`
- Byte/KB size report for summary pack and per-summary files
- `gates.json` excerpt showing Gate D status

### Gate E — Synthesis quality (HARD with warnings)

Per-run artifact paths in this system:
- `~/.config/opencode/research-runs/<run_id>/synthesis/final-synthesis.md`
- `~/.config/opencode/research-runs/<run_id>/citations/citations.jsonl`

> ## Gate E — Synthesis quality (HARD with warnings)
>
> ### Required artifacts
> - `synthesis/final-synthesis.md`
> - `citations/citations.jsonl` (validated pool)
> - A deterministic citation utilization report (tool output)
>
> ### Hard metrics
> | Metric | Threshold |
> |---|---:|
> | `uncited_numeric_claims` | 0 |
> | `report_sections_present` | 100% |
>
> ### Soft metrics
> | Metric | Threshold |
> |---|---:|
> | `citation_utilization_rate` | >= 0.60 |
> | `duplicate_citation_rate` | <= 0.20 |
>
> ### Soft metric formulas (deterministic)
> - Report citation syntax (required): `[@<cid>]` where `<cid>` is from `citations.jsonl`.
> - `validated_cids_count` = count of unique `cid` where `status IN {"valid","paywalled"}`.
> - `used_cids_count` = count of unique `<cid>` occurrences in the report.
> - `citation_utilization_rate` = `used_cids_count / validated_cids_count`.
> - `total_cid_mentions` = total count of `[@<cid>]` mentions in the report.
> - `duplicate_citation_rate` = `1 - (used_cids_count / total_cid_mentions)`.
>
> ### Pass criteria
> - Hard metrics pass.
> - Soft metric failures must appear as warnings in final output.

Reviewer evidence expectations (Gate E rubric):
- `synthesis/final-synthesis.md`
- Numeric-claim check output proving `uncited_numeric_claims = 0`
- Citation utilization report output (with utilization + duplicate rate)
- `gates.json` excerpt showing Gate E status + warnings (if any)

## Backlog (Owner/Reviewer mapped)

| ID | Task | Owner | Reviewer | Dependencies | Deliverable | Evidence |
|---|---|---|---|---|---|---|
| P05-01 | Define deterministic **summary pack build** contract: inputs are validated wave outputs + `citations/citations.jsonl` + `manifest.json`; output is `summary_pack.v1` + per-perspective bounded markdown summaries; stable ordering; **no raw wave dumps** into synthesis | Architect | Engineer | Phase 04 (Gate C pass) + `spec-router-summary-schemas-v1.md` + `spec-gate-thresholds-v1.md` | `spec-tool-deep-research-summary-pack-build-v1.md` | Spec cites `summary_pack.v1` fields, defines ordering + byte/KB cap rules, includes at least one valid example |
| P05-02 | Implement tool: `deep_research_summary_pack_build` (writes `~/.config/opencode/research-runs/<run_id>/summaries/summary-pack.json` + `summaries/*.md`) | Engineer | Architect | P05-01 | Tool implementation + schema-conformant artifacts under `~/.config/opencode/research-runs/<run_id>/summaries/` | Fixture run produces `summary-pack.json` with `schema_version="summary_pack.v1"` and summaries referencing citation cids (not raw URLs) |
| P05-T1 | Add entity tests + fixtures for `deep_research_summary_pack_build` (size caps enforced; stable ordering; schema validation) | Engineer | QATester | P05-02 | `.opencode/tests/entities/deep_research_summary_pack_build.test.ts` + fixtures | `bun test .opencode/tests/entities/deep_research_summary_pack_build.test.ts` passes (offline, seconds-fast) |
| P05-03 | Define **Gate D evaluator** contract: compute Gate D metrics deterministically from `manifest.json` + summary artifacts; emit gate report + gate status update payload | Architect | Engineer | `spec-gate-thresholds-v1.md` + `spec-reviewer-rubrics-v1.md` | `spec-tool-deep-research-gate-d-evaluate-v1.md` | Spec reproduces Gate D metric names exactly and includes pass/fail examples and output JSON example |
| P05-04 | Implement tool: `deep_research_gate_d_evaluate` (reads `manifest.json`, `summaries/summary-pack.json`, `summaries/*.md`; emits byte/KB report + Gate D status/warnings) | Engineer | Architect | P05-03 + P05-02 | `~/.config/opencode/research-runs/<run_id>/reports/gate-d.json` (or equivalent) + `gates.json` update payload | Tool output shows: `summary_count / expected`, `max_summary_kb`, `total_summary_pack_kb`, plus pass/fail aligned to Gate D thresholds |
| P05-T2 | Add entity tests + fixtures for `deep_research_gate_d_evaluate` (missing summary; oversize; totalsize overflow; expected-count mismatch) | Engineer | QATester | P05-04 | `.opencode/tests/entities/deep_research_gate_d_evaluate.test.ts` + fixtures | `bun test .opencode/tests/entities/deep_research_gate_d_evaluate.test.ts` passes (offline, deterministic) |
| P05-05 | Define deterministic **synthesis writer** contract: synthesis input is **only** `summaries/summary-pack.json` + validated citation pool; output `synthesis/draft-synthesis.md`; supports report templates with required sections list | Architect | Engineer | P05-04 (Gate D pass) + `spec-router-summary-schemas-v1.md` + Gate E section requirements | `spec-tool-deep-research-synthesis-write-v1.md` | Spec explicitly forbids ingesting raw wave dumps; includes required section list for Gate E `report_sections_present` computation |
| P05-06 | Implement tool: `deep_research_synthesis_write` (writes `~/.config/opencode/research-runs/<run_id>/synthesis/draft-synthesis.md`) | Engineer | Architect | P05-05 | Tool implementation + artifact `synthesis/draft-synthesis.md` | Fixture-driven test run produces draft containing required headings and citation syntax `[@<cid>]` |
| P05-T3 | Add entity tests + fixtures for `deep_research_synthesis_write` (template selection; stable output scaffolding; no disallowed inputs) | Engineer | QATester | P05-06 | `.opencode/tests/entities/deep_research_synthesis_write.test.ts` + fixtures | `bun test .opencode/tests/entities/deep_research_synthesis_write.test.ts` passes (offline; fixtures simulate model output where needed) |
| P05-07 | Define **Gate E evaluator** contract: compute `uncited_numeric_claims`, `report_sections_present`, `citation_utilization_rate`, `duplicate_citation_rate` deterministically; emit warnings for soft metric failures | Architect | Engineer | `spec-gate-thresholds-v1.md` + `spec-reviewer-rubrics-v1.md` | `spec-tool-deep-research-gate-e-evaluate-v1.md` | Spec reproduces Gate E formulas and citation syntax exactly; includes output JSON example with hard pass + soft warnings |
| P05-08 | Implement tool: `deep_research_gate_e_evaluate` (reads `synthesis/final-synthesis.md` + `citations/citations.jsonl`; emits Gate E metrics + warnings + gate status update payload) | Engineer | Architect | P05-07 | `~/.config/opencode/research-runs/<run_id>/reports/gate-e.json` (or equivalent) + `gates.json` update payload | Tool output includes: `uncited_numeric_claims = 0` proof, `report_sections_present = 100%`, utilization + duplicate rates, warnings array for soft fails |
| P05-T4 | Add entity tests + fixtures for `deep_research_gate_e_evaluate` (missing required section; uncited numeric claim; low utilization warning; high duplicate warning) | Engineer | QATester | P05-08 | `.opencode/tests/entities/deep_research_gate_e_evaluate.test.ts` + fixtures | `bun test .opencode/tests/entities/deep_research_gate_e_evaluate.test.ts` passes (offline, deterministic) |
| P05-09 | Define **reviewer factory** contract: run parallel reviewers over draft synthesis for (a) structure/sections, (b) uncited numeric claims, (c) citation utilization + duplicates, (d) coverage gaps; output bounded review bundle with PASS/CHANGES_REQUIRED and explicit evidence pointers | Architect | Engineer | P05-06 + `spec-reviewer-rubrics-v1.md` + `spec-stage-machine-v1.md` | `spec-tool-deep-research-review-factory-run-v1.md` | Spec defines review bundle schema + deterministic aggregation policy + max iteration policy for stage machine `review -> synthesis` |
| P05-10 | Implement tool: `deep_research_review_factory_run` (produces review bundle under `~/.config/opencode/research-runs/<run_id>/review/`) and **revision controller** (`deep_research_revision_control`) enforcing bounded iterations and explicit escalation | Engineer | Architect | P05-09 + P05-08 (Gate E evaluator available) | `review/review-bundle.json` + `review/*.md` + `review/revision-directives.json` (or equivalent) | Fixture run shows: deterministic PASS/CHANGES_REQUIRED; bounded iteration counter; explicit escalation reason when max iterations reached |
| P05-T5 | Add entity tests + fixtures for reviewer factory + revision controller (aggregation determinism; max-iterations stop; correct stage-machine decision outputs) | Engineer | QATester | P05-10 | `.opencode/tests/entities/deep_research_review_factory_run.test.ts` + `.opencode/tests/entities/deep_research_revision_control.test.ts` + fixtures | `bun test ...` passes for both tools; no network; no real agent execution in tests |
| P05-X1 | Phase 05 checkpoint + **Gate D + Gate E signoff** (evidence pack assembled exactly per reviewer rubrics; Phase 06/Finalize unblocked) | Architect | QATester | all P05-* | `PHASE-05-CHECKPOINT-GATE-D-E.md` | Includes links/paths to: `summaries/summary-pack.json`, size report, `synthesis/final-synthesis.md`, numeric-claim check output, utilization report output, and `gates.json` excerpts for D and E |

## Notes
- Artifact root for Phase 05 tools: `~/.config/opencode/research-runs/<run_id>/...`
- Tool naming convention: `deep_research_*`
