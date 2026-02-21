# Deep Research Option C — Phase 1 (autonomy + quality) Implementation Plan

> **For the executor:** REQUIRED SUB-SKILL: Use  executing-plans skill to implement this plan task-by-task.

**Goal:** Reduce operator burden by extending the “agent runner seam” beyond Wave 1, and raise quality by enforcing prompt/tool budgets and clearer driver semantics.

**Architecture:** Introduce a *pluggable* `runAgent` capability for Wave 2 / summaries / synthesis in the tool layer, keeping existing task-driver behavior as a safe fallback.

**Tech Stack:** Bun + TypeScript; `.opencode/tools/deep_research_cli/**` orchestrators; `.opencode/pai-tools/deep-research-cli/**` driver wiring; bun:test regression/smoke tests.

---

## Phase outputs (deliverables)

- Wave 2 can run with a live `runAgent` seam (no more “missing artifacts unless operator writes them”).
- Summaries + synthesis can run with `runAgent` seam (live automation) while preserving existing task seams.
- Tool budgets are enforced (or at least “violations are detectable and gate-able”).
- Driver semantics are explicit and documented (fixture vs task vs live).

## Task 1.1: Architecture decision record (ADR) for live automation scope

**Files:**
- Create: `docs/architecture/deep-research/adr-2026-02-21-live-runner.md`

**Step 1: Write ADR (short, 1–2 pages)**

Include:
- What “live automation” means in Option C
- Why we extend `runAgent` seam beyond wave1
- What we will NOT do (no OpenCode changes; no hidden background daemons)
- Failure modes + fallback behavior (task seam remains available)

**Step 2: Commit**

```bash
git add docs/architecture/deep-research/adr-2026-02-21-live-runner.md
git commit -m "docs(dr): ADR for live runner seam beyond wave1"
```

## Task 1.2: Add failing regression test: wave2 in live mode calls runAgent when missing

**Files:**
- Create: `.opencode/tests/regression/deep_research_wave2_live_runagent_regression.test.ts`
- Modify later: `.opencode/tools/deep_research_cli/orchestrator_tick_post_pivot.ts`

**Step 1: Write failing test (shape)**

- Seed a run root to `pivot` then into `wave2` planning.
- Force missing wave2 outputs.
- Run `orchestrator_tick_post_pivot` in `driver="live"` with a stubbed `runAgent` that returns deterministic markdown.
- Assert tick returns `ok:true` and wave2 output files exist.

**Step 2: Run and confirm FAIL**

Expected: FAIL (today live mode returns `MISSING_ARTIFACT` instead of calling an agent seam).

## Task 1.3: Implement live runAgent seam for wave2

**Files:**
- Modify: `.opencode/tools/deep_research_cli/orchestrator_tick_post_pivot.ts`
- Potentially modify tool signature plumbing in `.opencode/tools/deep_research_cli/orchestrator_tick_post_pivot.ts` exports (to accept a `drivers` arg)
- Modify CLI plumbing as needed: `.opencode/pai-tools/deep-research-cli/handlers/tick-internals.ts`

**Step 1: Add a `drivers?: { runAgent }` param to orchestrator tick (post pivot)**

- In `driver === "live"`, when wave2 outputs are missing:
  - call `drivers.runAgent({ run_root, stage: "wave2", perspective_id, prompt_md, ... })`
  - write markdown output and meta sidecar (prompt digest)
  - proceed with validation as today

**Step 2: Make regression PASS**

Run:

```bash
bun test .opencode/tests/regression/deep_research_wave2_live_runagent_regression.test.ts
```

**Step 3: Commit**

```bash
git add .opencode/tools/deep_research_cli/orchestrator_tick_post_pivot.ts .opencode/pai-tools/deep-research-cli/handlers/tick-internals.ts .opencode/tests/regression/deep_research_wave2_live_runagent_regression.test.ts
git commit -m "feat(dr): add live runAgent seam for wave2"
```

## Task 1.4: Add failing regression tests: summaries + synthesis in live mode call runAgent when missing

