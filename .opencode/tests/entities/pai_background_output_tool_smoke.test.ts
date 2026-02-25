import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createPaiBackgroundOutputTool } from "../../plugins/pai-cc-hooks/tools/background-output";
import { recordBackgroundTaskLaunch } from "../../plugins/pai-cc-hooks/tools/background-task-state";

function createTempPaiDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pai-bg-output-"));
}

describe("PAI background_output tool", () => {
  test("returns not found when task id missing", async () => {
    const toolDef = createPaiBackgroundOutputTool({ client: {} });
    const out = await toolDef.execute({ task_id: "missing" }, { directory: "/tmp" } as any);
    expect(out).toContain("Task not found: missing");
  });

  test("renders header even when session.messages unavailable", async () => {
    const paiDir = createTempPaiDir();
    const originalPaiDir = process.env.PAI_DIR;
    process.env.PAI_DIR = paiDir;
    try {
      await recordBackgroundTaskLaunch({
        taskId: "bg_child-session-123",
        childSessionId: "child-session-123",
        parentSessionId: "parent-session-456",
      });

      const toolDef = createPaiBackgroundOutputTool({ client: { session: {} } });
      const out = await toolDef.execute({ task_id: "bg_child-session-123" }, { directory: "/tmp" } as any);
      expect(out).toContain("Task ID: bg_child-session-123");
      expect(out).toContain("Session ID: child-session-123");
      expect(out).toContain("Status:");
      expect(out).toContain("no client.session.messages");
    } finally {
      if (originalPaiDir === undefined) delete process.env.PAI_DIR;
      else process.env.PAI_DIR = originalPaiDir;
    }
  });

  test("renders full_session transcript when messages exist", async () => {
    const paiDir = createTempPaiDir();
    const originalPaiDir = process.env.PAI_DIR;
    process.env.PAI_DIR = paiDir;
    try {
      await recordBackgroundTaskLaunch({
        taskId: "bg_child-session-123",
        childSessionId: "child-session-123",
        parentSessionId: "parent-session-456",
      });

      const toolDef = createPaiBackgroundOutputTool({
        client: {
          session: {
            messages: async () => {
              return {
                data: [
                  {
                    info: { id: "m1", role: "user" },
                    parts: [{ type: "text", text: "hello" }],
                  },
                  {
                    info: { id: "m2", role: "assistant" },
                    parts: [{ type: "text", text: "ok" }],
                  },
                ],
              };
            },
          },
        },
      });

      const out = await toolDef.execute(
        {
          task_id: "bg_child-session-123",
          full_session: true,
          message_limit: 50,
        },
        { directory: "/tmp" } as any,
      );

      expect(out).toContain("--- Messages (2) ---");
      expect(out).toContain("[user]");
      expect(out).toContain("hello");
      expect(out).toContain("[assistant]");
      expect(out).toContain("ok");
    } finally {
      if (originalPaiDir === undefined) delete process.env.PAI_DIR;
      else process.env.PAI_DIR = originalPaiDir;
    }
  });
});
