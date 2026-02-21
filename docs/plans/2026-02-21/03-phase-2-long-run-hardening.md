# Deep Research Option C — Phase 2 (long-run hardening) Implementation Plan

> **For the executor:** REQUIRED SUB-SKILL: Use  executing-plans skill to implement this plan task-by-task.

**Goal:** Make long-running runs (30–120+ minutes) reliable by removing O(n) telemetry bottlenecks, improving timeout configurability, and making citations ladder policies explicit.

**Architecture:** Keep deterministic artifacts. Add small index artifacts where needed (e.g., telemetry seq index) and persist policies in run-config rather than in code constants.

**Tech Stack:** Bun + TypeScript; `.opencode/tools/deep_research_cli/**`.

---

## Phase outputs (deliverables)

- Telemetry append is no longer O(n) per event.
- Stage timeouts are configurable per run (persisted artifact), and watchdog uses them.
- Citations ladder budgets/backoff are explicit and persisted.
- Run lock lease/heartbeat policy is configurable per run.
- Repeated `run_metrics_write` runs can skip when telemetry index is unchanged.

## Task 2.1: Add failing regression test for telemetry append scalability

**Files:**
- Create: `.opencode/tests/regression/deep_research_telemetry_append_scaling_regression.test.ts`
- Modify later: `.opencode/tools/deep_research_cli/telemetry_append.ts`

**Step 1: Write a regression test that appends N events and asserts runtime stays bounded**

Notes:
- Use a temp run root.
- Append e.g. 5k events.
- Set a generous threshold at first (the goal is to detect accidental O(n^2)).

Expected today: this might be slow/flaky — if so, reduce N and focus on ensuring seq generation is not “read entire file each time”.

## Task 2.2: Replace O(n) seq derivation with a small index artifact

**Files:**
- Modify: `.opencode/tools/deep_research_cli/telemetry_append.ts`
- Create: `.opencode/tools/deep_research_cli/telemetry_index_lib.ts` (if needed)

**Step 1: Introduce an index file**

- Example: `logs/telemetry.index.json` containing `{ schema_version, last_seq }`.
- On append:
  - read index (or create)
  - compute next seq
  - append JSONL line
  - update index atomically

**Step 2: Make scaling regression PASS**

**Step 3: Commit**

```bash
git add .opencode/tools/deep_research_cli/telemetry_append.ts .opencode/tools/deep_research_cli/telemetry_index_lib.ts .opencode/tests/regression/deep_research_telemetry_append_scaling_regression.test.ts
git commit -m "perf(dr): make telemetry append O(1) via index artifact"
```

## Task 2.3: Make stage timeouts configurable per run (persisted policy)

**Files:**
- Modify: `.opencode/tools/deep_research_cli/watchdog_check.ts`
- Modify: `.opencode/tools/deep_research_cli/run_init.ts` (write default policy)
- Create: `.opencode/tools/deep_research_cli/run_policy_read.ts`
- Create: `.opencode/tests/regression/deep_research_timeout_policy_regression.test.ts`

**Step 1: Define policy artifact**

- Example: `run-config/policy.json` with:
  - stage_timeouts_seconds_v1
  - citations_ladder_policy_v1

**Step 2: Write failing regression test**

- Create a run root with a policy overriding one stage timeout.
- Assert `watchdog_check` uses policy timeout instead of constant.

**Step 3: Implement policy read + wire into watchdog_check**

**Step 4: Commit**

```bash
git add .opencode/tools/deep_research_cli/watchdog_check.ts .opencode/tools/deep_research_cli/run_init.ts .opencode/tools/deep_research_cli/run_policy_read.ts .opencode/tests/regression/deep_research_timeout_policy_regression.test.ts
git commit -m "feat(dr): make watchdog timeouts configurable via run policy"
```

## Task 2.4: Persist citations ladder budgets/backoff policy

**Files:**
- Modify: `.opencode/tools/deep_research_cli/citations_validate_lib.ts`
- Modify: `.opencode/tools/deep_research_cli/citations_validate.ts`
- Create: `.opencode/tests/regression/deep_research_citations_ladder_policy_regression.test.ts`

**Step 1: Write failing regression test**

- Provide a policy that changes timeout/backoff.
- Assert validator uses policy-derived timeouts.

