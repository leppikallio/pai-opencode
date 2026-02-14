# Phase 06 Executable Backlog — Observability & Automated Quality Harness

## Objective
Instrument Deep Research Option C runs end-to-end and ship an **offline-first**, fixture-driven quality harness that makes **Gate E** (and related quality checks) **measurable, reproducible, and regression-testable** without external network dependency.

## Dependencies
- Phase 05 synthesis/reviewer loop complete (produces `scratch/research-runs/<run_id>/synthesis/final-synthesis.md` + validated citation pool).
- Gate definitions (do not modify): `spec-gate-thresholds-v1.md` (Gate E metrics + formulas).
- Reviewer expectations (do not reinterpret): `spec-reviewer-rubrics-v1.md` (Gate E evidence checklist).
- Watchdog/timeout policy (must be enforced + replayable): `spec-watchdog-v1.md`.
- Offline-first testing strategy and fixture approach from earlier phases (entity tests + seconds-fast fixture replay).

## Gate
- **Gate E:** *Synthesis quality* must be **deterministic to measure and reproducible to re-check** from captured artifacts.
- Phase 06 deliverables must make Gate E **mechanically computable** from an offline fixture bundle containing (at minimum):
  - `scratch/research-runs/<run_id>/synthesis/final-synthesis.md`
  - `scratch/research-runs/<run_id>/citations/citations.jsonl` (validated pool)
  - Deterministic tool outputs for Gate E checks:
    - **Numeric-claim check output** proving `uncited_numeric_claims = 0` (hard metric)
    - **Citation utilization report output** computing:
      - `citation_utilization_rate` (soft metric)
      - `duplicate_citation_rate` (soft metric)
  - A gate status excerpt (or equivalent) showing Gate E `pass|fail` and any `warnings[]` for soft metric failures.
- **Do not change Gate E metrics or thresholds.** Implement tooling/harness so the existing definitions are reliably measured, replayed, and regression-tested offline.

