import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  getBackgroundTaskStatePath,
  listActiveBackgroundTasks,
  listBackgroundTasksByParent,
  markBackgroundTaskCompleted,
  recordBackgroundTaskLaunch,
  recordBackgroundTaskLaunchError,
} from "../../plugins/pai-cc-hooks/tools/background-task-state";

function createTempPaiDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pai-bg-task-state-list-"));
}

describe("PAI background task state list helpers", () => {
  test("listActiveBackgroundTasks returns only incomplete tasks without launch_error", async () => {
    const paiDir = createTempPaiDir();
    const originalOpenCodeRoot = process.env.OPENCODE_ROOT;

    process.env.OPENCODE_ROOT = paiDir;
    try {
      await recordBackgroundTaskLaunch({
        taskId: "bg_child_1",
        childSessionId: "child_1",
        parentSessionId: "parent_1",
        nowMs: 1_000,
      });

      await recordBackgroundTaskLaunch({
        taskId: "bg_child_2",
        childSessionId: "child_2",
        parentSessionId: "parent_1",
        nowMs: 2_000,
      });
      await markBackgroundTaskCompleted({ taskId: "bg_child_2", nowMs: 3_000 });

      await recordBackgroundTaskLaunch({
        taskId: "bg_child_3",
        childSessionId: "child_3",
        parentSessionId: "parent_2",
        nowMs: 4_000,
      });
      await recordBackgroundTaskLaunchError({
        taskId: "bg_child_3",
        errorMessage: "prompt send exploded",
        nowMs: 5_000,
      });

      const active = await listActiveBackgroundTasks({ nowMs: 6_000 });
      expect(active.map((x) => x.task_id)).toEqual(["bg_child_1"]);

      // Sanity: the state file exists.
      const statePath = getBackgroundTaskStatePath();
      expect(fs.existsSync(statePath)).toBe(true);
    } finally {
      if (originalOpenCodeRoot === undefined) delete process.env.OPENCODE_ROOT;
      else process.env.OPENCODE_ROOT = originalOpenCodeRoot;
    }
  });

  test("listBackgroundTasksByParent returns tasks sorted by launched_at_ms", async () => {
    const paiDir = createTempPaiDir();
    const originalOpenCodeRoot = process.env.OPENCODE_ROOT;

    process.env.OPENCODE_ROOT = paiDir;
    try {
      await recordBackgroundTaskLaunch({
        taskId: "bg_child_2",
        childSessionId: "child_2",
        parentSessionId: "parent_1",
        nowMs: 2_000,
      });
      await recordBackgroundTaskLaunch({
        taskId: "bg_child_1",
        childSessionId: "child_1",
        parentSessionId: "parent_1",
        nowMs: 1_000,
      });
      await recordBackgroundTaskLaunch({
        taskId: "bg_child_other",
        childSessionId: "child_other",
        parentSessionId: "parent_2",
        nowMs: 3_000,
      });

      const parent1 = await listBackgroundTasksByParent({ parentSessionId: "parent_1", nowMs: 4_000 });
      expect(parent1.map((x) => x.task_id)).toEqual(["bg_child_1", "bg_child_2"]);
    } finally {
      if (originalOpenCodeRoot === undefined) delete process.env.OPENCODE_ROOT;
      else process.env.OPENCODE_ROOT = originalOpenCodeRoot;
    }
  });
});
