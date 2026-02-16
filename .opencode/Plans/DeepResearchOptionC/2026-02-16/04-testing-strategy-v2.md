# Deep Research Option C — Testing Strategy (v2)

> **Compatibility note:** This v2 strategy is explicitly compatible with the existing **entity test** approach in `.opencode/tests/entities/**` (Bun tests that execute exported tools and assert on return JSON + disk artifacts via `dr-harness.ts`).

## 0) Why this exists (and what it must prevent)

Option C is a pipeline of **deterministic entities** (tools/commands/stage transitions) plus a missing “final mile” **orchestrator driver loop**. The testing strategy must:

1) Keep every step **isolatable in seconds** (no “rerun the world” debugging).
2) Enforce **determinism by construction** (same inputs → same outputs and same artifacts).
3) Require **artifact-first assertions** (disk outputs + returned JSON contracts).
4) Require **negative tests as first-class** (typed errors; expected failure outputs).
5) Prevent **false confidence** (tests that pass while real operator runs fail).

This strategy is an **engineering contract**: you can implement new Option C features only by expanding this test lattice.

---

## 1) Core principles (v2)

### P1 — Test entities, not helpers (unchanged)
- Unit under test is a stable **tool/command/orchestrator step** with a contract.
- Helpers may exist only for **test harness** (e.g., `dr-harness.ts`), but helpers are not the target of testing.

### P2 — Artifact-first blackbox verification (unchanged, strengthened)
Every entity test must assert:
- **Tool return JSON contract** (parsed via `parseToolJson`)
- **Artifact presence + content** on disk (manifest/gates/audit/stage folders, etc.)
- **Invariants** (schema versions, revisions monotonic, stable ordering)

### P3 — Determinism is a requirement, not a preference
Determinism must be proven by tests, not assumed:
- Re-running the same entity with the same artifacts must return the same result.
- Where timestamps exist, tests must either:
  - assert **format + presence** only, or
  - normalize/strip the volatile fields before comparison.

### P4 — Driver injection boundary is mandatory (orchestrator readiness)
To support fixture/offline runs and live runs, the orchestrator must depend on injected drivers.

**Boundary rule:**
- **Tools that compute/validate artifacts** must be deterministic and **must not** call the network or spawn agents.
- **Orchestrator live mode** may spawn agents / retrieve web content, but only *through injected drivers*.

This is how we refine steps without rerunning full research.

### P5 — Single-purpose tests with clear names (adopted from tmp notes)
- Each test proves **one behavior**, not “a bunch of stuff.”
- Prefer “one behavior per test” over “one assert per test” (Bun often needs multiple `expect`s to prove the behavior cleanly).
- Test names must read like executable spec.

Example style:
- ✅ `advances init -> wave1 when perspectives artifact exists`
- ✅ `returns MISSING_ARTIFACT when perspectives.json missing`
- ❌ `works` / `handles errors` / `should be ok`

### P6 — Test lists drive design (adopted; required)
Before implementing a new entity or adding a new capability, create a **TDD test list** that enumerates behaviors.

**Required mechanism (lightweight, repo-native):**
- At the top of each new/modified entity test file, add a comment block:

```ts
// TEST LIST (deep_research_<entity>)
// [ ] happy path writes artifact X at path Y
// [ ] deterministic for fixed inputs
// [ ] returns <ERROR_CODE> for <negative condition>
// [ ] preserves stable ordering / digest contract
```

This forces upfront clarity and prevents “tests that only mirror implementation.”

---

## 2) Test taxonomy (v2) — what kinds of tests we run

> The taxonomy is ordered from fastest/most deterministic to slowest/most integration-heavy.

### T0 — Schema + invariant contract tests (fastest, pure)
Purpose: validate deterministic schemas and lifecycle rules.

Examples (existing patterns):
- `.opencode/tests/entities/deep_research_manifest_write.test.ts`
- `.opencode/tests/entities/deep_research_gates_write.test.ts`

What they assert:
- schema version strings
- optimistic locking (`REVISION_MISMATCH`)
- immutable field rejection (`IMMUTABLE_FIELD`)
- lifecycle rule violations (`LIFECYCLE_RULE_VIOLATION`)
- audit append exists and contains typed events

### T1 — Entity contract tests (primary “unit”)
Purpose: validate each exported entity’s stable contract: **inputs → return JSON → disk artifacts**.

Pattern (existing, canonical):
- execute tool via `(tool as any).execute(args, makeToolContext())`
- `parseToolJson(raw)` → assert `ok` and typed `error.code`
- assert artifacts using `fs.readFile`, `fs.stat`, `path.join`

These remain the dominant test category.

### T2 — Stage machine transition tests (deterministic state machine)
Purpose: prove stage transitions are driven only by artifacts + gate state.

Entity under test:
- `deep_research_stage_advance` (`.opencode/tools/deep_research/stage_advance.ts`)

