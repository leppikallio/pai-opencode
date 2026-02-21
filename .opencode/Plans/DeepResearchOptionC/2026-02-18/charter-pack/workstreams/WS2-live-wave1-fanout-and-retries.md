# WS2 — Live Wave1 fan-out + retry consumption (Gate B)

## Objective

Make Wave 1 truly multi-perspective and stable:

- execute all entries in `wave1-plan.json`
- ingest + validate all outputs
- wave_review over the full wave
- derive/write Gate B
- consume retry directives deterministically

## Scope

- Ensure live wave execution processes all plan entries (legacy `entries[0]` gap is closed).
- Implement retry directive consumption and recording via `deep_research_retry_record`.
- Persist agent execution metadata as sidecars (prompt hash, agent_type, agent_run_id, timestamps, retry count).

## Non-goals

- Wave2 orchestration (WS3)
- Online citations (WS4)
- Phase05 generate mode (WS5)

## Deliverables

- Modify:
  - `.opencode/tools/deep_research_cli/orchestrator_tick_live.ts`
  - `.opencode/tools/deep_research_cli/orchestrator_run_live.ts` (if needed)
- Add:
  - sidecar schema doc under run root (if implemented)
  - tests:
    - entity tests proving multi-perspective behavior
    - an M2 smoke that uses Task-spawned agents (once WS1 exists)

## Acceptance criteria (Gate B)

- [ ] For a run with N perspectives in `perspectives.json`, `wave1-plan.json.entries.length == N` and the orchestrator produces N `wave-1/*.md` outputs.
- [ ] `wave-review.json` is produced for the full set.
- [ ] If `wave_review.retry_directives` non-empty, retries are scheduled deterministically up to cap and recorded.
- [ ] Gate B is derived and written; wave1->pivot stage advance succeeds.

## Verification

```bash
bun test ./.opencode/tests
bun Tools/Precommit.ts
```

## Reviews

- Architect PASS (correctness vs rubric)
- QA PASS (tests + smoke viability)
