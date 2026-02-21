# Deep Research Option C — Phase 0B (Run lock + watchdog resilience) Implementation Plan

> **For the executor:** REQUIRED SUB-SKILL: Use  executing-plans skill to implement this plan task-by-task.

**Goal:** Make long-running ticks safe by removing silent lock/timeout failure modes and improving deterministic failure artifacts.

**Architecture:** Keep the artifact-first run root. Treat lock problems and watchdog timeouts as *typed, inspectable artifacts* (not silent best-effort). Preserve determinism by making every failure visible in JSON + files under `logs/`.

**Tech Stack:** Bun + TypeScript; tool layer `/.opencode/tools/deep_research_cli/**` and orchestrators; bun:test regression tests.

---

## Phase outputs (deliverables)

- `acquireRunLock()` recovers from an **invalid** lock file (parse failure) instead of returning `LOCK_HELD` forever.
- `startRunLockHeartbeat()` no longer swallows refresh failures silently; failures are detectable and can fail the tick.
- `watchdog_check` writes a **typed JSON artifact** (in addition to markdown) on timeout and returns its path.

## Task 0B.1: Create Phase 0B worktree

**Step 1: Create worktree**

```bash
git worktree add /tmp/pai-dr-phase0b -b dr-phase0b-lock-watchdog
```

**Step 2: Verify clean working tree**

```bash
git status --porcelain
```

Expected: empty output.

## Task 0B.2: Regression test — invalid lock file is treated as stale (should FAIL initially)

**Files:**
- Create: `.opencode/tests/regression/deep_research_run_lock_invalid_parse_regression.test.ts`
- Modify later: `.opencode/tools/deep_research_cli/run_lock.ts`

**Step 1: Write failing test**

```ts
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { acquireRunLock, releaseRunLock } from "../../tools/deep_research_cli.ts";
import { withTempDir } from "../helpers/dr-harness";

describe("deep_research run lock (regression)", () => {
  test("acquireRunLock replaces invalid lock file", async () => {
    await withTempDir(async (base) => {
      const runRoot = path.join(base, "run");
      await fs.mkdir(runRoot, { recursive: true });
      await fs.writeFile(path.join(runRoot, ".lock"), "{\n", "utf8"); // invalid JSON

      const acquired = await acquireRunLock({
        run_root: runRoot,
        lease_seconds: 30,
        reason: "test: invalid lock recovery",
      });

      // Expected after fix: ok=true.
      // Expected today: FAIL (currently returns LOCK_HELD with lock: null).
      expect(acquired.ok).toBe(true);
      if (acquired.ok) {
        await releaseRunLock(acquired.handle);
      }
    });
  });
});
```

**Step 2: Run to confirm failure**

```bash
bun test .opencode/tests/regression/deep_research_run_lock_invalid_parse_regression.test.ts
```

Expected: FAIL.

## Task 0B.3: Fix acquireRunLock invalid-lock recovery (make test PASS)

**Files:**
- Modify: `.opencode/tools/deep_research_cli/run_lock.ts` (`acquireRunLock`, currently blocks when `existingLock` is null)

**Step 1: Implement behavior**

In `acquireRunLock`, change the post-`EEXIST` behavior:

- If `readRunLockFile(lockPath)` returns `null` (parse failure), treat it as stale and remove it.

Pseudo-change:

```ts
if (!existingLock) {
  // invalid lock file: treat as stale and replace
  await fs.promises.rm(lockPath, { force: true });
  const lock = await createAndWrite();
  return { ok: true, lock, handle: { run_root: runRoot, lock_path: lockPath, owner_id: lock.owner_id } };
}
```

**Step 2: Re-run regression test**

```bash
bun test .opencode/tests/regression/deep_research_run_lock_invalid_parse_regression.test.ts
```

Expected: PASS.

**Step 3: Commit**

```bash
git add .opencode/tools/deep_research_cli/run_lock.ts .opencode/tests/regression/deep_research_run_lock_invalid_parse_regression.test.ts
git commit -m "fix(dr): recover from invalid run lock file"
```

## Task 0B.4: Regression test — heartbeat reports refresh failures (should FAIL initially)

**Files:**
- Create: `.opencode/tests/regression/deep_research_run_lock_heartbeat_failure_regression.test.ts`
- Modify later: `.opencode/tools/deep_research_cli/run_lock.ts`

**Step 1: Write failing test**

This test requires a new optional `on_failure` callback.

