# Deep Research Option C — Phase 0b (resumability + determinism) Implementation Plan

> **For the executor:** REQUIRED SUB-SKILL: Use  executing-plans skill to implement this plan task-by-task.

**Goal:** Make long-running runs *fail safely* (no silent lock-loss), recover cleanly from corrupt locks, and make digests/halts deterministic and operator-visible.

**Architecture:** Small, test-driven changes in the tool/orchestrator layer to:
- treat lock heartbeat loss as a *typed* failure that flips `manifest.status=failed`,
- treat invalid lock files as *stale* (recoverable),
- replace non-canonical digests with stable digests,
- emit a typed JSON halt/checkpoint artifact on watchdog timeout.

**Tech Stack:** Bun + TypeScript; tool layer under `.opencode/tools/deep_research_cli/**`; tests under `.opencode/tests/**`.

---

## Phase outputs (deliverables)

- Heartbeat refresh failures are not swallowed; they produce a visible failure artifact and fail the run.
- `acquireRunLock()` recovers from invalid/corrupt lock files.
- Digest hashing is canonical (stable across key order) for:
  - `stage_advance` decision digest
  - `manifest_write` patch digest
  - `perspectives_write` value digest
- `watchdog_check` emits both:
  - the existing `timeout-checkpoint.md`
  - a typed JSON checkpoint artifact (machine-readable)

## Task 0b.1: Create Phase 0b worktree

**Files:**
- (none)

**Step 1: Create a worktree**

Run:

```bash
git worktree add /tmp/pai-dr-phase0b -b dr-phase0b-resumability-determinism
```

Expected: worktree created at `/tmp/pai-dr-phase0b`.

**Step 2: Verify clean state**

Run (inside worktree):

```bash
git status --porcelain
```

Expected: empty output.

---

## Task 0b.2: Add failing entity test for invalid lock recovery (should FAIL initially)

**Files:**
- Create: `.opencode/tests/entities/deep_research_run_lock_invalid_recovery.test.ts`
- Reads:
  - `.opencode/tools/deep_research_cli/run_lock.ts`

**Step 1: Write failing test**

Create:

```ts
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { acquireRunLock, detectRunLock, releaseRunLock } from "../../tools/deep_research_cli/run_lock";
import { withTempDir } from "../helpers/dr-harness";

describe("deep_research_run_lock invalid lock recovery (entity)", () => {
  test("acquireRunLock treats invalid lock as stale and recovers", async () => {
    await withTempDir(async (base) => {
      const runRoot = path.join(base, "dr_lock_invalid_001");
      await fs.mkdir(runRoot, { recursive: true });
      const lockPath = path.join(runRoot, ".lock");

      // Corrupt/invalid lock content.
      await fs.writeFile(lockPath, "{ this is not json }\n", "utf8");

      const acquired = await acquireRunLock({
        run_root: runRoot,
        lease_seconds: 10,
        reason: "test: invalid lock recovery",
      });

      // Expected after fix: ok=true (invalid lock is treated as stale).
      // Expected today: ok=false LOCK_HELD (because normalizeRunLockRecord returns null).
      expect(acquired.ok).toBe(true);
      if (!acquired.ok) return;

      try {
        const detected = await detectRunLock({ run_root: runRoot });
        expect(detected.ok).toBe(true);
        if (!detected.ok) return;
        expect(detected.lock).not.toBeNull();
        expect(detected.stale).toBe(false);
      } finally {
        await releaseRunLock(acquired.handle);
      }
    });
  });
});
```

**Step 2: Run to confirm failure**

Run:

```bash
bun test .opencode/tests/entities/deep_research_run_lock_invalid_recovery.test.ts
```

Expected: FAIL (current behavior returns `LOCK_HELD` when lock is invalid).

---

## Task 0b.3: Implement invalid lock recovery in acquireRunLock (make test PASS)

**Files:**
- Modify: `.opencode/tools/deep_research_cli/run_lock.ts:240-292`

**Step 1: Minimal behavior change**

In `acquireRunLock()`, change the post-`EEXIST` read logic:

- If `readRunLockFile(lockPath)` returns `null` (invalid), treat it as stale:
  - remove the lock file (`rm(lockPath, { force: true })`)
  - then proceed to `createAndWrite()`

**Step 2: Re-run entity test**

Run:

```bash
bun test .opencode/tests/entities/deep_research_run_lock_invalid_recovery.test.ts
```

Expected: PASS.

**Step 3: Commit**

```bash
git add .opencode/tools/deep_research_cli/run_lock.ts .opencode/tests/entities/deep_research_run_lock_invalid_recovery.test.ts
git commit -m "fix(dr): recover from invalid run lock files"
```

---

## Task 0b.4: Add failing entity test for heartbeat failure surfacing (should FAIL initially)

**Files:**
- Create: `.opencode/tests/entities/deep_research_run_lock_heartbeat_failure.test.ts`
- Modify later: `.opencode/tools/deep_research_cli/run_lock.ts`

**Step 1: Write failing test**

Create:

