# Deep Research Option C — Phase 2b (crash recovery + config contracts) Implementation Plan

> **For the executor:** REQUIRED SUB-SKILL: Use  executing-plans skill to implement this plan task-by-task.

**Goal:** Harden long runs beyond perf/timeouts by adding crash-recovery markers, making lock lease/heartbeat policy configurable per run, and removing remaining O(n) telemetry consumers.

**Architecture:** Extend the existing artifact-first approach:
- treat tick start/finish as explicit ledger events (`logs/ticks.jsonl`),
- persist run policies in a small JSON file (same model as Phase 2),
- read policy deterministically in orchestrators and watchdog.

**Tech Stack:** Bun + TypeScript; `.opencode/tools/deep_research_cli/**`; `.opencode/pai-tools/deep-research-cli/**`; bun:test regression/entity tests.

---

## Phase outputs (deliverables)

- Every orchestrator tick appends:
  - a `phase:"start"` ledger entry
  - a `phase:"finish"` ledger entry
- A crash-recovery check exists:
  - if a previous tick started but never finished, emit a typed halt/checkpoint artifact before proceeding.
- Lock lease and heartbeat interval are configurable per run policy (not hard-coded 120s / 30s).
- `run_metrics_write` no longer does an O(n) full telemetry read per write.

## Task 2b.1: Create Phase 2b worktree

**Files:**
- (none)

**Step 1: Create a worktree**

```bash
git worktree add /tmp/pai-dr-phase2b -b dr-phase2b-crash-recovery
```

**Step 2: Verify clean state**

```bash
git status --porcelain
```

Expected: empty output.

---

## Task 2b.2: Add failing regression test for tick ledger start/finish entries

**Files:**
- Create: `.opencode/tests/regression/deep_research_tick_ledger_regression.test.ts`
- Modify later:
  - `.opencode/tools/deep_research_cli/orchestrator_tick_live.ts`
  - `.opencode/tools/deep_research_cli/orchestrator_tick_post_pivot.ts`
  - `.opencode/tools/deep_research_cli/orchestrator_tick_post_summaries.ts`

**Step 1: Write failing test (shape)**

Test outline:

1) Seed a run root via `run_init` into a stage where `orchestrator_tick_live` can run.
2) Execute one orchestrator tick.
3) Read `<run_root>/logs/ticks.jsonl`.
4) Assert it contains at least two entries for the same `tick_index`:
   - one with `phase == "start"`
   - one with `phase == "finish"`

Expected today: FAIL (tick ledger tool exists but is not called by orchestrators).

**Step 2: Run to confirm failure**

```bash
bun test .opencode/tests/regression/deep_research_tick_ledger_regression.test.ts
```

---

## Task 2b.3: Append tick ledger entries from orchestrators (make regression PASS)

**Files:**
- Modify:
  - `.opencode/tools/deep_research_cli/orchestrator_tick_live.ts`
  - `.opencode/tools/deep_research_cli/orchestrator_tick_post_pivot.ts`
  - `.opencode/tools/deep_research_cli/orchestrator_tick_post_summaries.ts`
- Use tool: `.opencode/tools/deep_research_cli/tick_ledger_append.ts`

**Step 1: Add a tick index source**

Choose one deterministic tick index source per run:

- Option A (simple): derive tick index by counting existing `operator/halt/tick-*.json` + 1.
- Option B (better): create `logs/tick-index.json` stored and updated atomically.

Start with Option A unless collisions appear.

**Step 2: Call tick_ledger_append at start and finish**

At the top of each orchestrator tick, call:

```ts
await (tick_ledger_append as any).execute({
  manifest_path: manifestPath,
  entry: {
    tick_index: tickIndex,
    phase: "start",
    stage_before: from,
    stage_after: from,
    status_before: status,
    status_after: status,
    result: { ok: true },
  },
  reason: `orchestrator tick start: ${reason}`,
});
```

In `finally {}` (or right before returning), append the finish entry with the actual `result.ok` and `stage_after`.

**Step 3: Re-run regression test + commit**

```bash
bun test .opencode/tests/regression/deep_research_tick_ledger_regression.test.ts
git add \
  .opencode/tools/deep_research_cli/orchestrator_tick_live.ts \
  .opencode/tools/deep_research_cli/orchestrator_tick_post_pivot.ts \
  .opencode/tools/deep_research_cli/orchestrator_tick_post_summaries.ts \
  .opencode/tests/regression/deep_research_tick_ledger_regression.test.ts
git commit -m "feat(dr): append tick ledger start/finish entries"
```

---

## Task 2b.4: Add crash-recovery preflight (detect unfinished tick)

**Files:**
- Create: `.opencode/tools/deep_research_cli/tick_recovery_check.ts`
- Modify orchestrators to call it early
- Create: `.opencode/tests/regression/deep_research_tick_recovery_regression.test.ts`

