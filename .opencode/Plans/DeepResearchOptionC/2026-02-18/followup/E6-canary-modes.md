## E6 Canary execution modes (v1)

This doc distinguishes **deterministic CI smoke** from **manual evidence canaries**.

### Mode 1 — Deterministic smoke (default; CI-safe)

Goal: prove the stage machine + artifact lattice works without network or real agent spawning.

- Driver: `fixture`
- Sensitivity: `--sensitivity no_web`
- Requirements: none beyond Bun + repo
- Runs: self-seeded under a temp runs root
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
  - M2: `--sensitivity restricted` or `--sensitivity no_web` (depending on evidence target)
  - M3: `--sensitivity normal` (online citations ladder) when ready
- Requirements:
  - Option C enabled via settings-backed rollout controls.
  - For online citations: endpoint defaults/caps resolved from settings and persisted into run artifacts.

Commands:
- See runbooks:
  - `E6-runbook-m2-live-wave1-to-pivot.md`
  - `E6-runbook-m3-live-finalize.md`

### Mode 3 — Online citations ladder (gated)

Goal: validate citations online with reproducibility artifacts.

- Requires:
  - `--sensitivity normal`
  - Online endpoint defaults/caps present in settings snapshot and persisted in `run-config.json`
  - Online fixtures captured (`citations/online-fixtures.latest.json`)

Notes:
- This mode is intentionally **off** by default; keep CI deterministic.
- Historical env field names (for example `PAI_DR_CITATIONS_BRIGHT_DATA_ENDPOINT`) may appear in artifacts/settings snapshots, but operators should use sensitivity + settings-backed config.
