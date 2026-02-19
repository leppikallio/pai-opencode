# Deep Research Option C — Testing Strategy (v1)

## Why this exists
Option C is becoming a set of **concrete functional entities** (tools/commands/orchestrator stages). We need:
- **behavior-level tests** (not internal helper tests)
- **per-entity isolation** (debug one entity without running full research)
- **deterministic fixtures/dry-run** so tests run in seconds

This strategy is a **cross-phase requirement** for Phase 01 onward.

---

## Principles

1) **Test entities, not helpers.**
   - The unit under test is a *tool*, *command*, or *orchestrator stage step* with a stable contract.

2) **Artifact-first blackbox verification.**
   - Assert on disk outputs (`manifest.json`, `gates.json`, `logs/audit.jsonl`, stage folders) + returned JSON contract.

3) **Determinism by construction.**
   - Tests provide `run_id` and use temp dirs.
   - Avoid network and agent calls unless explicitly using a fixture replay.

4) **Fast isolation.**
   - Every entity must have a “seconds-fast” contract test that runs without a full deep research run.

5) **Gate-aligned scaling.**
   - Tests map to Gates A–F and expand as phases add functionality.

6) **Test lists drive design (entity behavior lists).**
   - For each new entity, create a short behavior-level test list before implementation.
   - Track progress by crossing off behaviors, not by internal function coverage.

---

## Entities (current and planned)

### Phase 01 substrate (exists)
- Tool: `deep_research_run_init` (export `run_init`)
- Tool: `deep_research_manifest_write` (export `manifest_write`)
- Tool: `deep_research_gates_write` (export `gates_write`)
- Tool: `deep_research_stage_advance` (export `stage_advance` — Phase 02 implementation)

### Phase 02 (planned)
- Orchestrator stage scheduler (deterministic stage transitions)
- Retry controller (bounded retries per spec)
- Watchdog / timeout controller
- Dry-run harness (fixture replay)

### Phase 03–07 (planned)
- Wave routing + fan-out execution + pivot/wave2 planner
- Citation validation services (Gate C)
- Summary pack builder/validator (Gate D)
- Synthesis + reviewer factory + rubric enforcement (Gate E)
- Observability + rollout hardening (Gate F)

---

## Test taxonomy

### 1) Entity contract tests (primary)
Validate each entity’s **inputs → return JSON → disk artifacts** contract.

Examples:
- `run_init` creates directory skeleton + writes valid `manifest.json` + `gates.json`.
- `manifest_write` rejects immutable patches, bumps revision, appends audit event.

### 2) Fixture replay tests (Phase 02+)
Re-run orchestrator/stage transitions using a frozen artifact tree fixture.

Pattern:
- Given `fixtures/runs/<scenario>/...` (manifest, gates, wave outputs), run `stage_advance` (or a single orchestrator “tick”) and compare results against an expected snapshot.

### 3) Gate metric tests (B–E)
Deterministic calculators (no LLM calls) that compute gate metrics from artifacts.

### 4) Smoke tests (minimal end-to-end)
Happy-path wiring checks using **dry-run** or fixture drivers.

---

## Repo structure (proposed)

```text
.opencode/tests/
  entities/
    deep_research_run_init.test.ts
    deep_research_manifest_write.test.ts
    deep_research_gates_write.test.ts
    deep_research_stage_advance.test.ts
  fixtures/
    runs/
      p01-minimal/
      p02-stage-advance-pass/
  helpers/
    dr-harness.ts
    normalize.ts
```

Notes:
- Tests live in the repo (not runtime), so they don’t depend on `~/.config/opencode` state.
- Helpers are allowed only as test harness utilities, not as “things we test”.

---

## Execution commands

- Run all deep research tests:
  - `bun test .opencode/tests`
- Run one entity in isolation:
  - `bun test .opencode/tests/entities/deep_research_manifest_write.test.ts`

CI:
- `bun test .opencode/tests`

Optional:
- Run only deep research entity tests:
  - `bun test .opencode/tests/entities`

---

## Isolation & mocking strategy

### Filesystem isolation (Phase 01+)
- Prefer explicit `run_id`.
- Prefer `root_override` passed to `run_init` (test-controlled temp root).
- Avoid asserting exact timestamps; normalize or assert presence + format.

