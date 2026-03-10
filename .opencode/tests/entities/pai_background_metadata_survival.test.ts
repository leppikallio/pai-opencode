import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { maybeHandleBackgroundTaskCompletion } from "../../plugins/pai-cc-hooks/background-completion";
import { stabilizeBackgroundTaskMetadata } from "../../plugins/pai-cc-hooks/background/metadata-stabilizer";
import {
	findBackgroundTaskByChildSessionId,
	findBackgroundTaskByTaskId,
	markBackgroundTaskTerminalAtomic,
	recordBackgroundTaskLaunch,
} from "../../plugins/pai-cc-hooks/tools/background-task-state";
import { createPaiTaskTool } from "../../plugins/pai-cc-hooks/tools/task";

function createTempPaiDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "pai-bg-metadata-survival-"));
}

function restoreEnv(key: string, previousValue: string | undefined): void {
	if (previousValue === undefined) {
		delete process.env[key];
		return;
	}

	process.env[key] = previousValue;
}

function parseFromFinalToolResult(output: string): {
	taskId: string;
	childSessionId: string;
} {
	const taskId = output.match(/Task ID:\s*(\S+)/)?.[1] ?? "";
	const childSessionId = output.match(/Session ID:\s*(\S+)/)?.[1] ?? "";
	return { taskId, childSessionId };
}

