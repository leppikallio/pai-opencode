# WS4 — Online citations + reproducibility

## Objective

Make citations real-web capable, bounded, and replayable:

- online ladder execution in orchestrator/operator
- capture online fixtures/evidence
- actionable artifacts for blocked URLs

## Scope

- Remove forced `online_dry_run: true` in post-pivot orchestration for live mode.
- Provide operator configuration without env vars (via settings + run-local config).
- Persist:
  - `citations/online-fixtures.<ts>.json`
  - `citations/blocked-urls.json` (actionable follow-ups)

## Deliverables

- Modify:
  - `.opencode/tools/deep_research_cli/orchestrator_tick_post_pivot.ts`
  - `.opencode/tools/deep_research_cli/citations_validate.ts` and/or `flags_v1.ts` (configuration sourcing)
- Add tests:
  - deterministic online-fixtures replay path
  - minimal online canary (if feasible) gated separately

## Acceptance criteria (Gate C)

- [ ] citations validate runs online and produces citations.jsonl.
- [ ] online fixtures are captured.
- [ ] gate_c_compute + gates_write produce Gate C pass.
- [ ] citations->summaries stage advance succeeds.

## Reviews

- Architect PASS (determinism/replay policy)
- QA PASS
