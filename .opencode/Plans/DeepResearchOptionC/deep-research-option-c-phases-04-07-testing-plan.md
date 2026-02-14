# Deep Research Option C — Phases 04–07 Testing Plan

## Scope

This plan defines **offline-first, deterministic** tests (default) plus a small set of **canary/online** tests (opt-in) for Option C phases:

- **Phase 04:** Citation & evidence services (**Gate C**)
- **Phase 05:** Summary pack + synthesis + reviewer factory (**Gates D, E**)
- **Phase 06:** Observability + automated quality harness (**Gate E** stability)
- **Phase 07:** Rollout hardening + canary + fallback (**Gate F**)

It follows the cross-phase testing strategy: **test entities/tools (contracts), assert on artifacts, keep it deterministic, map to Gates A–F**.

---

## Offline-first strategy (default)

### Goals
- **Seconds-fast** per-entity contract tests that do **not** require full deep research runs.
- **No network and no agent calls** in default test mode.
- **Artifact-first blackbox assertions**:
  - tool return JSON contract (`ok`, `error.code`, etc.)
  - run tree artifacts (`citations/*.jsonl`, `summaries/*`, `synthesis/*`, telemetry logs)
  - deterministic gate reports derived from those artifacts (Gates C–F)

### Determinism rules
- Every test supplies:
  - a fixed `run_id` (e.g., `dr_test_p04_001`)
  - a temp `root_override` (test-controlled directory)
- Avoid asserting exact timestamps. Normalize or assert presence/format only.
- Drive time via injected clock:
  - `drivers.clock.now()` returns a fixed epoch in offline mode
  - `drivers.sleep(ms)` is a no-op in offline mode

### Test modes
- **OFFLINE (deterministic)**: fixture-driven drivers only (default)
- **CANARY/ONLINE**: real network + constrained runs (explicit opt-in)

---

## Fixture conventions

### Directory structure (proposed)
```text
.opencode/tests/
  entities/
  canary/
  fixtures/
    runs/
      p04-citations-basic/
      p04-citations-invalid-mix/
      p05-summary-pack-bounds/
      p05-synthesis-template-pass/
      p06-telemetry-minimal/
      p07-fallback-trigger/
    http/
      url-checks/
        allowlist.json
        responses/
          <sha256(normalized_url)>.json
    golden/
      gate-reports/
        p04_gate_c_report.json
        p05_gate_d_report.json
        p05_gate_e_report.json
        p06_quality_harness_report.json
```

### Fixture design rules
- **Run-tree fixtures** under `fixtures/runs/<scenario>/` mirror on-disk artifacts:
  - `wave-1/*.md`, `citations/*`, `summaries/*`, `synthesis/*`, `logs/*`, `manifest.json`, `gates.json`
- **HTTP fixtures** under `fixtures/http/url-checks/`:
  - `allowlist.json` defines which URLs are permitted for canary checks
  - `responses/<hash>.json` stores deterministic URL validation outcomes for offline tests
- **Golden gate reports** under `fixtures/golden/gate-reports/`:
  - stored as canonical JSON outputs from deterministic calculators
  - updated only via an explicit snapshot/update command (never implicitly)

### Snapshot/update policy
- Offline tests should support a single explicit update mode (example):
  - `PAI_DR_UPDATE_SNAPSHOTS=1 bun test .opencode/tests/entities`
- Snapshot updates must be reviewed (diffs must be small and explainable).

---

## How to run

### Offline (default)
- All Phase 04–07 offline tests:
  - `PAI_DR_OPTION_C_ENABLED=1 PAI_DR_NO_WEB=1 bun test .opencode/tests/entities`
- Single entity:
  - `PAI_DR_OPTION_C_ENABLED=1 PAI_DR_NO_WEB=1 bun test .opencode/tests/entities/<file>.test.ts`

### Canary/online (explicit)
- Canary suite (opt-in):
  - `PAI_DR_OPTION_C_ENABLED=1 PAI_DR_NO_WEB=0 bun test .opencode/tests/canary`

Canary tests must be:
- bounded (low fan-out / small allowlist)
- safe to run manually
- skippable by default; run only via the explicit canary command above

---

## Mapping table — OFFLINE (deterministic, fixture-driven)