**Files:**
- Create: `.opencode/tests/regression/deep_research_summaries_live_runagent_regression.test.ts`
- Create: `.opencode/tests/regression/deep_research_synthesis_live_runagent_regression.test.ts`
- Modify later: `.opencode/tools/deep_research_cli/orchestrator_tick_post_summaries.ts`

**Step 1: Write failing tests**

- Similar shape: create run root staged at `summaries` and at `synthesis` with missing artifacts.
- Run orchestrator tick in `driver="live"` with stubbed runAgent.
- Assert artifacts are created and tick returns ok.

**Step 2: Run and confirm FAIL**

Expected: FAIL (today live mode relies on deterministic generate/task seams, not runAgent for these stages).

## Task 1.5: Implement live runAgent seam for summaries + synthesis

**Files:**
- Modify: `.opencode/tools/deep_research_cli/orchestrator_tick_post_summaries.ts`
- Modify CLI plumbing as needed: `.opencode/pai-tools/deep-research-cli/handlers/tick-internals.ts`

**Step 1: Add `drivers?: { runAgent }` parameter + implement live behavior**

- For summaries:
  - When missing `operator/outputs/summaries/*.md` (or final summary files), call runAgent per perspective.
- For synthesis:
  - When missing `synthesis/final-synthesis.md`, call runAgent once to produce it.

**Step 2: Make regression tests PASS**

```bash
bun test .opencode/tests/regression/deep_research_summaries_live_runagent_regression.test.ts
bun test .opencode/tests/regression/deep_research_synthesis_live_runagent_regression.test.ts
```

**Step 3: Commit**

```bash
git add .opencode/tools/deep_research_cli/orchestrator_tick_post_summaries.ts .opencode/tests/regression/deep_research_summaries_live_runagent_regression.test.ts .opencode/tests/regression/deep_research_synthesis_live_runagent_regression.test.ts
git commit -m "feat(dr): add live runAgent seam for summaries and synthesis"
```

## Task 1.6: Enforce prompt/tool budgets (detectable + gate-able)

**Files:**
- Modify: `.opencode/tools/deep_research_cli/wave_output_validate.ts`
- Modify: `.opencode/tools/deep_research_cli/schema_v1.ts` (if needed to add machine-readable budget reporting fields)
- Create: `.opencode/tests/regression/deep_research_tool_budget_enforcement_regression.test.ts`

**Step 1: Define the enforcement surface**

Minimum viable enforcement:
- Require a sidecar field that records tool usage counts (even if 0)
- In validator, fail if recorded usage exceeds `prompt_contract.tool_budget`

**Step 2: Write failing regression test**

- Create a fake perspective with budget `{ search_calls: 0, fetch_calls: 0 }`
- Provide a sidecar claiming `{ search_calls: 1 }`
- Assert validator fails with a clear code.

**Step 3: Implement validator enforcement + make test PASS**

**Step 4: Commit**

```bash
git add .opencode/tools/deep_research_cli/wave_output_validate.ts .opencode/tests/regression/deep_research_tool_budget_enforcement_regression.test.ts
git commit -m "feat(dr): enforce prompt tool budgets in wave output validation"
```

## Phase 1 Gate (must PASS before Phase 2)

**Gate execution (required):**

- Architect agent must review the phase diff and report **PASS/FAIL** against the Architect checklist.
- QATester agent must run the QA checklist commands and report **PASS/FAIL** with the raw test output.

### Architect Gate — PASS checklist

- [ ] `runAgent` seam is extended beyond wave1 in a pluggable way (no forced automation).
- [ ] Task seams still work and remain the safe fallback.
- [ ] New enforcement surfaces are explicit and artifact-backed.

### QA Gate — PASS checklist

Run:

```bash
# new regression tests
bun test .opencode/tests/regression/deep_research_wave2_live_runagent_regression.test.ts
bun test .opencode/tests/regression/deep_research_summaries_live_runagent_regression.test.ts
bun test .opencode/tests/regression/deep_research_synthesis_live_runagent_regression.test.ts
bun test .opencode/tests/regression/deep_research_tool_budget_enforcement_regression.test.ts

# baseline suite
bun test .opencode/tests/smoke/deep_research_live_wave1_smoke.test.ts
bun test .opencode/tests/smoke/deep_research_live_finalize_smoke.test.ts
```

Expected: all PASS.