### External web + agent execution isolation (Phase 02+)
Design Phase 02 orchestrator with injected drivers:
- `drivers.runAgent(...)` (fixture-driven in tests)
- `drivers.fetch(...)` / `drivers.search(...)` (stubbed)
- `drivers.clock.now()` (fixed time)
- `drivers.sleep(ms)` (no-op)

Test modes:
- **dry-run**: write planned actions only (no drivers invoked)
- **fixture-run**: drivers return recorded outputs

Design note:
- Make the orchestrator operate as an "advance one tick" function driven only by:
  - manifest + gates + existing artifacts
  - injected drivers
This keeps it testable without full runs.

---

## Artifact validation (blackbox)

For each entity test, validate:
- tool return JSON contract (`ok`, `error.code`, etc.)
- files created/updated (`manifest.json`, `gates.json`, `logs/audit.jsonl`)
- key invariants from the relevant spec (`schema_version`, revision monotonicity, required gates A–F)

---

## Gate mapping (A–F)

- **Gate A**: docs/spec existence checks (planning completeness)
- **Gate B**: stage engine determinism + wave output contract validators
- **Gate C**: citation pool integrity validators
- **Gate D**: summary pack boundedness validators
- **Gate E**: synthesis structure + citation utilization validators
- **Gate F**: rollout safety smoke tests + feature-flag behaviors

---

## Example (seconds-fast): test `run_init` + `manifest_write`

Key idea: supply `run_id` and `root_override`, then assert artifacts on disk.

Minimum behaviors to assert:
- `run_init` writes `manifest.json` + `gates.json`
- `manifest_write` bumps revision and appends a `manifest_write` audit record

Illustrative skeleton (Bun):

```ts
import { test, expect } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import os from "node:os";

import { run_init, manifest_write } from "../../tools/deep_research";

function parseOk(json: string) {
  const obj = JSON.parse(json);
  if (!obj?.ok) throw new Error(json);
  return obj;
}

test("deep_research_run_init writes manifest/gates", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dr-test-"));
  const out = parseOk(
    await run_init.execute(
      { query: "Q", mode: "standard", sensitivity: "normal", run_id: "dr_test_001", root_override: root },
      { sessionID: "test" } as any,
    ),
  );
  const manifest = JSON.parse(await fs.readFile(out.manifest_path, "utf8"));
  expect(manifest.schema_version).toBe("manifest.v1");
  expect(manifest.run_id).toBe("dr_test_001");
});

test("deep_research_manifest_write bumps revision and audits", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dr-test-"));
  const init = parseOk(
    await run_init.execute(
      { query: "Q", mode: "standard", sensitivity: "normal", run_id: "dr_test_002", root_override: root },
      { sessionID: "test" } as any,
    ),
  );
  parseOk(
    (await manifest_write.execute({
      manifest_path: init.manifest_path,
      expected_revision: 1,
      reason: "test",
      patch: { status: "running" },
    })) as any,
  );
  const updated = JSON.parse(await fs.readFile(init.manifest_path, "utf8"));
  expect(updated.revision).toBe(2);
  const auditPath = path.join(path.dirname(init.manifest_path), "logs", "audit.jsonl");
  const audit = await fs.readFile(auditPath, "utf8");
  expect(audit).toContain('"kind":"manifest_write"');
  expect(audit).toContain('"reason":"test"');
});
```

---

## Cross-phase requirement

**No phase may be signed off** unless:
- entity tests exist for new entities introduced in that phase
- tests can be run in isolation in seconds using fixtures/dry-run (no full research required)

---

## Rollout plan (tests by phase)

- **Phase 01 (immediately)**
  - Add entity contract tests for: `run_init`, `manifest_write`, `gates_write`.
  - Add a contract test for `stage_advance` returning `NOT_IMPLEMENTED` until Phase 02 lands.

- **Phase 02**
  - Add fixture replay tests for `stage_advance` (deterministic transition table).
  - Add dry-run harness tests that produce predictable artifacts without web/agents.

- **Phase 03**
  - Add contract tests for wave routing + perspective allocator outputs.
  - Add wave-output validator tests (Gate B metrics) using fixtures.

- **Phase 04–05**
  - Add Gate C/D/E metric tests from fixtures (no LLM).
  - Add synthesis/reviewer rubric conformance tests.

- **Phase 06–07**
  - Add watchdog + observability tests (simulated time).
  - Add rollout safety smoke tests + fallback path tests.
