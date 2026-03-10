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
	return fs.mkdtempSync(path.join(os.tmpdir(), "pai-bg-parent-fanin-"));
}

function restoreEnv(key: string, previousValue: string | undefined): void {
	if (previousValue === undefined) {
		delete process.env[key];
		return;
	}

	process.env[key] = previousValue;
}

describe("background parent fan-in queue", () => {
	test("partial completions are coalesced while all-complete remains prominent", async () => {
		const paiDir = createTempPaiDir();
		const prevOpenCodeRoot = process.env.OPENCODE_ROOT;
		const prevVisibleFallback =
			process.env.PAI_BACKGROUND_COMPLETION_VISIBLE_FALLBACK;

		process.env.OPENCODE_ROOT = paiDir;
		delete process.env.PAI_BACKGROUND_COMPLETION_VISIBLE_FALLBACK;
		try {
			const parentSessionId = "ses_parent_fanin_partial";
			const nowMs = Date.now();

			await recordBackgroundTaskLaunch({
				taskId: "bg_partial_a",
				childSessionId: "ses_partial_a",
				parentSessionId,
				nowMs,
			});
			await recordBackgroundTaskLaunch({
				taskId: "bg_partial_b",
				childSessionId: "ses_partial_b",
				parentSessionId,
				nowMs: nowMs + 1,
			});
			await recordBackgroundTaskLaunch({
				taskId: "bg_partial_c",
				childSessionId: "ses_partial_c",
				parentSessionId,
				nowMs: nowMs + 2,
			});

			const promptCalls: Array<{ path?: { id?: string }; body?: any }> = [];
			const suppressCalls: Array<{ body?: string }> = [];

			const completedA = await markBackgroundTaskCompleted({
				taskId: "bg_partial_a",
				nowMs: nowMs + 10,
			});
			if (!completedA) {
				throw new Error("expected completedA record");
			}
			await notifyParentSessionBackgroundCompletion({
				taskRecord: completedA,
				deps: {
					promptAsync: async (call: any) => {
						promptCalls.push(call);
					},
					listBackgroundTasksByParent,
					shouldSuppressDuplicate: async (call: any) => {
						suppressCalls.push(call);
						return false;
					},
					nowMs: nowMs + 11,
				},
			});

			const completedB = await markBackgroundTaskCompleted({
				taskId: "bg_partial_b",
				nowMs: nowMs + 20,
			});
			if (!completedB) {
				throw new Error("expected completedB record");
			}
			await notifyParentSessionBackgroundCompletion({
				taskRecord: completedB,
				deps: {
					promptAsync: async (call: any) => {
						promptCalls.push(call);
					},
					listBackgroundTasksByParent,
					shouldSuppressDuplicate: async (call: any) => {
						suppressCalls.push(call);
						return false;
					},
					nowMs: nowMs + 21,
				},
			});

			const completedC = await markBackgroundTaskCompleted({
				taskId: "bg_partial_c",
				nowMs: nowMs + 30,
			});
			if (!completedC) {
				throw new Error("expected completedC record");
			}
			await notifyParentSessionBackgroundCompletion({
				taskRecord: completedC,
				deps: {
					promptAsync: async (call: any) => {
						promptCalls.push(call);
					},
					listBackgroundTasksByParent,
					shouldSuppressDuplicate: async (call: any) => {
						suppressCalls.push(call);
						return false;
					},
					nowMs: nowMs + 31,
				},
			});

			expect(promptCalls).toHaveLength(2);
			expect(promptCalls[0]?.path?.id).toBe(parentSessionId);
			expect(promptCalls[0]?.body?.noReply).toBe(true);
			expect(String(promptCalls[0]?.body?.parts?.[0]?.text ?? "")).toContain(
				"[BACKGROUND TASK COMPLETED]",
			);
			expect(String(promptCalls[0]?.body?.parts?.[0]?.text ?? "")).toContain(
				"bg_partial_a",
			);

			expect(promptCalls[1]?.body?.noReply).toBe(false);
			expect(String(promptCalls[1]?.body?.parts?.[0]?.text ?? "")).toContain(
				"[ALL BACKGROUND TASKS COMPLETE]",
			);
			expect(String(promptCalls[1]?.body?.parts?.[0]?.text ?? "")).toContain(
				"bg_partial_a",
			);
			expect(String(promptCalls[1]?.body?.parts?.[0]?.text ?? "")).toContain(
				"bg_partial_b",
			);
			expect(String(promptCalls[1]?.body?.parts?.[0]?.text ?? "")).toContain(
				"bg_partial_c",
			);

			expect(suppressCalls).toHaveLength(2);
		} finally {
			restoreEnv("OPENCODE_ROOT", prevOpenCodeRoot);
			restoreEnv(
				"PAI_BACKGROUND_COMPLETION_VISIBLE_FALLBACK",
				prevVisibleFallback,
			);
		}
	});

	test("all-complete fan-in is serialized under concurrent notifications", async () => {
		const paiDir = createTempPaiDir();
		const prevOpenCodeRoot = process.env.OPENCODE_ROOT;

		process.env.OPENCODE_ROOT = paiDir;
		try {
			const parentSessionId = "ses_parent_fanin_serialized";
			const nowMs = Date.now();

			await recordBackgroundTaskLaunch({
				taskId: "bg_serialized_a",
				childSessionId: "ses_serialized_a",
				parentSessionId,
				nowMs,
			});
			await recordBackgroundTaskLaunch({
				taskId: "bg_serialized_b",
				childSessionId: "ses_serialized_b",
				parentSessionId,
				nowMs: nowMs + 1,
			});

			const completedA = await markBackgroundTaskCompleted({
				taskId: "bg_serialized_a",
				nowMs: nowMs + 10,
			});
			const completedB = await markBackgroundTaskCompleted({
				taskId: "bg_serialized_b",
				nowMs: nowMs + 11,
			});
			if (!completedA || !completedB) {
				throw new Error("expected completed records for serialized fan-in test");
			}

			const promptCalls: any[] = [];
			await Promise.all([
				notifyParentSessionBackgroundCompletion({
					taskRecord: completedA,
					deps: {
						promptAsync: async (call: any) => {
							promptCalls.push(call);
						},
						listBackgroundTasksByParent,
						shouldSuppressDuplicate: async () => false,
						nowMs: nowMs + 12,
					},
				}),
				notifyParentSessionBackgroundCompletion({
					taskRecord: completedB,
					deps: {
						promptAsync: async (call: any) => {
							promptCalls.push(call);
						},
						listBackgroundTasksByParent,
						shouldSuppressDuplicate: async () => false,
						nowMs: nowMs + 12,
					},
				}),
			]);

			expect(promptCalls).toHaveLength(1);
			expect(promptCalls[0]?.body?.noReply).toBe(false);
			expect(String(promptCalls[0]?.body?.parts?.[0]?.text ?? "")).toContain(
				"[ALL BACKGROUND TASKS COMPLETE]",
			);
			expect(String(promptCalls[0]?.body?.parts?.[0]?.text ?? "")).toContain(
				"bg_serialized_a",
			);
			expect(String(promptCalls[0]?.body?.parts?.[0]?.text ?? "")).toContain(
				"bg_serialized_b",
			);
		} finally {
			restoreEnv("OPENCODE_ROOT", prevOpenCodeRoot);
		}
	});
});
