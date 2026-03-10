import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getBackgroundTaskStatePath } from "../../plugins/pai-cc-hooks/tools/background-task-state";
import { createPaiTaskTool } from "../../plugins/pai-cc-hooks/tools/task";

function createTempPaiDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "pai-task-bg-launch-"));
}

async function waitFor(
	predicate: () => boolean,
	timeoutMs = 500,
): Promise<boolean> {
	const startedAt = Date.now();
	while (Date.now() - startedAt < timeoutMs) {
		if (predicate()) {
			return true;
		}
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	return false;
}

describe("PAI task tool run_in_background", () => {
	test("launch records task_id, child_session_id, and parent_session_id", async () => {
		const paiDir = createTempPaiDir();
		const originalOpenCodeRoot = process.env.OPENCODE_ROOT;
		const calls: Array<{ method: string; payload: unknown }> = [];

		process.env.OPENCODE_ROOT = paiDir;
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

			expect(typeof result).toBe("string");
			expect(result).toContain("Background task launched");
			expect(result).toContain("Task ID: bg_child-session-123");
			expect(result).toContain("Session ID: child-session-123");

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
			expect(calls[1]).toMatchObject({
				method: "prompt",
				payload: {
					path: { id: "child-session-123" },
					body: {
						agent: "Engineer",
					},
				},
			});
			const promptPart = (
				calls[1].payload as {
					body?: { parts?: Array<{ type?: string; text?: string }> };
				}
			).body?.parts?.[0];
			expect(promptPart?.type).toBe("text");
			expect(promptPart?.text).toContain("PAI SCRATCHPAD (Binding)");
			expect(promptPart?.text).toContain("Do the thing");

			const statePath = getBackgroundTaskStatePath();
			const persisted = JSON.parse(fs.readFileSync(statePath, "utf-8")) as {
				backgroundTasks?: Record<
					string,
					{
						task_id?: string;
						task_description?: string;
						child_session_id?: string;
						parent_session_id?: string;
					}
				>;
			};

			expect(persisted.backgroundTasks?.["bg_child-session-123"]).toMatchObject(
				{
					task_id: "bg_child-session-123",
					task_description: "Run in background",
					child_session_id: "child-session-123",
					parent_session_id: "parent-session-456",
				},
			);
		} finally {
			if (originalOpenCodeRoot === undefined) {
				delete process.env.OPENCODE_ROOT;
			} else {
				process.env.OPENCODE_ROOT = originalOpenCodeRoot;
			}
		}
	});

	test("records launch_error marker when background prompt send fails", async () => {
		const paiDir = createTempPaiDir();
		const originalOpenCodeRoot = process.env.OPENCODE_ROOT;

		process.env.OPENCODE_ROOT = paiDir;
		try {
			const taskTool = createPaiTaskTool({
				client: {
					session: {
						create: async () => ({ data: { id: "child-session-err" } }),
						prompt: async () => {
							throw new Error("prompt send exploded");
						},
					},
				},
				$: (() => Promise.resolve(null)) as unknown,
			});

			await taskTool.execute(
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

			const statePath = getBackgroundTaskStatePath();
			const hasLaunchError = await waitFor(() => {
				try {
					const persisted = JSON.parse(fs.readFileSync(statePath, "utf-8")) as {
						backgroundTasks?: Record<
							string,
							{
								launch_error?: string;
								launch_error_at_ms?: number;
							}
						>;
					};
					const record = persisted.backgroundTasks?.["bg_child-session-err"];
					return (
						typeof record?.launch_error === "string" &&
						record.launch_error.includes("prompt send exploded") &&
						typeof record.launch_error_at_ms === "number"
					);
				} catch {
					return false;
				}
			});

			expect(hasLaunchError).toBe(true);
		} finally {
			if (originalOpenCodeRoot === undefined) {
				delete process.env.OPENCODE_ROOT;
			} else {
				process.env.OPENCODE_ROOT = originalOpenCodeRoot;
			}
		}
	});
});
