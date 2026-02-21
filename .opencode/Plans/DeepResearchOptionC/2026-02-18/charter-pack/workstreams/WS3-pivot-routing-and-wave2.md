# WS3 — Pivot routing + Wave2 orchestration

## Objective

Make pivot stage deterministic and complete:

- if pivot decides wave2 required, orchestrate wave2 execution
- otherwise proceed to citations

## Scope

- Stop forcing pivot->citations in post-pivot orchestrator.
- Add wave2 plan/execution driver using pivot gap IDs and max_wave2_agents cap.

## Deliverables

- Modify:
  - `.opencode/tools/deep_research_cli/orchestrator_tick_post_pivot.ts`
  - `.opencode/tools/deep_research_cli/orchestrator_run_post_pivot.ts`
- Add:
  - wave2 planning artifact and ingestion loop
  - tests for wave2-required scenario

## Acceptance criteria

- [ ] When pivot.json says wave2_required=true, stage advances to wave2 and orchestrator executes wave2 gaps.
- [ ] After wave2 outputs are ingested/validated, pipeline proceeds to citations.

## Verification

```bash
bun test ./.opencode/tests
bun Tools/Precommit.ts
```

## Reviews

- Architect PASS
- QA PASS
