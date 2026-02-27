import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createPaiBackgroundOutputTool } from "../../plugins/pai-cc-hooks/tools/background-output";
import { recordBackgroundTaskLaunch } from "../../plugins/pai-cc-hooks/tools/background-task-state";

function createTempPaiDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pai-bg-output-since-"));
}

describe("PAI background_output since_message_id behavior", () => {
  test("returns explicit error when since_message_id is not found", async () => {
    const paiDir = createTempPaiDir();
    const originalOpenCodeRoot = process.env.OPENCODE_ROOT;
    process.env.OPENCODE_ROOT = paiDir;
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
                  { info: { id: "m1", role: "user" }, parts: [{ type: "text", text: "hello" }] },
                  { info: { id: "m2", role: "assistant" }, parts: [{ type: "text", text: "ok" }] },
                ],
              };
            },
          },
        },
      });

      const out = await toolDef.execute(
        {
          task_id: "bg_child-session-123",
          since_message_id: "missing",
        },
        { directory: "/tmp" } as any,
      );

      expect(out).toContain("Task ID: bg_child-session-123");
      expect(out).toContain("Error: since_message_id not found");
      expect(out).toContain("missing");
    } finally {
      if (originalOpenCodeRoot === undefined) delete process.env.OPENCODE_ROOT;
      else process.env.OPENCODE_ROOT = originalOpenCodeRoot;
    }
  });

  test("running tasks default to include thinking and tool results", async () => {
    const paiDir = createTempPaiDir();
    const originalOpenCodeRoot = process.env.OPENCODE_ROOT;
    process.env.OPENCODE_ROOT = paiDir;
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
                    info: { id: "m1", role: "assistant" },
                    parts: [
                      { type: "reasoning", text: "THINKING" },
                      { type: "tool_result", text: "TOOL_RESULT" },
                      { type: "text", text: "OK" },
                    ],
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
        },
        { directory: "/tmp" } as any,
      );

      expect(out).toContain("THINKING");
      expect(out).toContain("TOOL_RESULT");
      expect(out).toContain("OK");
    } finally {
      if (originalOpenCodeRoot === undefined) delete process.env.OPENCODE_ROOT;
      else process.env.OPENCODE_ROOT = originalOpenCodeRoot;
    }
  });
});