```ts
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { acquireRunLock, releaseRunLock, startRunLockHeartbeat } from "../../tools/deep_research_cli/run_lock";
import { withTempDir } from "../helpers/dr-harness";

describe("deep_research_run_lock heartbeat failure surfacing (entity)", () => {
  test("heartbeat calls on_failure after consecutive refresh failures", async () => {
    await withTempDir(async (base) => {
      const runRoot = path.join(base, "dr_lock_hb_fail_001");
      await fs.mkdir(runRoot, { recursive: true });

      const acquired = await acquireRunLock({
        run_root: runRoot,
        lease_seconds: 5,
        reason: "test: heartbeat failure",
      });
      expect(acquired.ok).toBe(true);
      if (!acquired.ok) return;

      let failures = 0;
      const hb = startRunLockHeartbeat({
        handle: acquired.handle,
        interval_ms: 50,
        lease_seconds: 5,
        // New API (after fix): heartbeat observes refresh failures.
        max_consecutive_failures: 2,
        on_failure: () => {
          failures += 1;
        },
      } as any);

      try {
        // Force refresh failure: delete the lock file so refresh returns LOCK_NOT_HELD.
        await fs.rm(path.join(runRoot, ".lock"), { force: true });
        await new Promise((r) => setTimeout(r, 250));

        // Expected after fix: failures > 0.
        // Expected today: failures stays 0 because heartbeat swallows errors.
        expect(failures).toBeGreaterThan(0);
      } finally {
        hb.stop();
        // Release may fail because we removed the file; best effort.
        await releaseRunLock(acquired.handle).catch(() => undefined);
      }
    });
  });
});
```

**Step 2: Run to confirm failure**

```bash
bun test .opencode/tests/entities/deep_research_run_lock_heartbeat_failure.test.ts
```

Expected: FAIL.

---

## Task 0b.5: Implement heartbeat failure tracking + callback (make test PASS)

**Files:**
- Modify: `.opencode/tools/deep_research_cli/run_lock.ts:371-399`

**Step 1: Extend heartbeat API**

Update `startRunLockHeartbeat()` signature to accept:

```ts
max_consecutive_failures?: number;
on_failure?: (info: { code: string; message: string; details: Record<string, unknown> }) => void | Promise<void>;
```

**Step 2: Track consecutive failures**

- If `refreshRunLock()` returns `{ ok:false, code, message, details }`, increment a counter.
- If counter reaches `max_consecutive_failures`, invoke `on_failure` once and stop the heartbeat timer.
- If refresh succeeds, reset the counter.

**Step 3: Re-run test + commit**

```bash
bun test .opencode/tests/entities/deep_research_run_lock_heartbeat_failure.test.ts
git add .opencode/tools/deep_research_cli/run_lock.ts .opencode/tests/entities/deep_research_run_lock_heartbeat_failure.test.ts
git commit -m "fix(dr): surface lock heartbeat refresh failures"
```

---

## Task 0b.6: Wire orchestrators to fail the run on heartbeat loss

**Files:**
- Modify: `.opencode/tools/deep_research_cli/orchestrator_tick_live.ts:609-623`
- Modify: `.opencode/tools/deep_research_cli/orchestrator_tick_post_pivot.ts:1317-1331`
- Modify: `.opencode/tools/deep_research_cli/orchestrator_tick_post_summaries.ts:401-415`
- (Optional) Modify: `.opencode/tools/deep_research_cli/orchestrator_tick_fixture.ts` (keep fixture runs safe too)

**Step 1: Add a small helper inside each orchestrator**

Add a local function (per file) like:

```ts
async function failRunDueToLockLoss(details: Record<string, unknown>): Promise<void> {
  const patch = {
    status: "failed",
    failures: [
      // append, don’t clobber existing
      { kind: "lock_lost", stage: from, message: "run lock heartbeat lost", retryable: false, ts: new Date().toISOString(), details },
    ],
  };
  await (manifest_write as any).execute({
    manifest_path: manifestPath,
    patch,
    expected_revision: manifestRevision,
    reason: `lock heartbeat lost: ${reason}`,
  });
}
```

Then pass the heartbeat callback:

```ts
const heartbeat = startRunLockHeartbeat({
  handle: runLockHandle,
  interval_ms: 30_000,
  lease_seconds: 120,
  max_consecutive_failures: 2,
  on_failure: (info) => void failRunDueToLockLoss(info),
});
```

**Step 2: Add a small regression test to prove behavior**

Create:

- `.opencode/tests/regression/deep_research_orchestrator_lock_loss_regression.test.ts`

Test shape:
- create a run root,
- start an orchestrator tick,
- simulate lock loss (remove `.lock`) before the tick completes,
- assert manifest is marked `failed` with a `failures[].kind == "lock_lost"`.

**Step 3: Commit**

```bash
git add .opencode/tools/deep_research_cli/orchestrator_tick_live.ts \
  .opencode/tools/deep_research_cli/orchestrator_tick_post_pivot.ts \
  .opencode/tools/deep_research_cli/orchestrator_tick_post_summaries.ts \
  .opencode/tests/regression/deep_research_orchestrator_lock_loss_regression.test.ts
git commit -m "fix(dr): fail run when lock heartbeat is lost"
```

