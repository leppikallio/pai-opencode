## E6 Canary execution modes (v1)

This doc distinguishes **deterministic CI smoke** from **manual evidence canaries**.

### Mode 1 — Deterministic smoke (default; CI-safe)

Goal: prove the stage machine + artifact lattice works without network or real agent spawning.

- Driver: `fixture`
- Sensitivity: `PAI_DR_NO_WEB=1`
- Requirements: none beyond Bun + repo
- Runs: self-seeded under a temp `PAI_DR_RUNS_ROOT`
- Commands:
  - M2: `bun test ./.opencode/tests/smoke/deep_research_live_wave1_smoke.test.ts`
  - M3: `bun test ./.opencode/tests/smoke/deep_research_live_finalize_smoke.test.ts`

Expected behavior:
- Tests create a fresh run (init) and tick until the target stage is reached.
- No network calls.
- No Task-based agent spawning.

### Mode 2 — Manual evidence canary (operator runbook; gated)

Goal: produce an auditable run root for milestone evidence (M2/M3) using real drivers.

- Driver: `live` (operator-input driver acceptable)
- Sensitivity:
  - M2: `restricted` or `no_web` (depending on what you’re proving)
  - M3: `normal` (online citations ladder) when ready
- Requirements:
  - Option C explicitly enabled (`PAI_DR_OPTION_C_ENABLED=1`)
  - For online citations: endpoints configured (e.g. Bright Data / Apify) + non-`PAI_DR_NO_WEB`

Commands:
- See runbooks:
  - `E6-runbook-m2-live-wave1-to-pivot.md`
  - `E6-runbook-m3-live-finalize.md`

### Mode 3 — Online citations ladder (gated)

Goal: validate citations online with reproducibility artifacts.

- Requires:
  - `PAI_DR_NO_WEB=0`
  - `PAI_DR_CITATIONS_BRIGHT_DATA_ENDPOINT` and/or `PAI_DR_CITATIONS_APIFY_ENDPOINT`
  - Online fixtures captured (`citations/online-fixtures.latest.json`)

Notes:
- This mode is intentionally **off** by default; keep CI deterministic.
