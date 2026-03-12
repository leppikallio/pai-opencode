import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createPaiBackgroundOutputTool } from "../../plugins/pai-cc-hooks/tools/background-output";
import {
	findBackgroundTaskByTaskId,
	recordBackgroundTaskLaunch,
	recordBackgroundTaskObservation,
} from "../../plugins/pai-cc-hooks/tools/background-task-state";

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
    const originalOpenCodeRoot = process.env.OPENCODE_ROOT;
    process.env.OPENCODE_ROOT = paiDir;
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
      if (originalOpenCodeRoot === undefined) delete process.env.OPENCODE_ROOT;
      else process.env.OPENCODE_ROOT = originalOpenCodeRoot;
    }
  });

  test("renders full_session transcript when messages exist", async () => {
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
      if (originalOpenCodeRoot === undefined) delete process.env.OPENCODE_ROOT;
      else process.env.OPENCODE_ROOT = originalOpenCodeRoot;
    }
  });

	test("renders persisted progress state for active background tasks", async () => {
		const paiDir = createTempPaiDir();
		const originalOpenCodeRoot = process.env.OPENCODE_ROOT;
		process.env.OPENCODE_ROOT = paiDir;
		const nowMs = Date.now();
		try {
			await recordBackgroundTaskLaunch({
				taskId: "bg_progress_header_render",
				childSessionId: "child-progress-header-render",
				parentSessionId: "parent-progress-header-render",
				status: "running",
				nowMs,
			});

			await recordBackgroundTaskObservation({
				taskId: "bg_progress_header_render",
				status: "running",
				source: "child",
				nowMs: nowMs + 1_000,
				phase: "analyzing",
				lastProductiveAtMs: nowMs + 1_000,
				nextExpectedUpdateByMs: nowMs + 6_000,
				counters: {
					tools: 2,
					artifacts: 1,
					checkpoints: 3,
				},
			});

			const persisted = await findBackgroundTaskByTaskId({
				taskId: "bg_progress_header_render",
				nowMs: nowMs + 1_001,
			});
			const persistedLastProductiveAtMs = (persisted as any)?.progress?.lastProductiveAtMs;
			const persistedNextExpectedUpdateByMs = (persisted as any)?.progress?.nextExpectedUpdateByMs;

			const toolDef = createPaiBackgroundOutputTool({ client: { session: {} } });
			const out = await toolDef.execute(
				{ task_id: "bg_progress_header_render" },
				{ directory: "/tmp" } as any,
			);

			expect(out).toContain("Task ID: bg_progress_header_render");
			expect(out).toContain("Progress phase: analyzing");
			expect(out).toContain(
				`Last productive at ms: ${persistedLastProductiveAtMs}`,
			);
			expect(out).toContain(
				`Next expected update by ms: ${persistedNextExpectedUpdateByMs}`,
			);
			expect(out).toContain(
				"Progress counters: tools=2, artifacts=1, checkpoints=3",
			);
		} finally {
			if (originalOpenCodeRoot === undefined) delete process.env.OPENCODE_ROOT;
			else process.env.OPENCODE_ROOT = originalOpenCodeRoot;
		}
	});
});