```ts
import { describe, expect, test } from "bun:test";
import * as path from "node:path";
import { acquireRunLock, startRunLockHeartbeat, releaseRunLock } from "../../tools/deep_research_cli.ts";
import { withTempDir } from "../helpers/dr-harness";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

describe("deep_research run lock heartbeat (regression)", () => {
  test("heartbeat calls on_failure when refresh fails", async () => {
    await withTempDir(async (base) => {
      const runRoot = path.join(base, "run");
      const acquired = await acquireRunLock({ run_root: runRoot, lease_seconds: 1, reason: "test" });
      expect(acquired.ok).toBe(true);
      if (!acquired.ok) return;

      // Corrupt the handle owner id so refreshRunLock will fail with LOCK_NOT_OWNED.
      const badHandle = { ...acquired.handle, owner_id: "not-the-owner" };

      let failures = 0;
      const hb = startRunLockHeartbeat({
        handle: badHandle,
        interval_ms: 25,
        lease_seconds: 1,
        on_failure: () => {
          failures += 1;
        },
        max_failures: 1,
      });

      await sleep(120);
      hb.stop();

      // Expected after fix: failures > 0.
      // Expected today: FAIL (refresh failures are swallowed).
      expect(failures).toBeGreaterThan(0);

      await releaseRunLock(acquired.handle);
    });
  });
});
```

**Step 2: Run to confirm failure**

```bash
bun test .opencode/tests/regression/deep_research_run_lock_heartbeat_failure_regression.test.ts
```

Expected: FAIL.

## Task 0B.5: Implement heartbeat failure surfacing + bounded stop (make test PASS)

**Files:**
- Modify: `.opencode/tools/deep_research_cli/run_lock.ts` (`startRunLockHeartbeat`)

**Step 1: Extend function signature**

Add optional args:

- `on_failure?: (failure: { code: string; message: string; details: Record<string, unknown> }) => void`
- `max_failures?: number` (default: 1)

**Step 2: On refresh failure, call on_failure and stop**

Implementation sketch:

```ts
const maxFailures = Number.isFinite(args.max_failures) ? Math.max(1, Math.trunc(args.max_failures)) : 1;
let failureCount = 0;

void refreshRunLock(...).then((result) => {
  if (result.ok) return;
  failureCount += 1;
  args.on_failure?.(result);
  if (failureCount >= maxFailures) {
    stopped = true;
    clearInterval(timer);
  }
});
```

**Step 3: Re-run regression test**

```bash
bun test .opencode/tests/regression/deep_research_run_lock_heartbeat_failure_regression.test.ts
```

Expected: PASS.

**Step 4: Commit**

```bash
git add .opencode/tools/deep_research_cli/run_lock.ts .opencode/tests/regression/deep_research_run_lock_heartbeat_failure_regression.test.ts
git commit -m "feat(dr): surface run lock heartbeat failures"
```

## Task 0B.6: Regression test — watchdog timeout writes typed JSON artifact (should FAIL initially)

**Files:**
- Create: `.opencode/tests/regression/deep_research_watchdog_timeout_artifact_regression.test.ts`
- Modify later: `.opencode/tools/deep_research_cli/watchdog_check.ts`

**Step 1: Write failing test**

Test intent:
- Create a run root via `run_init` tool.
- Force the manifest stage timer to be far in the past.
- Call `watchdog_check` and assert it returns a `checkpoint_json_path` and that file exists.

**Step 2: Run to confirm failure**

Expected: FAIL (today only `timeout-checkpoint.md` exists).

## Task 0B.7: Implement watchdog JSON artifact + return path (make test PASS)

**Files:**
- Modify: `.opencode/tools/deep_research_cli/watchdog_check.ts`

**Step 1: Define JSON artifact contract**

Write `logs/timeout-checkpoint.json` with schema:

```json
{
  "schema_version": "timeout_checkpoint.v1",
  "created_at": "...",
  "stage": "wave1",
  "elapsed_s": 999,
  "timeout_s": 600,
  "timer_origin_field": "stage.last_progress_at",
  "timer_origin": "...",
  "manifest_path": "...",
  "checkpoint_md_path": "..."
}
```

**Step 2: Write JSON artifact when timed out**

- Keep the existing markdown checkpoint.
- Add an additional JSON write (prefer atomic write, reuse `atomicWriteJson` if you place the artifact under the run root).
- Return `checkpoint_json_path` in the tool `ok(...)` response.

**Step 3: Re-run regression test + commit**

```bash
bun test .opencode/tests/regression/deep_research_watchdog_timeout_artifact_regression.test.ts
git add .opencode/tools/deep_research_cli/watchdog_check.ts .opencode/tests/regression/deep_research_watchdog_timeout_artifact_regression.test.ts
git commit -m "feat(dr): emit typed watchdog timeout artifact"
```

## Phase 0B Gate (must PASS before Phase 0C)

**Gate execution (required):**

- Architect agent must review the phase diff and report **PASS/FAIL** against the Architect checklist.
- QATester agent must run the QA checklist commands and report **PASS/FAIL** with the raw test output.

### Architect Gate — PASS checklist

- [ ] Invalid lock files no longer block runs.
- [ ] Heartbeat failures are observable and bounded.
- [ ] Watchdog timeouts produce typed artifacts.

### QA Gate — PASS checklist

```bash
bun test .opencode/tests/regression/deep_research_run_lock_invalid_parse_regression.test.ts
bun test .opencode/tests/regression/deep_research_run_lock_heartbeat_failure_regression.test.ts
bun test .opencode/tests/regression/deep_research_watchdog_timeout_artifact_regression.test.ts
```

Expected: all PASS.
