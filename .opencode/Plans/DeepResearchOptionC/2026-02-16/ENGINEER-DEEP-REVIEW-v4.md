## Feasibility verdict

**PASS** — feasible with **minimal but non-trivial** implementation deltas.

## Evidence snapshot
- Deterministic substrate is present (run init, stage machine, gates, review/synthesis/citation tools):
  - `.opencode/tools/deep_research/*.ts` includes `run_init.ts`, `stage_advance.ts`, `gate_*`, `summary_pack_build.ts`, `review_factory_run.ts`, etc.
- Stage machine authority exists and aligns with plan transitions:
  - `.opencode/tools/deep_research/stage_advance.ts` (transition guards, gate checks).
- Canonical runs root already matches plan default:
  - `.opencode/tools/deep_research/flags_v1.ts` (`runsRoot = ~/.config/opencode/research-runs`).

## Gaps to implement
- `deep_research_wave_output_ingest` is missing.
- Operator contract `/deep-research <mode> "<query>" ...` is not yet implemented as a full flow.
- M1 smoke test + required fixture scenarios are not yet present.

## Minimal code deltas

1) **Add Wave ingest tool (required for M2)**
- New: `.opencode/tools/deep_research/wave_output_ingest.ts`
- Export via `.opencode/tools/deep_research/index.ts`
- New test: `.opencode/tests/entities/deep_research_wave_output_ingest.test.ts`

2) **Implement orchestrator driver loop boundary**
- New orchestrator module(s) (e.g. `.opencode/tools/deep_research/orchestrator.ts` + driver adapters).
- Define `OrchestratorDrivers` and support:
  - fixture driver (deterministic replay)
  - live driver (Task-backed agent execution)
- Enforce bounded retries + gate-driven stage advancement + deterministic artifact writes.

3) **Upgrade operator command contract**
- Update `.opencode/commands/deep-research.md` to support:
  - `plan | fixture | live`
  - `--run_id` resume
  - `--sensitivity normal|restricted|no_web`
- Ensure required output fields always printed.

4) **Add M1 fixture smoke coverage**
- New smoke test: `.opencode/tests/smoke/deep_research_fixture_finalize_smoke.test.ts`
- Add fixture dirs listed in the plan.

5) **Terminal-failure persistence path (review cap reached)**
- When Gate E fails at iteration cap:
  - write `review/terminal-failure.json`
  - call `deep_research_manifest_write` to set `manifest.status = failed`
- Keep `stage_advance` as authority without adding a new stage id.

## Recommended implementation order
1) ingest tool → 2) fixture smoke/fixtures → 3) orchestrator drivers → 4) command contract update → 5) one live run evidence.