describe("background metadata stabilization + survival", () => {
	test("final task tool result metadata survives to durable child-session linkage", async () => {
		const paiDir = createTempPaiDir();
		const prevOpenCodeRoot = process.env.OPENCODE_ROOT;

		process.env.OPENCODE_ROOT = paiDir;
		try {
			const taskTool = createPaiTaskTool({
				client: {
					session: {
						create: async () => ({ data: { id: "child-session-metadata" } }),
						prompt: async () => ({ data: { parts: [{ type: "text", text: "ok" }] } }),
					},
				},
				$: (() => Promise.resolve(null)) as unknown,
			});

			const finalResult = await taskTool.execute(
				{
					description: "Capture durable metadata",
					prompt: "Generate result",
					subagent_type: "Engineer",
					run_in_background: true,
				},
				{
					sessionID: "parent-session-metadata",
					directory: "/tmp/workspace",
				} as any,
			);

			expect(finalResult).toContain("Background task launched");
			const parsed = parseFromFinalToolResult(finalResult);
			expect(parsed.taskId).toBe("bg_child-session-metadata");
			expect(parsed.childSessionId).toBe("child-session-metadata");

			const stabilized = await stabilizeBackgroundTaskMetadata({
				childSessionId: parsed.childSessionId,
				deps: {
					findBackgroundTaskByChildSessionId,
					maxWaitMs: 500,
					pollIntervalMs: 20,
				},
			});

			expect(stabilized.status).toBe("ready");
			if (stabilized.status !== "ready") {
				throw new Error("expected metadata stabilizer ready result");
			}

			expect(stabilized.taskRecord.task_id).toBe(parsed.taskId);
			expect(stabilized.taskRecord.child_session_id).toBe(parsed.childSessionId);
			expect(stabilized.taskRecord.parent_session_id).toBe(
				"parent-session-metadata",
			);

			const persisted = await findBackgroundTaskByTaskId({
				taskId: parsed.taskId,
			});
			expect(persisted?.child_session_id).toBe(parsed.childSessionId);
		} finally {
			restoreEnv("OPENCODE_ROOT", prevOpenCodeRoot);
		}
	});

	test("metadata timeout degrades safely and emits timeout evidence", async () => {
		const timeoutEvents: Array<{
			childSessionId: string;
			attempts: number;
			waitedMs: number;
		}> = [];
		let terminalizeCalls = 0;
		let promptCalls = 0;

		await maybeHandleBackgroundTaskCompletion({
			sessionId: "child-missing-linkage",
			deps: {
				findBackgroundTaskByChildSessionId: async () => null,
				markBackgroundTaskTerminalAtomic: async () => {
					terminalizeCalls += 1;
					return null;
				},
				listBackgroundTasksByParent: async () => [],
				shouldSuppressDuplicate: async () => false,
				promptParentSessionAsync: async () => {
					promptCalls += 1;
					return {};
				},
				notifyCmux: async () => {},
				emitCompletionAttention: async () => {},
				fetchImpl: async () => ({ ok: true }),
				metadataStabilizerMaxWaitMs: 30,
				metadataStabilizerPollIntervalMs: 5,
				onMetadataStabilizationTimeout: (result) => {
					timeoutEvents.push({
						childSessionId: result.childSessionId,
						attempts: result.attempts,
						waitedMs: result.waitedMs,
					});
				},
			},
		});

		expect(timeoutEvents).toHaveLength(1);
		expect(timeoutEvents[0]?.childSessionId).toBe("child-missing-linkage");
		expect(timeoutEvents[0]?.attempts).toBeGreaterThanOrEqual(1);
		expect(timeoutEvents[0]?.waitedMs).toBeGreaterThanOrEqual(30);

		expect(terminalizeCalls).toBe(0);
		expect(promptCalls).toBe(0);
	});

	test("metadata-ready completion path still reaches durable completion state", async () => {
		const paiDir = createTempPaiDir();
		const prevOpenCodeRoot = process.env.OPENCODE_ROOT;

		process.env.OPENCODE_ROOT = paiDir;
		try {
			const nowMs = Date.now();
			const taskTool = createPaiTaskTool({
				client: {
					session: {
						create: async () => ({ data: { id: "child-session-ready" } }),
						prompt: async () => ({ data: { parts: [{ type: "text", text: "ok" }] } }),
					},
				},
				$: (() => Promise.resolve(null)) as unknown,
			});

			const finalResult = await taskTool.execute(
				{
					description: "Complete metadata-ready task",
					prompt: "Finish",
					subagent_type: "Engineer",
					run_in_background: true,
				},
				{
					sessionID: "parent-session-ready",
					directory: "/tmp/workspace",
				} as any,
			);

			const parsed = parseFromFinalToolResult(finalResult);
			expect(parsed.taskId).toBe("bg_child-session-ready");

			await maybeHandleBackgroundTaskCompletion({
				sessionId: parsed.childSessionId,
				deps: {
					findBackgroundTaskByChildSessionId,
					markBackgroundTaskTerminalAtomic,
					listBackgroundTasksByParent: async () => [],
					shouldSuppressDuplicate: async () => false,
					notifyCmux: async () => {},
					emitCompletionAttention: async () => {},
					fetchImpl: async () => ({ ok: true }),
					metadataStabilizerMaxWaitMs: 500,
					metadataStabilizerPollIntervalMs: 20,
					nowMs: () => nowMs + 5_000,
				},
			});

			const completed = await findBackgroundTaskByTaskId({
				taskId: parsed.taskId,
				nowMs: nowMs + 5_001,
			});
			expect(completed?.status).toBe("completed");
			expect(completed?.terminal_reason).toBe("completed");
		} finally {
			restoreEnv("OPENCODE_ROOT", prevOpenCodeRoot);
		}
	});

	test("terminalization write failure does not strand notification claim", async () => {
		const paiDir = createTempPaiDir();
		const prevOpenCodeRoot = process.env.OPENCODE_ROOT;
		const fsPromises = fs.promises as unknown as {
			rename: (from: string, to: string) => Promise<void>;
		};
		const originalRename = fsPromises.rename;

		process.env.OPENCODE_ROOT = paiDir;
		try {
			const nowMs = Date.now();
			await recordBackgroundTaskLaunch({
				taskId: "bg_atomic_retry",
				childSessionId: "child-atomic-retry",
				parentSessionId: "parent-atomic-retry",
				nowMs,
			});

			const completionAttentionEvents: string[] = [];
			let atomicRenameCalls = 0;

			fsPromises.rename = async (from, to) => {
				if (from.includes("background-tasks.json.tmp-") && to.endsWith("background-tasks.json")) {
					atomicRenameCalls += 1;
					if (atomicRenameCalls === 1) {
						throw new Error("simulated terminalization persistence failure");
					}
				}

				await originalRename(from, to);
			};

			await expect(
				maybeHandleBackgroundTaskCompletion({
					sessionId: "child-atomic-retry",
					deps: {
						findBackgroundTaskByChildSessionId,
						markBackgroundTaskTerminalAtomic,
						listBackgroundTasksByParent: async () => [],
						shouldSuppressDuplicate: async () => false,
						notifyCmux: async () => {},
						emitCompletionAttention: async (event) => {
							completionAttentionEvents.push(event.reasonShort);
						},
						fetchImpl: async () => ({ ok: true }),
						nowMs: () => nowMs + 1_000,
						stableCompletionEnabled: false,
					},
				}),
			).rejects.toThrow("simulated terminalization persistence failure");

			const afterFailure = await findBackgroundTaskByTaskId({
				taskId: "bg_atomic_retry",
				nowMs: nowMs + 1_001,
			});
			expect(afterFailure?.status).toBe("running");
			expect(afterFailure?.completed_at_ms).toBeUndefined();

			const statePath = path.join(
				paiDir,
				"MEMORY",
				"STATE",
				"background-tasks.json",
			);
			const stateAfterFailure = JSON.parse(
				fs.readFileSync(statePath, "utf-8"),
			) as {
				notifiedTaskIds?: Record<string, number>;
			};
			expect(stateAfterFailure.notifiedTaskIds?.bg_atomic_retry).toBeUndefined();

			fsPromises.rename = originalRename;

			await maybeHandleBackgroundTaskCompletion({
				sessionId: "child-atomic-retry",
				deps: {
					findBackgroundTaskByChildSessionId,
					markBackgroundTaskTerminalAtomic,
					listBackgroundTasksByParent: async () => [],
					shouldSuppressDuplicate: async () => false,
					notifyCmux: async () => {},
					emitCompletionAttention: async (event) => {
						completionAttentionEvents.push(event.reasonShort);
					},
					fetchImpl: async () => ({ ok: true }),
					nowMs: () => nowMs + 2_000,
					stableCompletionEnabled: false,
				},
			});

			await maybeHandleBackgroundTaskCompletion({
				sessionId: "child-atomic-retry",
				deps: {
					findBackgroundTaskByChildSessionId,
					markBackgroundTaskTerminalAtomic,
					listBackgroundTasksByParent: async () => [],
					shouldSuppressDuplicate: async () => false,
					notifyCmux: async () => {},
					emitCompletionAttention: async (event) => {
						completionAttentionEvents.push(event.reasonShort);
					},
					fetchImpl: async () => ({ ok: true }),
					nowMs: () => nowMs + 3_000,
					stableCompletionEnabled: false,
				},
			});

			const completed = await findBackgroundTaskByTaskId({
				taskId: "bg_atomic_retry",
				nowMs: nowMs + 3_001,
			});
			expect(completed?.status).toBe("completed");
			expect(completed?.terminal_reason).toBe("completed");
			expect(completionAttentionEvents).toHaveLength(1);
		} finally {
			fsPromises.rename = originalRename;
			restoreEnv("OPENCODE_ROOT", prevOpenCodeRoot);
		}
	});
});