| Phase | Entity/Tool | Test file path | Fixtures | Evidence command | Gate(s) | Mode |
|---|---|---|---|---|---|---|
| 04 | `deep_research_citations_extract_urls` (extract URLs from wave outputs) | `.opencode/tests/entities/deep_research_citations_extract_urls.test.ts` | `fixtures/runs/p04-citations-basic/wave-1/*.md` | `PAI_DR_OPTION_C_ENABLED=1 PAI_DR_NO_WEB=1 bun test .opencode/tests/entities/deep_research_citations_extract_urls.test.ts` | C | OFFLINE |
| 04 | `deep_research_citations_normalize` (canonical normalization rules) | `.opencode/tests/entities/deep_research_citations_normalize.test.ts` | `fixtures/runs/p04-citations-basic/` | `PAI_DR_OPTION_C_ENABLED=1 PAI_DR_NO_WEB=1 bun test .opencode/tests/entities/deep_research_citations_normalize.test.ts` | C | OFFLINE |
| 04 | `deep_research_citations_validate` (fixture worker; statuses + reasons) | `.opencode/tests/entities/deep_research_citations_validate.test.ts` | `fixtures/http/url-checks/responses/*.json` | `PAI_DR_OPTION_C_ENABLED=1 PAI_DR_NO_WEB=1 bun test .opencode/tests/entities/deep_research_citations_validate.test.ts` | C | OFFLINE |
| 04 | `deep_research_gate_c_compute` (deterministic metrics per spec) | `.opencode/tests/entities/deep_research_gate_c_compute.test.ts` | `fixtures/runs/p04-citations-invalid-mix/citations/*` | `PAI_DR_OPTION_C_ENABLED=1 PAI_DR_NO_WEB=1 bun test .opencode/tests/entities/deep_research_gate_c_compute.test.ts` | C | OFFLINE |
| 05 | `deep_research_summary_pack_build` (bounded summaries + schema) | `.opencode/tests/entities/deep_research_summary_pack_build.test.ts` | `fixtures/runs/p05-summary-pack-bounds/` | `PAI_DR_OPTION_C_ENABLED=1 PAI_DR_NO_WEB=1 bun test .opencode/tests/entities/deep_research_summary_pack_build.test.ts` | D | OFFLINE |
| 05 | `deep_research_gate_d_evaluate` (size caps + completeness metrics) | `.opencode/tests/entities/deep_research_gate_d_evaluate.test.ts` | `fixtures/runs/p05-summary-pack-bounds/summaries/*` + `manifest.json` | `PAI_DR_OPTION_C_ENABLED=1 PAI_DR_NO_WEB=1 bun test .opencode/tests/entities/deep_research_gate_d_evaluate.test.ts` | D | OFFLINE |
| 05 | `deep_research_synthesis_write` (must read only summary pack + validated citations) | `.opencode/tests/entities/deep_research_synthesis_write.inputs_contract.test.ts` | `fixtures/runs/p05-synthesis-template-pass/` | `PAI_DR_OPTION_C_ENABLED=1 PAI_DR_NO_WEB=1 bun test .opencode/tests/entities/deep_research_synthesis_write.inputs_contract.test.ts` | E | OFFLINE |
| 05 | `deep_research_gate_e_evaluate` (hard + soft metrics; warnings) | `.opencode/tests/entities/deep_research_gate_e_evaluate.test.ts` | `fixtures/runs/p05-synthesis-template-pass/` | `PAI_DR_OPTION_C_ENABLED=1 PAI_DR_NO_WEB=1 bun test .opencode/tests/entities/deep_research_gate_e_evaluate.test.ts` | E | OFFLINE |
| 05 | `deep_research_review_factory_run` (deterministic aggregation; bounded directives) | `.opencode/tests/entities/deep_research_review_factory_run.test.ts` | `fixtures/runs/p05-synthesis-template-pass/` + review fixtures | `PAI_DR_OPTION_C_ENABLED=1 PAI_DR_NO_WEB=1 bun test .opencode/tests/entities/deep_research_review_factory_run.test.ts` | E | OFFLINE |
| 06 | `deep_research_telemetry` (stage events + run summary; replayable) | `.opencode/tests/entities/deep_research_telemetry.test.ts` | `fixtures/runs/p06-telemetry-minimal/logs/*` | `PAI_DR_OPTION_C_ENABLED=1 PAI_DR_NO_WEB=1 bun test .opencode/tests/entities/deep_research_telemetry.test.ts` | E | OFFLINE |
| 06 | `deep_research_fixture_replay` (offline harness validates gates reproducibly) | `.opencode/tests/entities/deep_research_fixture_replay.test.ts` | `fixtures/runs/p05-synthesis-template-pass/` + `fixtures/golden/gate-reports/p06_quality_harness_report.json` | `PAI_DR_OPTION_C_ENABLED=1 PAI_DR_NO_WEB=1 bun test .opencode/tests/entities/deep_research_fixture_replay.test.ts` | E | OFFLINE |
| 06 | `deep_research_gate_e_reports` (numeric claims + utilization + sections reports) | `.opencode/tests/entities/deep_research_gate_e_reports.test.ts` | `fixtures/runs/p05-synthesis-template-pass/` | `PAI_DR_OPTION_C_ENABLED=1 PAI_DR_NO_WEB=1 bun test .opencode/tests/entities/deep_research_gate_e_reports.test.ts` | E | OFFLINE |
| 06 | `deep_research_phase06_regression` (benchmark fixtures + expected outcomes) | `.opencode/tests/regression/deep_research_phase06_regression.test.ts` | `fixtures/runs/p04-*` + `fixtures/runs/p05-*` (small set) | `PAI_DR_OPTION_C_ENABLED=1 PAI_DR_NO_WEB=1 bun test .opencode/tests/regression/deep_research_phase06_regression.test.ts` | E | OFFLINE |
| 07 | `deep_research_feature_flags_contract` (enable/disable + caps + emergency off) | `.opencode/tests/entities/deep_research_feature_flags.contract.test.ts` | `fixtures/runs/p07-fallback-trigger/manifest.json` (flag state examples) | `PAI_DR_OPTION_C_ENABLED=1 PAI_DR_NO_WEB=1 bun test .opencode/tests/entities/deep_research_feature_flags.contract.test.ts` | F | OFFLINE |
| 07 | `deep_research_fallback_to_standard` (deterministic downgrade preserves artifacts) | `.opencode/tests/entities/deep_research_fallback_path.test.ts` | `fixtures/runs/p07-fallback-trigger/` | `PAI_DR_OPTION_C_ENABLED=1 PAI_DR_NO_WEB=1 bun test .opencode/tests/entities/deep_research_fallback_path.test.ts` | F | OFFLINE |
| 07 | `deep_research_pause_resume_drill` (checkpoint + canonical read order) | `.opencode/tests/entities/deep_research_pause_resume.drill.test.ts` | `fixtures/runs/p07-fallback-trigger/` + checkpoint fixture | `PAI_DR_OPTION_C_ENABLED=1 PAI_DR_NO_WEB=1 bun test .opencode/tests/entities/deep_research_pause_resume.drill.test.ts` | F | OFFLINE |

