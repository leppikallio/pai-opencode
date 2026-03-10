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

function writeStateFile(paiDir: string, value: unknown): void {
	const stateDir = path.join(paiDir, "MEMORY", "STATE");
	fs.mkdirSync(stateDir, { recursive: true });
	fs.writeFileSync(
		path.join(stateDir, "background-tasks.json"),
		`${JSON.stringify(value, null, 2)}\n`,
		"utf-8",
	);
}

describe("PAI parent-session background completion notifier", () => {
	test("bubbles silently per-task and wakes parent when all complete", async () => {
		const paiDir = createTempPaiDir();
		const originalOpenCodeRoot = process.env.OPENCODE_ROOT;
		const originalVisibleFallback =
			process.env.PAI_BACKGROUND_COMPLETION_VISIBLE_FALLBACK;

		process.env.OPENCODE_ROOT = paiDir;
		delete process.env.PAI_BACKGROUND_COMPLETION_VISIBLE_FALLBACK;
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

			const completedA = await markBackgroundTaskCompleted({
				taskId: "bg_ses_child_a",
				nowMs: nowMs + 10,
			});
			expect(completedA).not.toBeNull();
			if (!completedA)
				throw new Error("expected completed task record for bg_ses_child_a");

			await notifyParentSessionBackgroundCompletion({
				taskRecord: completedA,
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
			expect(promptCalls[0]?.body?.parts?.[0]?.synthetic).toBe(true);
			expect(String(promptCalls[0]?.body?.parts?.[0]?.text ?? "")).toContain(
				"[BACKGROUND TASK COMPLETED]",
			);
			expect(String(promptCalls[0]?.body?.parts?.[0]?.text ?? "")).toContain(
				"**ID:** `bg_ses_child_a`",
			);
			expect(String(promptCalls[0]?.body?.parts?.[0]?.text ?? "")).toContain(
				'background_output(task_id="bg_ses_child_a")',
			);

			const completedB = await markBackgroundTaskCompleted({
				taskId: "bg_ses_child_b",
				nowMs: nowMs + 20,
			});
			expect(completedB).not.toBeNull();
			if (!completedB)
				throw new Error("expected completed task record for bg_ses_child_b");

			await notifyParentSessionBackgroundCompletion({
				taskRecord: completedB,
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
			expect(promptCalls[1]?.body?.parts?.[0]?.synthetic).toBe(true);
			expect(String(promptCalls[1]?.body?.parts?.[0]?.text ?? "")).toContain(
				"[ALL BACKGROUND TASKS COMPLETE]",
			);
			expect(String(promptCalls[1]?.body?.parts?.[0]?.text ?? "")).toContain(
				"`bg_ses_child_a`",
			);
			expect(String(promptCalls[1]?.body?.parts?.[0]?.text ?? "")).toContain(
				"`bg_ses_child_b`",
			);

			expect(suppressCalls).toHaveLength(2);
			expect(suppressCalls[0]?.sessionId).toBe(parentSessionId);
			expect(suppressCalls[0]?.title).toBe("OpenCode");

			const tasks = await listBackgroundTasksByParent({
				parentSessionId,
				nowMs: nowMs + 30,
			});
			expect(tasks.map((t) => t.task_id)).toEqual([
				"bg_ses_child_a",
				"bg_ses_child_b",
			]);
		} finally {
			if (originalOpenCodeRoot === undefined) delete process.env.OPENCODE_ROOT;
			else process.env.OPENCODE_ROOT = originalOpenCodeRoot;

			if (originalVisibleFallback === undefined) {
				delete process.env.PAI_BACKGROUND_COMPLETION_VISIBLE_FALLBACK;
			} else {
				process.env.PAI_BACKGROUND_COMPLETION_VISIBLE_FALLBACK =
					originalVisibleFallback;
			}
		}
	});

	test("uses visible fallback when env flag is enabled", async () => {
		const paiDir = createTempPaiDir();
		const originalOpenCodeRoot = process.env.OPENCODE_ROOT;
		const originalVisibleFallback =
			process.env.PAI_BACKGROUND_COMPLETION_VISIBLE_FALLBACK;

		process.env.OPENCODE_ROOT = paiDir;
		process.env.PAI_BACKGROUND_COMPLETION_VISIBLE_FALLBACK = "1";

		try {
			const parentSessionId = "ses_parent_visible_fallback";
			const nowMs = Date.now();

			await recordBackgroundTaskLaunch({
				taskId: "bg_ses_child_visible",
				childSessionId: "ses_child_visible",
				parentSessionId,
				nowMs,
			});

			const promptCalls: any[] = [];
			const promptAsync = async (call: any) => {
				promptCalls.push(call);
			};

			const completed = await markBackgroundTaskCompleted({
				taskId: "bg_ses_child_visible",
				nowMs: nowMs + 10,
			});
			expect(completed).not.toBeNull();
			if (!completed)
				throw new Error(
					"expected completed task record for bg_ses_child_visible",
				);

			await notifyParentSessionBackgroundCompletion({
				taskRecord: completed,
				deps: {
					promptAsync,
					listBackgroundTasksByParent,
					shouldSuppressDuplicate: async () => false,
					nowMs: nowMs + 11,
				},
			});

			expect(promptCalls).toHaveLength(1);
			expect(promptCalls[0]?.body?.parts?.[0]?.synthetic).toBe(false);
		} finally {
			if (originalOpenCodeRoot === undefined) delete process.env.OPENCODE_ROOT;
			else process.env.OPENCODE_ROOT = originalOpenCodeRoot;

			if (originalVisibleFallback === undefined) {
				delete process.env.PAI_BACKGROUND_COMPLETION_VISIBLE_FALLBACK;
			} else {
				process.env.PAI_BACKGROUND_COMPLETION_VISIBLE_FALLBACK =
					originalVisibleFallback;
			}
		}
	});

	test("uses normalized lifecycle status instead of raw launch_error for all-complete fan-in", async () => {
		const paiDir = createTempPaiDir();
		const originalOpenCodeRoot = process.env.OPENCODE_ROOT;

		process.env.OPENCODE_ROOT = paiDir;
		try {
			const parentSessionId = "ses_parent_normalized";
			const nowMs = Date.now();

			writeStateFile(paiDir, {
				version: 2,
				updatedAtMs: nowMs,
				notifiedTaskIds: {},
				duplicateBySession: {},
				backgroundTasks: {
					bg_running_with_error: {
						version: 2,
						task_id: "bg_running_with_error",
						task_description: "Still working",
						child_session_id: "ses_running_with_error",
						parent_session_id: parentSessionId,
						launched_at_ms: nowMs - 100,
						updated_at_ms: nowMs,
						status: "running",
						launch_error: "diagnostic only",
						launch_error_at_ms: nowMs,
					},
					bg_completed_terminal: {
						version: 2,
						task_id: "bg_completed_terminal",
						task_description: "Done",
						child_session_id: "ses_completed_terminal",
						parent_session_id: parentSessionId,
						launched_at_ms: nowMs - 200,
						updated_at_ms: nowMs,
						status: "completed",
						terminal_reason: "completed",
						completed_at_ms: nowMs - 1,
					},
				},
			});

			const tasks = await listBackgroundTasksByParent({
				parentSessionId,
				nowMs: nowMs + 1,
			});
			const completedTask = tasks.find(
				(task) => task.task_id === "bg_completed_terminal",
			);
			expect(completedTask).not.toBeUndefined();
			if (!completedTask) {
				throw new Error("expected terminal task in listBackgroundTasksByParent");
			}

			const promptCalls: any[] = [];
			await notifyParentSessionBackgroundCompletion({
				taskRecord: completedTask,
				deps: {
					promptAsync: async (call: any) => {
						promptCalls.push(call);
					},
					listBackgroundTasksByParent,
					shouldSuppressDuplicate: async () => false,
					nowMs: nowMs + 2,
				},
			});

			expect(promptCalls).toHaveLength(1);
			const notificationText = String(
				promptCalls[0]?.body?.parts?.[0]?.text ?? "",
			);
			expect(notificationText).toContain("[BACKGROUND TASK COMPLETED]");
			expect(notificationText).toContain("**1 task still in progress.**");
			expect(notificationText).not.toContain("[ALL BACKGROUND TASKS COMPLETE]");
		} finally {
			if (originalOpenCodeRoot === undefined) delete process.env.OPENCODE_ROOT;
			else process.env.OPENCODE_ROOT = originalOpenCodeRoot;
		}
	});
});
