# Workflow: RunM2Canary

Run the **M2 canary**: a fast smoke test that verifies Wave 1 can deterministically reach `pivot` and that **Gate B** passes.

## The canary test

- Test file: `.opencode/tests/smoke/deep_research_live_wave1_smoke.test.ts`

Run it:

```bash
bun test .opencode/tests/smoke/deep_research_live_wave1_smoke.test.ts
```

## What it proves

This canary is *self-seeding* (offline): it deterministically seeds `perspectives.json` and provides valid markdown for required agent outputs.

If it passes, it proves:

- `run_init` produces a valid run root (`manifest.json`, `gates.json`).
- Stage can be advanced to `wave1`.
- Live orchestrator ticks progress Wave 1 deterministically and reach `pivot`.
- Wave 1 artifacts are written (including `wave-1/` markdown).
- `wave-review.json` exists.
- Gate B status is `pass` in `gates.json`.
- An audit trail is emitted (`logs/audit.jsonl`).

## What it does NOT prove

This is a contract + progression canary, not “real research”. It does **not** prove:

- Real web access (the canary runs with `sensitivity=no_web`).
- LLM-driven autonomy via the operator task-driver loop (`tick --driver task` + `agent-result`).
- Quality of agent reasoning/content beyond accepting a known-good markdown fixture.
- Anything about later stages (citations, summaries, synthesis, review, Gate E).