---

## Mapping table — CANARY/ONLINE (opt-in, constrained)

| Phase | Entity/Tool | Test file path | Fixtures | Evidence command | Gate(s) | Mode |
|---|---|---|---|---|---|---|
| 04 | `deep_research_citations_validate` (live allowlist URL checks) | `.opencode/tests/canary/deep_research_gate_c_live_urls.canary.test.ts` | `fixtures/http/url-checks/allowlist.json` | `PAI_DR_OPTION_C_ENABLED=1 PAI_DR_NO_WEB=0 bun test .opencode/tests/canary/deep_research_gate_c_live_urls.canary.test.ts` | C | CANARY/ONLINE |
| 05 | `deep_research_synthesis_smoke` (bounded synthesis with reviewers; minimal run) | `.opencode/tests/canary/deep_research_synthesis_canary_smoke.test.ts` | Canary query fixture (local JSON) + allowlisted URLs only | `PAI_DR_OPTION_C_ENABLED=1 PAI_DR_NO_WEB=0 bun test .opencode/tests/canary/deep_research_synthesis_canary_smoke.test.ts` | D, E | CANARY/ONLINE |
| 06 | `deep_research_observability_canary` (telemetry completeness + latency envelope) | `.opencode/tests/canary/deep_research_observability_canary.test.ts` | Canary query fixture (local JSON) | `PAI_DR_OPTION_C_ENABLED=1 PAI_DR_NO_WEB=0 bun test .opencode/tests/canary/deep_research_observability_canary.test.ts` | E | CANARY/ONLINE |
| 07 | `deep_research_rollout_canary_fallback` (flag off -> fallback; flag on -> canary caps) | `.opencode/tests/canary/deep_research_rollout_canary_fallback.test.ts` | Canary rollout config fixture (local JSON) | `PAI_DR_OPTION_C_ENABLED=1 PAI_DR_NO_WEB=0 bun test .opencode/tests/canary/deep_research_rollout_canary_fallback.test.ts` | F | CANARY/ONLINE |

---

## Notes on Gate evidence alignment (reviewer expectations)

- **Gate C evidence** (Phase 04):
  - `citations/citations.jsonl` sample lines
  - proof every extracted URL has exactly one status
  - `gates.json` excerpt with Gate C status
  - deterministic report matching `spec-gate-thresholds-v1.md` formulas
- **Gate D evidence** (Phase 05):
  - `summaries/summary-pack.json`
  - size report (per summary and total) consistent with `manifest.limits.*`
  - `gates.json` excerpt with Gate D status
- **Gate E evidence** (Phases 05–06):
  - `synthesis/final-synthesis.md`
  - numeric-claim check output proving `uncited_numeric_claims = 0`
  - citation utilization report output (utilization + duplicate rate)
  - `gates.json` excerpt with Gate E status + warnings (if any)
- **Gate F evidence** (Phase 07):
  - feature flags documentation + defaults
  - canary plan + rollback triggers
  - fallback procedure proof that artifacts are preserved
