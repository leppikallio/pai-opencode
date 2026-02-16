# Deep Research Option C — Testing Plan (v2) for Milestones M1/M2/M3

> This plan specifies **exact test file paths** and **exact fixture directories** as concrete implementation requirements. It also maps tests to **stage transitions** and **gates**, and provides a **parallelizable breakdown** for engineers.

---

## 0) Baseline: what already exists (so v2 can be additive)

### Existing canonical harness + patterns (must be reused)
- `.opencode/tests/helpers/dr-harness.ts`
  - `parseToolJson`, `withEnv`, `withTempDir`, `fixturePath`, `makeToolContext`

### Existing entity tests that define the style (examples)
- `.opencode/tests/entities/deep_research_run_init.test.ts`
- `.opencode/tests/entities/deep_research_manifest_write.test.ts`
- `.opencode/tests/entities/deep_research_gates_write.test.ts`
- `.opencode/tests/entities/deep_research_stage_advance.test.ts`
- `.opencode/tests/entities/deep_research_wave1_plan.test.ts`
- `.opencode/tests/entities/deep_research_wave_output_validate.test.ts`
- `.opencode/tests/entities/deep_research_wave_review.test.ts`
- `.opencode/tests/entities/deep_research_pivot_decide.test.ts`
- `.opencode/tests/entities/deep_research_fixture_replay.test.ts`
- `.opencode/tests/regression/deep_research_phase06_regression.test.ts`

### Existing fixture roots (must remain valid)
- `.opencode/tests/fixtures/runs/**`
- `.opencode/tests/fixtures/bundles/**`
- `.opencode/tests/fixtures/wave-output/**`
- `.opencode/tests/fixtures/wave-review/**`
- `.opencode/tests/fixtures/pivot-decision/**`
- `.opencode/tests/fixtures/citations/**`
- `.opencode/tests/fixtures/summaries/**`

---

## 1) Milestone M1 — Offline fixture-run reaches `finalize`

### 1.1 What M1 proves
M1 proves the deterministic substrate and stage machine can drive a run to completion **offline** using only artifacts + gate state.

### 1.2 Required new smoke test (exact path)
- **MUST ADD**: `.opencode/tests/smoke/deep_research_fixture_finalize_smoke.test.ts`

What it proves:
- happy fixture reaches `finalize` with `manifest.status = completed`
- blocking fixtures fail with typed errors

Artifacts asserted:
- `manifest.json`: schema, `stage.current === "finalize"`, `status === "completed"`, ordered stage history
- `gates.json`: required gates present and pass on happy path
- `logs/audit.jsonl`: contains stage transition + gate write events

Negative expectations (minimum):
- missing perspectives at init→wave1 → `MISSING_ARTIFACT`
- Gate C not pass at citations→summaries → `GATE_BLOCKED` with `gate === "C"`

### 1.3 Required new fixture scenario directories (exact paths)
- **MUST ADD**:
  - `.opencode/tests/fixtures/runs/m1-finalize-happy/`
  - `.opencode/tests/fixtures/runs/m1-gate-b-blocks/`
  - `.opencode/tests/fixtures/runs/m1-gate-c-blocks/`
  - `.opencode/tests/fixtures/runs/m1-review-loop-one-iteration/`
  - `.opencode/tests/fixtures/runs/m1-review-loop-hit-cap/`

Each fixture directory MUST minimally contain:
- `manifest.json` and `gates.json`
- required stage artifacts consistent with its scenario:
  - `perspectives.json`
  - `wave-1/` outputs
  - `pivot.json`
  - (if wave2 used) `wave-2/` outputs
  - `citations/` artifacts needed for Gate C
  - `summaries/summary-pack.json`
  - `synthesis/final-synthesis.md`
  - `review/review-bundle.json`

### 1.4 Stage transition coverage required for M1
M1 must cover every transition in `spec-stage-machine-v1.md` either via:
- deterministic entity tests in `deep_research_stage_advance.test.ts`, or
- the M1 smoke test loop.

---

## 2) Milestone M2 — Live Wave 1 works (first real operator milestone)

### 2.1 What M2 proves
M2 proves a real operator run can:
- select/produce perspectives
- plan wave1
- spawn agents for wave1
- ingest/capture agent outputs deterministically into the run root
- validate/review wave outputs
- write Gate B and pivot decision
- advance to stage `pivot`

### 2.2 Required new ingestion tool + entity test (exact paths)
- **MUST ADD tool**: `.opencode/tools/deep_research/wave_output_ingest.ts`
- **MUST ADD test**: `.opencode/tests/entities/deep_research_wave_output_ingest.test.ts`

Ingest test must prove:
- batch write to `wave-1/<id>.md` at declared paths
- deterministic ingest evidence artifact exists (defined by tool contract)
- typed failures for:
  - unknown perspective id
  - path traversal attempts

### 2.3 Orchestrator boundary test (fixture driver, deterministic)
- **MUST ADD**: `.opencode/tests/entities/deep_research_orchestrator_tick_fixture.test.ts`

This must drive `init → pivot` using a fixture driver (no agents) and assert:
- wave plan exists
- wave outputs exist
- wave review exists
- Gate B recorded
- pivot artifact exists

### 2.4 Live smoke test (gated)
- **MUST ADD**: `.opencode/tests/smoke/deep_research_live_wave1_smoke.test.ts`

Gated by:
- `PAI_DR_OPTION_C_ENABLED=1`
- `PAI_DR_LIVE_TESTS=1`

Must assert:
- stage reaches `pivot`
- run root contains wave outputs, wave review, Gate B recorded, audit trail

---

## 3) Milestone M3 — Live end-to-end finalize

### 3.1 Required live finalize smoke test (gated)
- **MUST ADD**: `.opencode/tests/smoke/deep_research_live_finalize_smoke.test.ts`

Gated by:
- `PAI_DR_OPTION_C_ENABLED=1`
- `PAI_DR_LIVE_TESTS=1`

Must assert:
- `manifest.stage.current === "finalize"`
- `manifest.status === "completed"`
- Gate E pass recorded
- synthesis + review artifacts exist
- audit trail includes every transition

Also include failure path assertion:
- if Gate E fails at iteration cap, `manifest.status === "failed"` and `review/terminal-failure.json` exists.

---

## 4) Parallelizable implementation breakdown (subagent-friendly)

### Group A — M1 smoke + fixtures
- Implement smoke test + create `m1-*` fixture directories.

### Group B — Complete stage_advance transition coverage
- Add missing transition block/happy tests in `.opencode/tests/entities/deep_research_stage_advance.test.ts`.

### Group C — Ingest tool + entity test
- Implement `wave_output_ingest` tool + tests.

### Group D — Orchestrator fixture driver boundary test
- Implement orchestrator tick test and, optionally, a tool-shaped orchestrator tick.

### Group E — Live smoke tests (gated)
- Implement M2/M3 smoke tests.

---

## 5) Completion gates

This testing plan is “done” when:
- M1 smoke passes deterministically.
- All stage transitions have deterministic tests (typed failures).
- Ingest tool exists with entity tests.
- Orchestrator fixture boundary test exists.
- Live smoke tests exist, are gated, and produce operator-grade artifacts.