Must cover:
- every transition in `spec-stage-machine-v1.md`
- “requested_next” constraints (`REQUESTED_NEXT_NOT_ALLOWED`)
- hard blocks:
  - `MISSING_ARTIFACT` when required artifact missing
  - `GATE_BLOCKED` when gate status is not pass
  - `WAVE_CAP_EXCEEDED` for wave2 gap id cap

### T3 — Fixture replay tests (offline deterministic “same bytes”)
Purpose: replay frozen fixture bundles and ensure deterministic outcomes and **byte-stable** reports/artifacts when expected.

Existing example:
- `.opencode/tests/entities/deep_research_fixture_replay.test.ts`

Key properties:
- replaying the same fixture twice yields identical report object
- replay report file content is byte-equal across replays

### T4 — Fixture regression suites (batch offline replay)
Purpose: keep a small library of fixture bundles as a permanent regression net.

Existing example:
- `.opencode/tests/regression/deep_research_phase06_regression.test.ts`

### T5 — Smoke tests (end-to-end wiring, but still deterministic)
Purpose: prove wiring correctness across multiple entities with minimal scenarios.

For Option C milestones, smoke tests are split into:
- **M1: Offline fixture finalize smoke** (deterministic, no web, no agents)
- **M2/M3: Live smoke** (gated; produces strong artifacts)

---

## 3) Determinism rules (explicit, enforceable)

### D1 — No network / no agents in deterministic suites
For **T0–T5 offline** tests:
- MUST set `PAI_DR_NO_WEB=1` where relevant
- MUST NOT spawn agent Tasks
- MUST NOT call web tools
- MUST rely only on fixtures and deterministic calculators/validators

### D2 — Controlled filesystem roots
- Use `withTempDir(...)` for run roots.
- Use `run_init` with `{ root_override: base, run_id }` whenever possible.
- Never write into real user runtime dirs in tests.

### D3 — Stable ordering always
Any entity that accepts lists or reads directories must enforce stable ordering.

### D4 — Deterministic digests are contractual outputs
If an entity emits a digest, tests must assert format + determinism.

### D5 — Volatile timestamps must not break tests
Assert presence/shape or normalize volatile fields.

### D6 — “Fail for the right reason” is required
Failures must assert exact `error.code`, meaningful `error.details`, and no partial advancement.

---

## 4) Driver injection boundary (fixture vs live) — explicit contract

### 4.1 The boundary we enforce
**Stage machine and entity tools are deterministic**; the orchestrator is the only component that may call external systems.

### 4.2 Orchestrator driver interface (required; aligned with operator plan v4)

```ts
export interface OrchestratorDrivers {
  runAgent(input: {
    perspective_id: string;
    agent_type: string;
    prompt_md: string;
  }): Promise<{
    markdown: string;
    agent_run_id?: string;
    started_at?: string;
    finished_at?: string;
    error?: { code: string; message: string };
  }>;

  nowIso(): string;
  sleepMs(ms: number): Promise<void>;

  retrieve?(input: { url: string; reason: string }): Promise<{ ok: boolean; status: number; body?: string }>;

  logEvent?(kind: string, payload: Record<string, unknown>): void;
}
```

### 4.3 Fixture vs live implementation rule
- Fixture driver returns deterministic outputs, fixed time, no-op sleeps.
- Live driver spawns real agents (Task tool) and MUST persist evidence.

---

## 5) Artifact-based assertions (what we treat as truth)

Canonical artifacts include:
- `manifest.json`, `gates.json`, `logs/audit.jsonl`
- stage dirs: `wave-1/`, `wave-2/`, `citations/`, `summaries/`, `synthesis/`, `review/`
- stage artifacts: `perspectives.json`, `wave1-plan.json`, `pivot.json`, `citations.jsonl`, `summary-pack.json`, `final-synthesis.md`, `review-bundle.json`

Avoid brittle snapshots; prefer semantic assertions + normalization utilities in `.opencode/tests/helpers/normalize.ts`.

---

## 6) Negative-test requirements (non-negotiable)

Every new entity must ship with:
1) happy-path contract test
2) determinism repeat test
3) at least one negative-path typed failure test

Stage transitions must cover missing-artifact and gate-blocked variants.

---

## 7) Preventing false confidence (explicit anti-patterns)

Countermeasures:
- M1 offline finalize smoke
- M2 live wave1 evidence run
- M3 live finalize evidence run
- no entity merges without negative tests

---

## 8) Structure + execution conventions

Directories:
- `.opencode/tests/entities/**` (primary)
- `.opencode/tests/fixtures/**`
- `.opencode/tests/regression/**`
- `.opencode/tests/smoke/**` (to be added)

Env gating:
- offline suites: `PAI_DR_NO_WEB=1`
- live suites: `PAI_DR_LIVE_TESTS=1` (proposed; required)

---

## 9) Acceptance: what “testing strategy v2 implemented” means

Satisfied when:
1) Every stage transition is covered by deterministic tests.
2) M1 offline finalize smoke exists and passes.
3) M2/M3 live smoke tests exist, gated, and produce operator-grade artifacts.
4) Every new entity ships with happy + deterministic + negative tests.
