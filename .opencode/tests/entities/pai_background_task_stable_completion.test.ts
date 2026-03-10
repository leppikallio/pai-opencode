import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { BackgroundTaskPoller } from "../../plugins/pai-cc-hooks/background/poller";
import {
	findBackgroundTaskByTaskId,
	listActiveBackgroundTasks,
	markBackgroundTaskTerminalAtomic,
	recordBackgroundTaskLaunch,
	recordBackgroundTaskObservation,
} from "../../plugins/pai-cc-hooks/tools/background-task-state";

function createTempPaiDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "pai-bg-stable-completion-"));
}

function restoreEnv(key: string, previousValue: string | undefined): void {
	if (previousValue === undefined) {
		delete process.env[key];
		return;
	}

	process.env[key] = previousValue;
}

describe("background task stable completion", () => {
	test("flag OFF keeps first-idle completion behavior", async () => {
		const paiDir = createTempPaiDir();
		const prevOpenCodeRoot = process.env.OPENCODE_ROOT;
		const prevStableFlag = process.env.PAI_ORCHESTRATION_STABLE_COMPLETION_ENABLED;
		const nowMs = Date.now();

		process.env.OPENCODE_ROOT = paiDir;
		process.env.PAI_ORCHESTRATION_STABLE_COMPLETION_ENABLED = "0";
		try {
			await recordBackgroundTaskLaunch({
				taskId: "bg_stable_off",
				childSessionId: "ses_stable_off",
				parentSessionId: "ses_parent",
				nowMs,
			});

			const poller = new BackgroundTaskPoller({
				client: {
					session: {
						status: async () => ({
							data: {
								ses_stable_off: { type: "idle" },
							},
						}),
					},
				},
				listActiveBackgroundTasks,
				markBackgroundTaskTerminalAtomic,
				nowMs: () => nowMs,
			});

			await poller.pollOnce();

			const record = await findBackgroundTaskByTaskId({
				taskId: "bg_stable_off",
			});
			expect(record?.status).toBe("completed");
			expect(record?.terminal_reason).toBe("completed");
			expect(typeof record?.completed_at_ms).toBe("number");
		} finally {
			restoreEnv("OPENCODE_ROOT", prevOpenCodeRoot);
			restoreEnv(
				"PAI_ORCHESTRATION_STABLE_COMPLETION_ENABLED",
				prevStableFlag,
			);
		}
	});

	test("flag ON requires stable idle confidence before completion", async () => {
		const paiDir = createTempPaiDir();
		const prevOpenCodeRoot = process.env.OPENCODE_ROOT;
		const prevStableFlag = process.env.PAI_ORCHESTRATION_STABLE_COMPLETION_ENABLED;

		let nowMs = 1_000;
		let completedCalls = 0;

		process.env.OPENCODE_ROOT = paiDir;
		process.env.PAI_ORCHESTRATION_STABLE_COMPLETION_ENABLED = "1";
		try {
			await recordBackgroundTaskLaunch({
				taskId: "bg_stable_on",
				childSessionId: "ses_stable_on",
				parentSessionId: "ses_parent",
				nowMs,
			});

			const poller = new BackgroundTaskPoller({
				client: {
					session: {
						status: async () => ({
							data: {
								ses_stable_on: { type: "idle" },
							},
						}),
					},
				},
				listActiveBackgroundTasks,
				markBackgroundTaskTerminalAtomic,
				recordBackgroundTaskObservation,
				nowMs: () => nowMs,
				stableCompletionPolicy: {
					minimumRuntimeMs: 2_000,
					stableIdleObservationMs: 1_000,
					staleNoProgressMs: 30_000,
				},
				onTaskCompleted: async () => {
					completedCalls += 1;
				},
			});

			nowMs = 1_500;
			await poller.pollOnce();

			const afterFirstIdle = await findBackgroundTaskByTaskId({
				taskId: "bg_stable_on",
				nowMs,
			});
			expect(afterFirstIdle?.status).toBe("stable_idle");
			expect(afterFirstIdle?.completed_at_ms).toBeUndefined();
			expect(completedCalls).toBe(0);

			nowMs = 3_200;
			await poller.pollOnce();

			const completed = await findBackgroundTaskByTaskId({
				taskId: "bg_stable_on",
				nowMs,
			});
			expect(completed?.status).toBe("completed");
			expect(completed?.terminal_reason).toBe("completed");
			expect(completedCalls).toBe(1);
		} finally {
			restoreEnv("OPENCODE_ROOT", prevOpenCodeRoot);
			restoreEnv(
				"PAI_ORCHESTRATION_STABLE_COMPLETION_ENABLED",
				prevStableFlag,
			);
		}
	});

	test("flag ON marks no-progress tasks stale and requests cancellation", async () => {
		const paiDir = createTempPaiDir();
		const prevOpenCodeRoot = process.env.OPENCODE_ROOT;
		const prevStableFlag = process.env.PAI_ORCHESTRATION_STABLE_COMPLETION_ENABLED;

		let nowMs = 1_000;
		const cancellationRequests: string[] = [];

		process.env.OPENCODE_ROOT = paiDir;
		process.env.PAI_ORCHESTRATION_STABLE_COMPLETION_ENABLED = "1";
		try {
			await recordBackgroundTaskLaunch({
				taskId: "bg_stale",
				childSessionId: "ses_stale",
				parentSessionId: "ses_parent",
				nowMs,
			});

			const poller = new BackgroundTaskPoller({
				client: {
					session: {
						status: async () => ({ data: {} }),
					},
				},
				listActiveBackgroundTasks,
				markBackgroundTaskTerminalAtomic,
				recordBackgroundTaskObservation,
				nowMs: () => nowMs,
				stableCompletionPolicy: {
					minimumRuntimeMs: 500,
					stableIdleObservationMs: 500,
					staleNoProgressMs: 2_000,
				},
				requestTaskCancellation: async ({ taskRecord }) => {
					cancellationRequests.push(taskRecord.child_session_id);
				},
			});

			nowMs = 4_500;
			await poller.pollOnce();

			const staleRecord = await findBackgroundTaskByTaskId({
				taskId: "bg_stale",
				nowMs,
			});
			expect(staleRecord?.status).toBe("stale");
			expect(staleRecord?.terminal_reason).toBe("stale");
			expect(staleRecord?.launch_error ?? "").toContain("No progress detected");
			expect(cancellationRequests).toEqual(["ses_stale"]);

			const active = await listActiveBackgroundTasks({ nowMs });
			expect(active.map((task) => task.task_id)).toEqual([]);
		} finally {
			restoreEnv("OPENCODE_ROOT", prevOpenCodeRoot);
			restoreEnv(
				"PAI_ORCHESTRATION_STABLE_COMPLETION_ENABLED",
				prevStableFlag,
			);
		}
	});
});
