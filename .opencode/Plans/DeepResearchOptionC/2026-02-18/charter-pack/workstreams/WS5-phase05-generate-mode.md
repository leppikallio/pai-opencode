# WS5 — Phase05 generate mode (summaries/synthesis/review)

## Objective

Remove the fixture-only blockers so real runs can reach finalize:

- `summary_pack_build` supports `mode=generate`
- `synthesis_write` supports `mode=generate`
- `review_factory_run` supports `mode=generate` (or live reviewer driver)

## Scope

- Preserve boundedness checks and gating logic (Gate D/E remain authoritative).
- Integrate with operator driver boundary for LLM/agent generation.

## Deliverables

- Modify:
  - `.opencode/tools/deep_research_cli/summary_pack_build.ts`
  - `.opencode/tools/deep_research_cli/synthesis_write.ts`
  - `.opencode/tools/deep_research_cli/review_factory_run.ts`
- Extend orchestrator post-summaries to support live inputs (not absolute fixture dirs).
- Add entity tests for generate-mode path using deterministic agent-output fixtures (not Phase05 fixtures).

## Acceptance criteria (Gate D/E)

- [ ] summaries->finalize path completes without fixture directories.
- [ ] gates D/E pass and reports are written.
- [ ] review loop bounded by max_review_iterations.

## Reviews

- Architect PASS
- QA PASS
