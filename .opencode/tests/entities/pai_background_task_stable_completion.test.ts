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

const repoRoot =
	path.basename(process.cwd()) === ".opencode"
		? path.resolve(process.cwd(), "..")
		: process.cwd();

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

function asRecord(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null
		? (value as Record<string, unknown>)
		: null;
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

	test("review task is not classified stalled before persisted quiet-window deadline", async () => {
		const paiDir = createTempPaiDir();
		const prevOpenCodeRoot = process.env.OPENCODE_ROOT;
		const prevStableFlag = process.env.PAI_ORCHESTRATION_STABLE_COMPLETION_ENABLED;

		let nowMs = 1_000;
		const cancellationRequests: string[] = [];

		process.env.OPENCODE_ROOT = paiDir;
		process.env.PAI_ORCHESTRATION_STABLE_COMPLETION_ENABLED = "1";
		try {
			await recordBackgroundTaskLaunch({
				taskId: "bg_review_pre_deadline",
				childSessionId: "ses_review_pre_deadline",
				parentSessionId: "ses_parent",
				status: "running",
				task_kind: "review",
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
					staleNoProgressMs: 90_000,
				},
				requestTaskCancellation: async ({ taskRecord }) => {
					cancellationRequests.push(taskRecord.child_session_id);
				},
			});

			nowMs = 95_000;
			await poller.pollOnce();

			const record = await findBackgroundTaskByTaskId({
				taskId: "bg_review_pre_deadline",
				nowMs,
			});
			expect(record?.progress?.nextExpectedUpdateByMs).toBeGreaterThan(nowMs);
			expect(record?.stall?.stage).toBe("healthy");
			expect(record?.status).toBe("running");
			expect(cancellationRequests).toEqual([]);
		} finally {
			restoreEnv("OPENCODE_ROOT", prevOpenCodeRoot);
			restoreEnv(
				"PAI_ORCHESTRATION_STABLE_COMPLETION_ENABLED",
				prevStableFlag,
			);
		}
	});

	test("review task progresses healthy -> suspected -> confirmed across polls, then cancels with salvage snapshot", async () => {
		const paiDir = createTempPaiDir();
		const prevOpenCodeRoot = process.env.OPENCODE_ROOT;
		const prevStableFlag = process.env.PAI_ORCHESTRATION_STABLE_COMPLETION_ENABLED;

		let nowMs = 1_000;
		const cancellationRequests: string[] = [];

		process.env.OPENCODE_ROOT = paiDir;
		process.env.PAI_ORCHESTRATION_STABLE_COMPLETION_ENABLED = "1";
		try {
			await recordBackgroundTaskLaunch({
				taskId: "bg_review_stall_progression",
				childSessionId: "ses_review_stall_progression",
				parentSessionId: "ses_parent",
				status: "running",
				task_kind: "review",
				expectedQuietWindowMs: 100,
				minimumTenancyMs: 150,
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
					staleNoProgressMs: 90_000,
				},
				requestTaskCancellation: async ({ taskRecord }) => {
					cancellationRequests.push(taskRecord.child_session_id);
				},
			});

			nowMs = 1_099;
			await poller.pollOnce();

			const healthyRecord = await findBackgroundTaskByTaskId({
				taskId: "bg_review_stall_progression",
				nowMs,
			});
			expect(healthyRecord?.stall?.stage).toBe("healthy");
			expect(healthyRecord?.status).toBe("running");
			expect(cancellationRequests).toEqual([]);

			nowMs = 1_200;
			await poller.pollOnce();

			const suspectedRecord = await findBackgroundTaskByTaskId({
				taskId: "bg_review_stall_progression",
				nowMs,
			});
			expect(suspectedRecord?.stall?.stage).toBe("suspected_stall");
			expect(suspectedRecord?.stall?.reasonCode).toBe("STALL_SUSPECTED");
			expect(suspectedRecord?.status).toBe("running");
			expect(cancellationRequests).toEqual([]);

			nowMs = 1_350;
			await poller.pollOnce();

			const cancelledRecord = await findBackgroundTaskByTaskId({
				taskId: "bg_review_stall_progression",
				nowMs,
			});
			expect(cancelledRecord?.stall?.stage).toBe("confirmed_stall");
			expect(cancelledRecord?.stall?.reasonCode).toBe("STALL_CONFIRMED");
			expect(cancelledRecord?.status).toBe("cancelled");
			expect(cancelledRecord?.terminal_reason).toBe("cancelled");
			expect(cancellationRequests).toEqual(["ses_review_stall_progression"]);
			expect((cancelledRecord as any)?.cancellation?.cancelReasonCode).toBe(
				"STALL_CONFIRMED",
			);
			expect((cancelledRecord as any)?.cancellation?.salvageStatus).toBe(
				"succeeded",
			);

			const salvageArtifactPath = (cancelledRecord as any)?.cancellation
				?.salvageArtifactPath;
			expect(typeof salvageArtifactPath).toBe("string");
			if (typeof salvageArtifactPath !== "string") {
				return;
			}

			expect(fs.existsSync(salvageArtifactPath)).toBe(true);
			const salvageSnapshot = JSON.parse(
				fs.readFileSync(salvageArtifactPath, "utf-8"),
			) as unknown;
			const snapshot = asRecord(salvageSnapshot);
			expect(snapshot).not.toBeNull();
			if (!snapshot) {
				return;
			}

			expect(snapshot.taskId).toBe("bg_review_stall_progression");
			expect(snapshot.childSessionId).toBe("ses_review_stall_progression");
			expect(snapshot.contractKind).toBe("review");
			expect(snapshot.lastProgressPhase).toBe("started");
			expect(snapshot.cancellationReasonCode).toBe("STALL_CONFIRMED");
			expect(typeof snapshot.cancellationReasonText).toBe("string");
			expect(String(snapshot.cancellationReasonText)).toContain(
				"No progress detected for 350ms",
			);
			expect(snapshot.capturedAtMs).toBe(1_350);

			const timestamps = asRecord(snapshot.lastKnownProgressTimestamps);
			expect(timestamps).not.toBeNull();
			if (!timestamps) {
				return;
			}

			expect(timestamps.lastProductiveAtMs).toBe(1_000);
			expect(timestamps.nextExpectedUpdateByMs).toBe(1_100);
			expect(timestamps.lastProgressAtMs).toBe(1_000);
			expect(timestamps.updatedAtMs).toBe(1_350);
			expect(Object.prototype.hasOwnProperty.call(snapshot, "reviewOutputTailSummary")).toBe(
				true,
			);
		} finally {
			restoreEnv("OPENCODE_ROOT", prevOpenCodeRoot);
			restoreEnv(
				"PAI_ORCHESTRATION_STABLE_COMPLETION_ENABLED",
				prevStableFlag,
			);
		}
	});

	test("poller stale path delegates terminalization through cancellation policy", () => {
		const pollerPath = path.join(
			repoRoot,
			".opencode/plugins/pai-cc-hooks/background/poller.ts",
		);
		const sourceText = fs.readFileSync(pollerPath, "utf-8");

		const legacyBypassPattern =
			/terminalizeTask\s*\(\s*\{[\s\S]*?reason:\s*"stale"/m;
		const delegatedStalePattern =
			/terminalReason:\s*isReviewTask\s*\?\s*"cancelled"\s*:\s*"stale"/m;

		expect(sourceText.includes("applyBackgroundCancellationPolicy")).toBe(true);
		expect(legacyBypassPattern.test(sourceText)).toBe(false);
		expect(delegatedStalePattern.test(sourceText)).toBe(true);
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
