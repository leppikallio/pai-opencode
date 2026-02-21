import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { acquireRunLock, releaseRunLock } from "../../tools/deep_research_cli/run_lock";
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
