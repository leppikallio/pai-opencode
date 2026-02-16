## Verdict (PASS/FAIL)
**PASS** — v4 is an acceptable plan target for Option C.

## Strengths
- **Real-world live-run is explicitly targeted**: `/deep-research live "<query>"` plus milestones **M2 (live Wave 1)** and **M3 (live finalize)** define a concrete path to an actual run root with artifacts and gates.
- **Step isolation is first-class**: explicit **driver boundary** with **fixture driver** vs **live driver**, and fixture directories under `.opencode/tests/fixtures/runs/**`.
- **Concrete acceptance artifacts named**: specific test file + fixture scenario directories + minimum assertions (reach finalize, typed failures, audit log entries).
- **Evidence hooks are implied via artifacts**: run root, `manifest.json`, `gates.json`, `logs/audit.jsonl`, stage folders, wave outputs, reviews, Gate snapshots.

## Gaps (blocking)
- **Driver interface is under-specified for isolation beyond agent output**: v4 drivers only include `runAgent` + `nowIso()`, but the testing strategy requires stubbing **fetch/search/clock/sleep** for deterministic orchestrator ticks. This is a plan gap (fixable).

## Required revisions (minimal)
- Expand `OrchestratorDrivers` to cover at least:
  - `retrieve`/`fetch` boundary for future web steps (fixture-stubbable)
  - `sleep(ms)` and clock
  - optional standardized audit event sink
- Add a short “**live-run evidence capture**” contract: what live mode must record (agent type, perspective_id, prompt hash, Task run IDs, raw markdown outputs) and where it lands in the run root.

## Next 5 QA acceptance items
1. **M1 smoke test exists and passes**: `deep_research_fixture_finalize_smoke.test.ts` reaches `finalize` on `m1-finalize-happy/`.
2. **Blocking fixtures fail correctly**: each blocking scenario returns a **typed error** and leaves `manifest.status != finalize`.
3. **Audit trail completeness**: fixture run produces `logs/audit.jsonl` with **one entry per stage transition**.
4. **CLI surface contract**: `/deep-research fixture "<query>"` prints `run_id, run_root, manifest_path, gates_path, stage.current, status` and exits non-zero on hard failures.
5. **Live Wave 1 evidence**: one `live` run reaches `pivot` and the run root contains wave outputs, wave review report, and **Gate B recorded**.
