# Workflow: RunM3Canary

Run the **M3 canary**: a deeper smoke test that verifies an offline self-seeding run can reach `finalize` and that **Gate E** passes.

## The canary test

- Test file: `.opencode/tests/smoke/deep_research_live_finalize_smoke.test.ts`

Run it:

```bash
bun test .opencode/tests/smoke/deep_research_live_finalize_smoke.test.ts
```

## What it proves

This canary is *self-seeding* (offline): it deterministically seeds `perspectives.json` and uses a known-good markdown fixture for required agent outputs.

If it passes, it proves:

- A run can progress through the full pipeline to `finalize`.
- Phase 04 summaries are produced (`summaries/summary-pack.json`).
- Phase 05 synthesis is produced (`synthesis/final-synthesis.md`).
- Review artifacts are produced (`review/review-bundle.json`).
- Gate E reports are produced (including `reports/gate-e-status.json`).
- Gate E status is `pass` in `gates.json`.
- An audit trail is emitted (`logs/audit.jsonl`).

## What it does NOT prove

This is a contract + progression canary, not “real research”. It does **not** prove:

- Real web access (the canary runs with `sensitivity=no_web`).
- Real citations discovery/validation against the live web.
- LLM-driven autonomy via the operator task-driver loop (`tick --driver task` + `agent-result`).
- That synthesis/review content quality is “good” (it primarily proves the pipeline and gates execute deterministically).
