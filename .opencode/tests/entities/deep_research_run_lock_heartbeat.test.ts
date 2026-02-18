import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import {
  acquireRunLock,
  detectRunLock,
  isRunLockStale,
  releaseRunLock,
  startRunLockHeartbeat,
} from "../../tools/deep_research/run_lock";
import { withTempDir } from "../helpers/dr-harness";

describe("deep_research_run_lock heartbeat (entity)", () => {
  test("heartbeat refresh prevents lock from going stale", async () => {
    await withTempDir(async (base) => {
      const runRoot = path.join(base, "dr_lock_hb_001");
      await fs.mkdir(runRoot, { recursive: true });

      const acquired = await acquireRunLock({
        run_root: runRoot,
        lease_seconds: 1,
        reason: "test: heartbeat",
      });
      expect(acquired.ok).toBe(true);
      if (!acquired.ok) return;

      const hb = startRunLockHeartbeat({
        handle: acquired.handle,
        interval_ms: 50,
        lease_seconds: 1,
      });

      try {
        // Wait long enough that the initial 1s lease would expire without refresh.
        await new Promise((r) => setTimeout(r, 1200));

        const detected = await detectRunLock({ run_root: runRoot });
        expect(detected.ok).toBe(true);
        if (!detected.ok) return;

        expect(detected.lock).not.toBeNull();
        expect(detected.stale).toBe(false);
        const lock = detected.lock;
        if (!lock) throw new Error("expected lock to exist");
        expect(isRunLockStale(lock, new Date().toISOString())).toBe(false);
      } finally {
        hb.stop();
        await releaseRunLock(acquired.handle);
      }
    });
  });
});
