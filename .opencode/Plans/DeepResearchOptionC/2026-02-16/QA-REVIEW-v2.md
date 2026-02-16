# QA Review — Operator Pipeline Plan v2

## Verdict (runnable + verifiable plan?)
**Status: FAIL**

**Why (blocking):** v2 explicitly states the operator-grade orchestrator/command does not yet exist, and key acceptance artifacts/tests/fixtures are described but not concretely specified/implementable from the plan alone.

Evidence:
- v2: “We do **not** yet have a full ‘operator command’…” (v2:24–29).
- v2: “Define M1 smoke artifact (test file path + exact assertions) and implement it.” is future work (v2:170–172).

---

## Missing tests / fixtures (needed for “runnable + verifiable”)

### 1) M1 offline end-to-end “finalize” smoke test is not concretely defined
v2 requires a CI-runnable smoke artifact, but does not specify:
- exact test filename/location
- exact fixture scenario name
- exact assertions per stage and per gate

Minimum needed:
- A single test file (example): `.opencode/tests/smoke/deep_research_fixture_finalize.test.ts` that:
  - creates temp root
  - runs `run_init` with `root_override`
  - installs a fixture tree representing minimal path to `finalize`
  - advances stages via `stage_advance` until `finalize`
  - validates required artifacts and schema validity

### 2) Fixture bundles are referenced conceptually, but no fixture inventory or schema is specified
Needed:
- fixture directory layout
- minimal fixture scenarios (happy path, gate fail, retry, wave2-skip)
- timestamp/path normalization rules

Minimum fixture set:
- `fixtures/runs/m1-finalize-happy/` (pivot chooses citations, no wave2)
- `fixtures/runs/m3-max-iterations/` (forces bounded retry loop)
- `fixtures/runs/gate-b-blocks/`
- `fixtures/runs/gate-c-blocks/`

### 3) Stage transition tests listed, but not all are implementable offline as written
The matrix row `wave2 → citations` depends on “live orchestrator writes” (v2:110–111). For offline M1 finalize, the plan must define a deterministic skip/fixture path.

Minimum needed:
- deterministic “wave artifacts ingest” entity, or explicit “wave2 skipped” artifact contract usable in fixture-run.

### 4) “Doc surface test” is required but not specified
v2 requires a test that fails if docs reference non-existent tools (v2:124–133), but does not define:
- test name/location
- parsing rules
- canonical tool registry

---

## Missing evidence hooks (needed to prove acceptance offline)

### A) Gate B evidence needs a deterministic compute/report hook
“Gate B written” is not proof unless metrics are computed deterministically from artifacts and recorded.

### B) Orchestrator actions need auditable, replayable event logs
Need:
- minimum audit event schema (kinds + required fields)
- fixture-run driver that writes the same audit events
- tests asserting audit contains required events

### C) Idempotency/revision control lacks a testable hook
Need:
- revision policy artifact + enforcement
- negative tests proving no rewrites without policy

---

## Can M1/M2/M3 acceptance be proven without live research?
**Conceptually: YES. Practically, with current specificity: NOT YET PROVABLE.**

---

## Minimal changes that would flip this to PASS
1) Add one concrete M1 smoke test spec: exact file path + fixture scenario + assertions.
2) Define fixture tree schema + at least one “finalize-happy” fixture scenario.
3) Add deterministic Gate B compute/report hook (or explicitly scope Gate B evidence requirements).
4) Specify orchestrator audit event kinds required for M2/M3 CI proof.
