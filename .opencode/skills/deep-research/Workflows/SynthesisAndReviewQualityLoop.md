# Workflow: SynthesisAndReviewQualityLoop

Run bounded Phase 05 synthesis/review loops until finalize criteria are met.

> **Scaffold warning (read first):** The baseline flow below uses **generate-mode** synthesis/review.
> This is deterministic scaffolding to validate artifacts, gates, and bounded iteration policy.
> Do **not** treat generate-mode synthesis/review output as “real research” unless an approved LLM-backed path produced it.

## Baseline mode (required)

Use deterministic generate mode first:

- `summary_pack_build` (mode `generate`)
- `gate_d_evaluate` + `gates_write`
- `synthesis_write` (mode `generate`)
- `review_factory_run` (mode `generate`)
- `gate_e_reports` + `gate_e_evaluate` + `gates_write`
- `revision_control`

## Optional extension (future)

If an approved LLM-backed path exists, it may replace generate-mode synthesis/review generation,
but it must still preserve the same artifacts and bounded revision policy.

## Iteration policy

- Use `manifest.limits.max_review_iterations` as hard cap.
- Each review cycle must record a `revision_control` action:
  - `advance` -> finalize
  - `revise` -> return to synthesis
  - `escalate` -> operator intervention
- Do not exceed iteration cap silently.

## Exit criteria

- Gate D status is pass (summaries quality acceptable).
- Gate E status is pass and review decision is PASS.
- Stage advances to `finalize`.

## Validation contract (Gate D/E artifacts)

- [ ] `summary-pack.json` exists in the summary-pack directory and `gate_d_evaluate` produced a complete patch.
- [ ] `final-synthesis.md` exists in the synthesis directory for review.
- [ ] `review-bundle.json` exists in the reviews directory and includes a valid decision.
- [ ] Gate E reports exist under `reports/`:
  - `gate-e-numeric-claims.json`
  - `gate-e-sections-present.json`
  - `gate-e-citation-utilization.json`
  - `gate-e-status.json`
- [ ] `revision_control` output is recorded and consistent with stage transition.