## Backlog (Owner/Reviewer mapped)
| ID | Task | Owner | Reviewer | Dependencies | Deliverable | Evidence |
|---|---|---|---|---|---|---|
| P06-01 | Define **run telemetry event schema + metrics dictionary** (stage start/stop, retries, failures, timeouts; stable JSON/JSONL; deterministic ordering) | Architect | Engineer | Phase 05 + `spec-watchdog-v1.md` | `spec-run-telemetry-schema-v1.md` + `spec-run-metrics-dictionary-v1.md` | Spec includes field-level schema, ordering rules, and at least 1 valid example event stream + metrics example |
| P06-02 | Implement **stage-level telemetry emission** and **run-level metrics summary** artifact (durations, retries, failures; links to artifacts) | Engineer | QATester | P06-01 | Telemetry writer + `scratch/research-runs/<run_id>/metrics/run-metrics.json` (or equivalent) | `bun test .opencode/tests/entities/deep_research_telemetry.test.ts` passes (fixture-driven, no network) |
| P06-T1 | Add fixtures + entity tests ensuring telemetry determinism (same inputs → identical event stream + identical `run-metrics.json`) | Engineer | QATester | P06-02 | `.opencode/tests/entities/deep_research_telemetry.test.ts` + fixtures | `bun test .opencode/tests/entities/deep_research_telemetry.test.ts` completes in seconds |
| P06-03 | Specify **offline fixture bundle format** for replay (what files must exist, canonical paths, normalization, versioning; include “no web” guarantee) | Architect | Engineer | Phase 05 | `spec-tool-deep-research-fixture-bundle-v1.md` | Spec includes: required files list, version tag, and a minimal example bundle layout |
| P06-04 | Implement **fixture capture + replay harness** (reads a fixture bundle, re-computes gate reports deterministically, emits a single machine-readable report) | Engineer | Architect | P06-03 + Gate specs | `spec-tool-deep-research-fixture-replay-v1.md` + replay runner tool/command | `bun test .opencode/tests/entities/deep_research_fixture_replay.test.ts` passes (uses bundled fixtures only) |
| P06-T2 | Add fixtures + tests for fixture replay (golden outputs; stable ordering; failure codes on missing/invalid artifacts) | Engineer | QATester | P06-04 | `.opencode/tests/entities/deep_research_fixture_replay.test.ts` + fixtures | `bun test .opencode/tests/entities/deep_research_fixture_replay.test.ts` passes in seconds |
| P06-05 | Define deterministic **Gate E report computation contracts** (no metric changes): parsing `[@<cid>]`, counting unique/total mentions, computing utilization + duplicate rate per formulas; required report sections check source-of-truth; numeric-claim checker output shape | Architect | Engineer | `spec-gate-thresholds-v1.md` + `spec-reviewer-rubrics-v1.md` | `spec-tool-deep-research-gate-e-reports-v1.md` | Spec includes: exact formulas copied from Gate E, I/O schemas, and at least 1 full worked example |
| P06-06 | Implement **Gate E reports generator** (offline): (1) numeric-claim check report; (2) citation utilization report; (3) sections-present report; all emitted as deterministic JSON for harness consumption | Engineer | QATester | P06-05 | Tool(s) producing `reports/gate-e-*.json` (or equivalent) | `bun test .opencode/tests/entities/deep_research_gate_e_reports.test.ts` passes (fixture-driven) |
| P06-T3 | Add fixtures + tests for Gate E reports (edge cases: zero URLs, missing cid, malformed citation syntax, duplicate mentions, missing required sections) | Engineer | QATester | P06-06 | `.opencode/tests/entities/deep_research_gate_e_reports.test.ts` + fixtures | `bun test .opencode/tests/entities/deep_research_gate_e_reports.test.ts` passes in seconds |
| P06-07 | Specify **regression suite definition** (offline): baseline fixture bundles, expected Gate E pass/warn outcomes, latency envelope checks from telemetry (where applicable), and “seconds-fast” constraint | Architect | Engineer | P06-04 + P06-06 | `spec-deep-research-regression-suite-v1.md` | Spec lists: fixture IDs, expected metrics, expected warnings, and runtime budget target |
| P06-08 | Implement **regression suite runner** (single command) that replays baseline fixtures and asserts expected outcomes for Gate E evidence artifacts and warnings behavior | Engineer | QATester | P06-07 | `.opencode/tests/regression/deep_research_phase06_regression.test.ts` (or equivalent) | `bun test .opencode/tests/regression/deep_research_phase06_regression.test.ts` passes locally, offline |
| P06-09 | Implement **reviewer quality audit** tooling that scans prior fixture bundles + telemetry summaries and flags drift (e.g., utilization trending down, duplicate rate up, recurring section omissions) | Engineer | Architect | P06-02 + P06-04 + P06-06 | `spec-tool-deep-research-quality-audit-v1.md` + audit runner output format | `bun test .opencode/tests/entities/deep_research_quality_audit.test.ts` passes (fixture-driven) |
| P06-10 | Add watchdog/timeout **simulation fixtures** and assertions that timeouts produce required terminal state artifacts (manifest failure record + `logs/timeout-checkpoint.md`) | Engineer | QATester | `spec-watchdog-v1.md` + P06-04 | Timeout replay fixtures + tests | `bun test .opencode/tests/entities/deep_research_watchdog_timeout.test.ts` passes (no real sleeping; simulated clocks/fixtures) |
| P06-X1 | Phase 06 checkpoint + **Gate E signoff package** (matches reviewer rubric evidence list; points to fixture replay command + outputs) | Architect | QATester | all P06-* | `PHASE-06-CHECKPOINT-GATE-E.md` | Reviewer PASS includes: (1) link to `synthesis/final-synthesis.md` fixture, (2) numeric-claim check output (`uncited_numeric_claims = 0`), (3) utilization report output, (4) Gate E status + warnings excerpt, (5) replay command shown and succeeds offline |

## Notes
- Artifact root for Phase 06 outputs: `scratch/research-runs/<run_id>/...`
- OFFLINE tests should run with `PAI_DR_NO_WEB=1`.