**Step 2: Implement policy plumbing**

- Read policy from run root.
- Pass into citations ladder functions.

**Step 3: Commit**

```bash
git add .opencode/tools/deep_research_cli/citations_validate_lib.ts .opencode/tools/deep_research_cli/citations_validate.ts .opencode/tests/regression/deep_research_citations_ladder_policy_regression.test.ts
git commit -m "feat(dr): persist citations ladder policy in run config"
```

## Task 2.5: Make run lock lease/heartbeat policy configurable per run

**Files:**
- Modify: `.opencode/tools/deep_research_cli/run_init.ts` (write defaults into policy)
- Modify: `.opencode/tools/deep_research_cli/run_policy_read.ts` (read lock policy)
- Modify: `.opencode/tools/deep_research_cli/orchestrator_tick_{live,post_pivot,post_summaries,fixture}.ts` (use policy values)
- Create: `.opencode/tests/regression/deep_research_run_lock_policy_regression.test.ts`

**Step 1: Extend policy schema**

Add:

```json
{
  "schema_version": "run_policy.v1",
  "stage_timeouts_seconds_v1": { ... },
  "run_lock_policy_v1": {
    "lease_seconds": 120,
    "heartbeat_interval_ms": 30000,
    "heartbeat_max_failures": 1
  }
}
```

**Step 2: Regression test**

- Write a policy with very small intervals and ensure `run_policy_read` returns the configured values.

**Step 3: Wire policy into orchestrators**

- Use `lease_seconds` for `acquireRunLock`.
- Use `heartbeat_interval_ms`/`lease_seconds`/`heartbeat_max_failures` for `startRunLockHeartbeat`.

**Step 4: Commit**

```bash
git add \
  .opencode/tools/deep_research_cli/run_init.ts \
  .opencode/tools/deep_research_cli/run_policy_read.ts \
  .opencode/tools/deep_research_cli/orchestrator_tick_live.ts \
  .opencode/tools/deep_research_cli/orchestrator_tick_post_pivot.ts \
  .opencode/tools/deep_research_cli/orchestrator_tick_post_summaries.ts \
  .opencode/tools/deep_research_cli/orchestrator_tick_fixture.ts \
  .opencode/tests/regression/deep_research_run_lock_policy_regression.test.ts
git commit -m "feat(dr): make run lock policy configurable per run"
```

## Task 2.6: Make run_metrics_write skip when telemetry index is unchanged

**Files:**
- Modify: `.opencode/tools/deep_research_cli/run_metrics_write.ts`
- Create: `.opencode/tests/regression/deep_research_run_metrics_write_skip_regression.test.ts`

**Step 1: Define skip rule**

- If `logs/telemetry.index.json.last_seq` equals `metrics/run-metrics.json.run.last_seq` (new field you add), return `ok({ skipped: true, reason: "telemetry unchanged" })` without reading telemetry.jsonl.

**Step 2: Add regression test**

- Run `run_metrics_write` twice with no new telemetry.
- Assert the second call returns `skipped:true`.

**Step 3: Commit**

```bash
git add .opencode/tools/deep_research_cli/run_metrics_write.ts .opencode/tests/regression/deep_research_run_metrics_write_skip_regression.test.ts
git commit -m "perf(dr): skip run_metrics_write when telemetry index unchanged"
```

## Phase 2 Gate (completion)

**Gate execution (required):**

- Architect agent must review the phase diff and report **PASS/FAIL** against the Architect checklist.
- QATester agent must run the QA checklist commands and report **PASS/FAIL** with the raw test output.

### Architect Gate — PASS checklist

- [ ] All new policies are persisted artifacts (no hidden env reliance).
- [ ] Determinism is preserved (policy changes are explicit and recorded).
- [ ] Performance fixes do not change semantics.

### QA Gate — PASS checklist

Run:

```bash
bun test .opencode/tests/regression/deep_research_telemetry_append_scaling_regression.test.ts
bun test .opencode/tests/regression/deep_research_timeout_policy_regression.test.ts
bun test .opencode/tests/regression/deep_research_citations_ladder_policy_regression.test.ts

# baseline suite
bun test .opencode/tests/smoke/deep_research_live_finalize_smoke.test.ts
```

Expected: all PASS.
