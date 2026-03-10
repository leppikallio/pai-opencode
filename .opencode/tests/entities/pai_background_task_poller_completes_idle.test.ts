import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { BackgroundTaskPoller } from "../../plugins/pai-cc-hooks/background/poller";
import {
  findBackgroundTaskByTaskId,
  listActiveBackgroundTasks,
  markBackgroundTaskTerminalAtomic,
  recordBackgroundTaskLaunch,
} from "../../plugins/pai-cc-hooks/tools/background-task-state";

function createTempPaiDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pai-bg-task-poller-"));
}

describe("PAI BackgroundTaskPoller", () => {
  test("pollOnce completes idle tasks and calls onTaskCompleted", async () => {
    const paiDir = createTempPaiDir();
    const originalOpenCodeRoot = process.env.OPENCODE_ROOT;

    process.env.OPENCODE_ROOT = paiDir;
    try {
      const nowMs = Date.now();
      await recordBackgroundTaskLaunch({
        taskId: "bg_ses_child",
        childSessionId: "ses_child",
        parentSessionId: "ses_parent",
        nowMs,
      });

      let completedCalls = 0;
      const poller = new BackgroundTaskPoller({
        client: {
          session: {
            status: async () => ({
              data: {
                ses_child: { type: "idle" },
              },
            }),
          },
        },
        listActiveBackgroundTasks,
        markBackgroundTaskTerminalAtomic,
        onTaskCompleted: async () => {
          completedCalls += 1;
        },
      });

      expect((await listActiveBackgroundTasks({ nowMs })).map((x) => x.task_id)).toEqual(["bg_ses_child"]);
      await poller.pollOnce();

      expect(completedCalls).toBe(1);
      const updated = await findBackgroundTaskByTaskId({ taskId: "bg_ses_child" });
      expect(updated?.completed_at_ms).toBeTypeOf("number");
    } finally {
      if (originalOpenCodeRoot === undefined) delete process.env.OPENCODE_ROOT;
      else process.env.OPENCODE_ROOT = originalOpenCodeRoot;
    }
  });
});