---

## Task 0b.7: Emit a typed JSON checkpoint artifact for watchdog timeouts

**Files:**
- Modify: `.opencode/tools/deep_research_cli/watchdog_check.ts:132-194`
- Modify test: `.opencode/tests/entities/deep_research_watchdog_timeout.test.ts`

**Step 1: Update entity test to require JSON artifact (should FAIL initially)**

In `deep_research_watchdog_timeout.test.ts`, after reading the markdown checkpoint, assert:

- tool output includes `checkpoint_json_path`
- the JSON file exists
- it contains required fields:
  - `schema_version: "halt.timeout.v1"`
  - `stage`, `elapsed_s`, `timeout_s`, `timer_origin_field`, `timer_origin`
  - `manifest_path`
  - `next_commands[]` (at least 2)

**Step 2: Implement JSON artifact write**

In `watchdog_check.ts`, when timed out:

- Write the existing markdown checkpoint (keep)
- Also write a JSON artifact, for example:

```ts
const checkpointJsonPath = path.join(runRoot, logsDir, "halt.timeout.v1.json");
await atomicWriteJson(checkpointJsonPath, {
  schema_version: "halt.timeout.v1",
  created_at: failureTs,
  manifest_path: args.manifest_path,
  stage,
  elapsed_s,
  timeout_s,
  timer_origin_field: timerOriginField,
  timer_origin: timerOrigin.toISOString(),
  checkpoint_md_path: checkpointPath,
  next_commands: [
    `bun ".opencode/pai-tools/deep-research-cli.ts" inspect --manifest "${args.manifest_path}"`,
    `bun ".opencode/pai-tools/deep-research-cli.ts" triage --manifest "${args.manifest_path}"`,
  ],
});
```

- Return `checkpoint_json_path` in the `ok({ ... })` payload.

**Step 3: Run test + commit**

```bash
bun test .opencode/tests/entities/deep_research_watchdog_timeout.test.ts
git add .opencode/tools/deep_research_cli/watchdog_check.ts .opencode/tests/entities/deep_research_watchdog_timeout.test.ts
git commit -m "feat(dr): add typed JSON timeout halt artifact"
```

---

## Task 0b.8: Replace non-canonical digests with stable digests

**Files:**
- Modify: `.opencode/tools/deep_research_cli/stage_advance.ts:501-519`
- Modify: `.opencode/tools/deep_research_cli/manifest_write.ts:64-74`
- Modify: `.opencode/tools/deep_research_cli/perspectives_write.ts:38-46`
- Create: `.opencode/tests/entities/deep_research_sha256_digest_for_json.test.ts`

**Step 1: Add a focused entity test for stable JSON digest**

Create:

```ts
import { describe, expect, test } from "bun:test";
import { sha256DigestForJson } from "../../tools/deep_research_cli/wave_tools_shared";

describe("deep_research sha256DigestForJson (entity)", () => {
  test("digest is stable across object key order", () => {
    const a = { b: 1, a: { z: 2, y: 3 } };
    const b = { a: { y: 3, z: 2 }, b: 1 };
    expect(sha256DigestForJson(a)).toBe(sha256DigestForJson(b));
  });
});
```

**Step 2: Switch call sites**

- In `stage_advance.ts`, replace:

```ts
const inputs_digest = `sha256:${sha256HexLowerUtf8(JSON.stringify(digestInput))}`;
```

with:

```ts
const inputs_digest = sha256DigestForJson(digestInput);
```

- In `manifest_write.ts`, replace `patch_digest` with `sha256DigestForJson(args.patch)`.
- In `perspectives_write.ts`, replace `value_digest` with `sha256DigestForJson(args.value)`.

**Step 3: Run tests + commit**

```bash
bun test .opencode/tests/entities/deep_research_sha256_digest_for_json.test.ts
git add \
  .opencode/tools/deep_research_cli/stage_advance.ts \
  .opencode/tools/deep_research_cli/manifest_write.ts \
  .opencode/tools/deep_research_cli/perspectives_write.ts \
  .opencode/tests/entities/deep_research_sha256_digest_for_json.test.ts
git commit -m "fix(dr): canonicalize digests with sha256DigestForJson"
```

---

## Phase 0b Gate (completion)

**Gate execution (required):**

- Architect agent must review the phase diff and report **PASS/FAIL**.
- QATester agent must run the QA checklist commands and report **PASS/FAIL** with raw test output.

### QA Gate — PASS checklist

Run:

```bash
bun test .opencode/tests/entities/deep_research_run_lock_invalid_recovery.test.ts
bun test .opencode/tests/entities/deep_research_run_lock_heartbeat_failure.test.ts
bun test .opencode/tests/entities/deep_research_watchdog_timeout.test.ts
bun test .opencode/tests/entities/deep_research_sha256_digest_for_json.test.ts

# baseline smoke
bun test .opencode/tests/smoke/deep_research_live_wave1_smoke.test.ts
```

Expected: all PASS.
