import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { notifyParentSessionBackgroundCompletion } from "../../plugins/pai-cc-hooks/background/parent-notifier";
import {
  listBackgroundTasksByParent,
  markBackgroundTaskCompleted,
  recordBackgroundTaskLaunch,
} from "../../plugins/pai-cc-hooks/tools/background-task-state";

function createTempPaiDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pai-parent-notifier-"));
}

describe("PAI parent-session background completion notifier", () => {
  test("bubbles silently per-task and wakes parent when all complete", async () => {
    const paiDir = createTempPaiDir();
    const originalPaiDir = process.env.PAI_DIR;

    process.env.PAI_DIR = paiDir;
    try {
      const parentSessionId = "ses_parent";
      const nowMs = Date.now();

      await recordBackgroundTaskLaunch({
        taskId: "bg_ses_child_a",
        childSessionId: "ses_child_a",
        parentSessionId,
        nowMs,
      });
      await recordBackgroundTaskLaunch({
        taskId: "bg_ses_child_b",
        childSessionId: "ses_child_b",
        parentSessionId,
        nowMs: nowMs + 1,
      });

      const promptCalls: any[] = [];
      const promptAsync = async (call: any) => {
        promptCalls.push(call);
      };

      const suppressCalls: any[] = [];
      const shouldSuppressDuplicate = async (call: any) => {
        suppressCalls.push(call);
        return false;
      };

      const completedA = await markBackgroundTaskCompleted({ taskId: "bg_ses_child_a", nowMs: nowMs + 10 });
      expect(completedA).not.toBeNull();

      await notifyParentSessionBackgroundCompletion({
        taskRecord: completedA!,
        deps: {
          promptAsync,
          listBackgroundTasksByParent,
          shouldSuppressDuplicate,
          nowMs: nowMs + 11,
        },
      });

      expect(promptCalls).toHaveLength(1);
      expect(promptCalls[0]?.path?.id).toBe(parentSessionId);
      expect(promptCalls[0]?.body?.noReply).toBe(true);
      expect(String(promptCalls[0]?.body?.parts?.[0]?.text ?? "")).toContain("[BACKGROUND TASK COMPLETED]");
      expect(String(promptCalls[0]?.body?.parts?.[0]?.text ?? "")).toContain("**ID:** `bg_ses_child_a`");
      expect(String(promptCalls[0]?.body?.parts?.[0]?.text ?? "")).toContain(
        'background_output(task_id="bg_ses_child_a")',
      );

      const completedB = await markBackgroundTaskCompleted({ taskId: "bg_ses_child_b", nowMs: nowMs + 20 });
      expect(completedB).not.toBeNull();

      await notifyParentSessionBackgroundCompletion({
        taskRecord: completedB!,
        deps: {
          promptAsync,
          listBackgroundTasksByParent,
          shouldSuppressDuplicate,
          nowMs: nowMs + 21,
        },
      });

      expect(promptCalls).toHaveLength(2);
      expect(promptCalls[1]?.path?.id).toBe(parentSessionId);
      expect(promptCalls[1]?.body?.noReply).toBe(false);
      expect(String(promptCalls[1]?.body?.parts?.[0]?.text ?? "")).toContain("[ALL BACKGROUND TASKS COMPLETE]");
      expect(String(promptCalls[1]?.body?.parts?.[0]?.text ?? "")).toContain("`bg_ses_child_a`");
      expect(String(promptCalls[1]?.body?.parts?.[0]?.text ?? "")).toContain("`bg_ses_child_b`");

      expect(suppressCalls).toHaveLength(2);
      expect(suppressCalls[0]?.sessionId).toBe(parentSessionId);
      expect(suppressCalls[0]?.title).toBe("OpenCode");

      const tasks = await listBackgroundTasksByParent({ parentSessionId, nowMs: nowMs + 30 });
      expect(tasks.map((t) => t.task_id)).toEqual(["bg_ses_child_a", "bg_ses_child_b"]);
    } finally {
      if (originalPaiDir === undefined) delete process.env.PAI_DIR;
      else process.env.PAI_DIR = originalPaiDir;
    }
  });
});
