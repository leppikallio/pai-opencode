import { describe, expect, test } from "bun:test";
import * as path from "node:path";

import {
  acquireRunLock,
  releaseRunLock,
  startRunLockHeartbeat,
} from "../../tools/deep_research_cli/run_lock";
import { withTempDir } from "../helpers/dr-harness";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("deep_research run lock heartbeat (regression)", () => {
  test("heartbeat calls on_failure when refresh fails", async () => {
    await withTempDir(async (base) => {
      const runRoot = path.join(base, "run");
      const acquired = await acquireRunLock({
        run_root: runRoot,
        lease_seconds: 1,
        reason: "test",
      });
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

      await sleep(650);
      hb.stop();

      // Expected after fix: failures > 0.
      // Expected today: FAIL (refresh failures are swallowed).
      expect(failures).toBeGreaterThan(0);

      await releaseRunLock(acquired.handle);
    });
  });
});
