import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createPaiBackgroundCancelTool } from "../../plugins/pai-cc-hooks/tools/background-cancel";
import {
  recordBackgroundTaskLaunch,
  findBackgroundTaskByTaskId,
} from "../../plugins/pai-cc-hooks/tools/background-task-state";

function createTempPaiDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pai-bg-cancel-"));
}

describe("PAI background_cancel tool", () => {
  test("returns not found when task id missing", async () => {
    const toolDef = createPaiBackgroundCancelTool({ client: {} });
    const out = await toolDef.execute({ task_id: "missing" }, { directory: "/tmp" } as any);
    expect(out).toContain("Task not found: missing");
  });

  test("calls session.abort and marks task cancelled", async () => {
    const paiDir = createTempPaiDir();
    const originalOpenCodeRoot = process.env.OPENCODE_ROOT;
    process.env.OPENCODE_ROOT = paiDir;

    const abortCalls: unknown[] = [];
    try {
      await recordBackgroundTaskLaunch({
        taskId: "bg_child-session-123",
        childSessionId: "child-session-123",
        parentSessionId: "parent-session-456",
      });

      const toolDef = createPaiBackgroundCancelTool({
        client: {
          session: {
            abort: async (payload: unknown) => {
              abortCalls.push(payload);
              return { data: true };
            },
          },
        },
      });

      const out = await toolDef.execute({ task_id: "bg_child-session-123" }, { directory: "/tmp" } as any);
      expect(out).toContain("Cancelled");
      expect(out).toContain("Task ID: bg_child-session-123");
      expect(out).toContain("Session ID: child-session-123");

      expect(abortCalls).toHaveLength(1);
      expect(abortCalls[0]).toEqual({
        path: { id: "child-session-123" },
        query: { directory: "/tmp" },
      });

      const record = await findBackgroundTaskByTaskId({ taskId: "bg_child-session-123" });
      expect(record?.completed_at_ms).toBeTypeOf("number");
      expect(record?.launch_error).toBe("cancelled");
      expect(record?.launch_error_at_ms).toBeTypeOf("number");
    } finally {
      if (originalOpenCodeRoot === undefined) delete process.env.OPENCODE_ROOT;
      else process.env.OPENCODE_ROOT = originalOpenCodeRoot;
    }
  });
});