**Step 1: Write failing regression test**

Test outline:

1) Seed a run root.
2) Manually write a `logs/ticks.jsonl` entry with `phase:"start"` for `tick_index=1` and no matching finish.
3) Run tick.
4) Expected after fix: tick fails with a typed error/halt artifact indicating unfinished prior tick.

**Step 2: Implement tick_recovery_check**

- Read the tail of `logs/ticks.jsonl`.
- Find the latest tick index; if there is a `start` with no `finish`, return a typed `ok:false` result.
- Write a JSON checkpoint artifact, e.g. `logs/halt.tick_recovery.v1.json` with:
  - run_id, manifest_path, tick_index, stage_current, detected_problem, next_commands.

**Step 3: Wire orchestrators to call it**

Call `tick_recovery_check` right after manifest validation and run root resolution, before acquiring lock.

**Step 4: Run regression + commit**

```bash
bun test .opencode/tests/regression/deep_research_tick_recovery_regression.test.ts
git add \
  .opencode/tools/deep_research_cli/tick_recovery_check.ts \
  .opencode/tests/regression/deep_research_tick_recovery_regression.test.ts \
  .opencode/tools/deep_research_cli/orchestrator_tick_live.ts \
  .opencode/tools/deep_research_cli/orchestrator_tick_post_pivot.ts \
  .opencode/tools/deep_research_cli/orchestrator_tick_post_summaries.ts
git commit -m "feat(dr): add crash recovery preflight for unfinished ticks"
```

---

## Task 2b.5: Make lock lease + heartbeat interval policy-driven

**Files:**
- Modify: `.opencode/tools/deep_research_cli/run_init.ts` (write defaults)
- Modify: `.opencode/tools/deep_research_cli/orchestrator_tick_*.ts` (read policy)
- Extend policy reader from Phase 2:
  - `.opencode/tools/deep_research_cli/run_policy_read.ts` (or equivalent)
- Create: `.opencode/tests/regression/deep_research_lock_policy_regression.test.ts`

**Step 1: Define policy schema additions**

Extend `run-config/policy.json` (or `run-config.json` if that’s the canonical file) to include:

```json
{
  "lock_policy_v1": {
    "lease_seconds": 120,
    "heartbeat_interval_ms": 30000,
    "max_consecutive_failures": 2
  }
}
```

**Step 2: Write failing regression test**

- Write a policy with a tiny lease/interval.
- Assert orchestrator passes those values into `acquireRunLock` and `startRunLockHeartbeat`.

**Step 3: Implement read + wire**

- In orchestrators, replace hard-coded `120` / `30_000` with policy-derived values.

**Step 4: Commit**

```bash
bun test .opencode/tests/regression/deep_research_lock_policy_regression.test.ts
git add .opencode/tools/deep_research_cli/run_init.ts \
  .opencode/tools/deep_research_cli/orchestrator_tick_live.ts \
  .opencode/tools/deep_research_cli/orchestrator_tick_post_pivot.ts \
  .opencode/tools/deep_research_cli/orchestrator_tick_post_summaries.ts \
  .opencode/tests/regression/deep_research_lock_policy_regression.test.ts
git commit -m "feat(dr): make lock policy configurable per run"
```

---

## Task 2b.6: Remove O(n) telemetry reads from run_metrics_write

**Files:**
- Modify: `.opencode/tools/deep_research_cli/run_metrics_write.ts`
- Create: `.opencode/tests/regression/deep_research_run_metrics_scaling_regression.test.ts`

**Step 1: Write failing regression test**

- Seed a telemetry log with many events.
- Call `run_metrics_write`.
- Assert it completes without reading/parsing the full file (use a stubbed reader or time-based guard).

**Step 2: Implement O(1) metrics write**

- Reuse the telemetry index artifact introduced in Phase 2 (`last_seq` etc).
- If metrics need more than `last_seq`, store incremental aggregates in `logs/metrics.index.json`.

**Step 3: Commit**

```bash
bun test .opencode/tests/regression/deep_research_run_metrics_scaling_regression.test.ts
git add .opencode/tools/deep_research_cli/run_metrics_write.ts \
  .opencode/tests/regression/deep_research_run_metrics_scaling_regression.test.ts
git commit -m "perf(dr): remove O(n) telemetry reads from run_metrics_write"
```

---

## Phase 2b Gate (completion)

Run:

```bash
bun test .opencode/tests/regression/deep_research_tick_ledger_regression.test.ts
bun test .opencode/tests/regression/deep_research_tick_recovery_regression.test.ts
bun test .opencode/tests/regression/deep_research_lock_policy_regression.test.ts
bun test .opencode/tests/regression/deep_research_run_metrics_scaling_regression.test.ts
```

Expected: all PASS.
