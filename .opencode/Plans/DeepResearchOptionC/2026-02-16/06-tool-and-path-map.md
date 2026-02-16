# Option C — Tool & Path Map (operator-facing)

Date: 2026-02-16

Purpose: make the Option C system navigable for a clever agent with **zero prior context**.

---

## Repo roots

- Repo: `/Users/zuul/Projects/pai-opencode-graphviz`
- Option C plans: `.opencode/Plans/DeepResearchOptionC/`
- This dated packet: `.opencode/Plans/DeepResearchOptionC/2026-02-16/`

---

## Operator entrypoints (commands)

| What | Path | Notes |
|---|---|---|
| Operator command (to be expanded) | `.opencode/commands/deep-research.md` | Must become `/deep-research <mode> "<query>" ...` per plan v4 |
| Status command | `.opencode/commands/deep-research-status.md` | Reads progress tracker |

---

## Tool surface (Option C deep research tools)

Canonical export barrel:
- `.opencode/tools/deep_research/index.ts`

Implementation files live under:
- `.opencode/tools/deep_research/*.ts`

### Minimal operator-critical tool map

> Columns:
> - **File**: repo path
> - **Export const**: the exported tool constant in that file
> - **Runtime tool name**: the intended external tool ID used by commands/docs (plan v4 convention)

| File | Export const | Runtime tool name |
|---|---|---|
| `.opencode/tools/deep_research/run_init.ts` | `run_init` | `deep_research_run_init` |
| `.opencode/tools/deep_research/manifest_write.ts` | `manifest_write` | `deep_research_manifest_write` |
| `.opencode/tools/deep_research/gates_write.ts` | `gates_write` | `deep_research_gates_write` |
| `.opencode/tools/deep_research/stage_advance.ts` | `stage_advance` | `deep_research_stage_advance` |
| `.opencode/tools/deep_research/watchdog_check.ts` | `watchdog_check` | `deep_research_watchdog_check` |
| `.opencode/tools/deep_research/retry_record.ts` | `retry_record` | `deep_research_retry_record` |
| `.opencode/tools/deep_research/perspectives_write.ts` | `perspectives_write` | `deep_research_perspectives_write` |
| `.opencode/tools/deep_research/wave1_plan.ts` | `wave1_plan` | `deep_research_wave1_plan` |
| `.opencode/tools/deep_research/wave_output_validate.ts` | `wave_output_validate` | `deep_research_wave_output_validate` |
| `.opencode/tools/deep_research/wave_review.ts` | `wave_review` | `deep_research_wave_review` |
| `.opencode/tools/deep_research/pivot_decide.ts` | `pivot_decide` | `deep_research_pivot_decide` |
| `.opencode/tools/deep_research/citations_extract_urls.ts` | `citations_extract_urls` | `deep_research_citations_extract_urls` |
| `.opencode/tools/deep_research/citations_normalize.ts` | `citations_normalize` | `deep_research_citations_normalize` |
| `.opencode/tools/deep_research/citations_validate.ts` | `citations_validate` | `deep_research_citations_validate` |
| `.opencode/tools/deep_research/gate_c_compute.ts` | `gate_c_compute` | `deep_research_gate_c_compute` |
| `.opencode/tools/deep_research/summary_pack_build.ts` | `summary_pack_build` | `deep_research_summary_pack_build` |
| `.opencode/tools/deep_research/gate_d_evaluate.ts` | `gate_d_evaluate` | `deep_research_gate_d_evaluate` |
| `.opencode/tools/deep_research/synthesis_write.ts` | `synthesis_write` | `deep_research_synthesis_write` |
| `.opencode/tools/deep_research/review_factory_run.ts` | `review_factory_run` | `deep_research_review_factory_run` |
| `.opencode/tools/deep_research/revision_control.ts` | `revision_control` | `deep_research_revision_control` |
| `.opencode/tools/deep_research/gate_e_evaluate.ts` | `gate_e_evaluate` | `deep_research_gate_e_evaluate` |
| `.opencode/tools/deep_research/gate_e_reports.ts` | `gate_e_reports` | `deep_research_gate_e_reports` |
| `.opencode/tools/deep_research/dry_run_seed.ts` | `dry_run_seed` | `deep_research_dry_run_seed` |
| `.opencode/tools/deep_research/fixture_bundle_capture.ts` | `fixture_bundle_capture` | `deep_research_fixture_bundle_capture` |
| `.opencode/tools/deep_research/fixture_replay.ts` | `fixture_replay` | `deep_research_fixture_replay` |
| `.opencode/tools/deep_research/regression_run.ts` | `regression_run` | `deep_research_regression_run` |
| `.opencode/tools/deep_research/quality_audit.ts` | `quality_audit` | `deep_research_quality_audit` |

### Planned tool (not implemented yet)

| File | Export const | Runtime tool name |
|---|---|---|
| `.opencode/tools/deep_research/wave_output_ingest.ts` | `wave_output_ingest` | `deep_research_wave_output_ingest` |

---

## Test surface

- Entity tests: `.opencode/tests/entities/**`
- Fixtures: `.opencode/tests/fixtures/**`
- Regression: `.opencode/tests/regression/**`

Planned (per plan v4 + testing plan v2):
- Smoke: `.opencode/tests/smoke/**`
- Docs surface checks: `.opencode/tests/docs/**`

---

## Assumed OpenCode/core runtime tools (non-Option-C)

The Option C operator experience assumes a host runtime that provides some built-ins.

| Capability | Example tool | Used for |
|---|---|---|
| Agent spawning | `Task` tool | Live wave execution (Wave 1 / Wave 2) |
| Todo tracking (optional) | `todowrite` / `todoread` | Progress visibility; not required for core artifacts |
| File inspection | read/grep/glob | Debug and verification |
| Operator prompts | question | Confirm destructive actions / branching |

If any of these are missing in a given runtime, the orchestrator must degrade gracefully and still write canonical run-root artifacts.
