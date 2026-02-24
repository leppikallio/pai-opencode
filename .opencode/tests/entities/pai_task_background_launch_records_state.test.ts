import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createPaiTaskTool } from "../../plugins/pai-cc-hooks/tools/task";
import { getBackgroundTaskStatePath } from "../../plugins/pai-cc-hooks/tools/background-task-state";

function createTempPaiDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pai-task-bg-launch-"));
}

describe("PAI task tool run_in_background", () => {
  test("launch records task_id, child_session_id, and parent_session_id", async () => {
    const paiDir = createTempPaiDir();
    const originalPaiDir = process.env.PAI_DIR;
    const calls: Array<{ method: string; payload: unknown }> = [];

    process.env.PAI_DIR = paiDir;
    try {
      const taskTool = createPaiTaskTool({
        client: {
          session: {
            create: async (payload: unknown) => {
              calls.push({ method: "create", payload });
              return { data: { id: "child-session-123" } };
            },
            prompt: async (payload: unknown) => {
              calls.push({ method: "prompt", payload });
              return { data: { parts: [{ type: "text", text: "ignored" }] } };
            },
          },
        },
        $: (() => Promise.resolve(null)) as unknown,
      });

      const result = await taskTool.execute(
        {
          description: "Run in background",
          prompt: "Do the thing",
          subagent_type: "Engineer",
          run_in_background: true,
        },
        {
          sessionID: "parent-session-456",
          directory: "/tmp/workspace",
        } as any,
      );

      const backgroundResult = result as unknown as {
        task_id: string;
        session_id: string;
      };

      expect(backgroundResult).toEqual({
        task_id: "child-session-123",
        session_id: "child-session-123",
      });

      expect(calls).toHaveLength(2);
      expect(calls[0]).toEqual({
        method: "create",
        payload: {
          body: {
            parentID: "parent-session-456",
            title: "Run in background",
          },
          query: {
            directory: "/tmp/workspace",
          },
        },
      });
      expect(calls[1]).toEqual({
        method: "prompt",
        payload: {
          path: { id: "child-session-123" },
          body: {
            agent: "Engineer",
            parts: [{ type: "text", text: "Do the thing" }],
          },
        },
      });

      const statePath = getBackgroundTaskStatePath();
      const persisted = JSON.parse(fs.readFileSync(statePath, "utf-8")) as {
        backgroundTasks?: Record<
          string,
          {
            task_id?: string;
            child_session_id?: string;
            parent_session_id?: string;
          }
        >;
      };

      expect(persisted.backgroundTasks?.["child-session-123"]).toMatchObject({
        task_id: "child-session-123",
        child_session_id: "child-session-123",
        parent_session_id: "parent-session-456",
      });
    } finally {
      if (originalPaiDir === undefined) {
        delete process.env.PAI_DIR;
      } else {
        process.env.PAI_DIR = originalPaiDir;
      }
    }
  });
});
