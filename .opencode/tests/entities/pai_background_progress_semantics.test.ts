import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { BackgroundTaskPoller } from "../../plugins/pai-cc-hooks/background/poller";
import { handleToolExecuteAfter } from "../../plugins/pai-cc-hooks/tool-after";
import {
	findBackgroundTaskByChildSessionId,
	findBackgroundTaskByTaskId,
	listActiveBackgroundTasks,
	markBackgroundTaskTerminalAtomic,
	recordBackgroundTaskLaunch,
	recordBackgroundTaskObservation,
	recordBackgroundTaskProgressHeartbeat,
} from "../../plugins/pai-cc-hooks/tools/background-task-state";

const PROGRESS_PHASES = [
	"started",
	"collecting",
	"analyzing",
	"drafting",
	"finalizing",
	"blocked",
] as const;

const LIFECYCLE_STATUSES = new Set([
	"queued",
	"running",
	"stable_idle",
	"completed",
	"failed",
	"cancelled",
	"stale",
]);

function createTempPaiDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "pai-bg-progress-semantics-"));
}

function restoreEnv(key: string, previousValue: string | undefined): void {
	if (previousValue === undefined) {
		delete process.env[key];
		return;
	}

	process.env[key] = previousValue;
}

function expectFiniteNonNegativeNumber(value: unknown): number {
	expect(typeof value).toBe("number");
	expect(Number.isFinite(value)).toBe(true);
	expect((value as number) >= 0).toBe(true);
	return value as number;
}

describe("background semantic progress contract (Task 1 RED)", () => {
	test("launch initializes semantic progress separately from lifecycle status", async () => {
		const paiDir = createTempPaiDir();
		const previousOpenCodeRoot = process.env.OPENCODE_ROOT;
		process.env.OPENCODE_ROOT = paiDir;

		try {
			await recordBackgroundTaskLaunch({
				taskId: "bg_progress_launch_contract",
				childSessionId: "child-progress-launch-contract",
				parentSessionId: "parent-progress-launch-contract",
				status: "running",
				nowMs: 1_000,
				task_kind: "review",
			} as any);

			const record = await findBackgroundTaskByTaskId({
				taskId: "bg_progress_launch_contract",
				nowMs: 1_001,
			});

			const lifecycleStatus = (record as any)?.status;
			const progress = (record as any)?.progress;
			const lastProductiveAtMs = expectFiniteNonNegativeNumber(
				progress?.lastProductiveAtMs,
			);
			const nextExpectedUpdateByMs = expectFiniteNonNegativeNumber(
				progress?.nextExpectedUpdateByMs,
			);

			expect(LIFECYCLE_STATUSES.has(String(lifecycleStatus))).toBe(true);
			expect(progress?.phase).toBe("started");
			expect(progress?.phase).not.toBe(lifecycleStatus);
			expect(nextExpectedUpdateByMs).toBeGreaterThanOrEqual(lastProductiveAtMs);
			expect((record as any)?.phase).toBeUndefined();
			expect((record as any)?.nextExpectedUpdateByMs).toBeUndefined();
		} finally {
			restoreEnv("OPENCODE_ROOT", previousOpenCodeRoot);
		}
	});

	test("runtime progress supports all semantic phases without overloading lifecycle status", async () => {
		const paiDir = createTempPaiDir();
		const previousOpenCodeRoot = process.env.OPENCODE_ROOT;
		process.env.OPENCODE_ROOT = paiDir;

		try {
			await recordBackgroundTaskLaunch({
				taskId: "bg_progress_phase_matrix",
				childSessionId: "child-progress-phase-matrix",
				parentSessionId: "parent-progress-phase-matrix",
				status: "running",
				nowMs: 10_000,
				task_kind: "review",
			} as any);

			const launched = await findBackgroundTaskByTaskId({
				taskId: "bg_progress_phase_matrix",
				nowMs: 10_001,
			});
			let expectedDeadline = expectFiniteNonNegativeNumber(
				(launched as any)?.progress?.nextExpectedUpdateByMs,
			);

			let nowMs = 10_100;
			for (const phase of PROGRESS_PHASES) {
				await recordBackgroundTaskObservation({
					taskId: "bg_progress_phase_matrix",
					status: "running",
					nowMs,
					phase,
					lastProductiveAtMs: nowMs,
					nextExpectedUpdateByMs: nowMs + 5_000,
					blockedReasonCode:
						phase === "blocked" ? "NO_PRODUCTIVE_PROGRESS" : undefined,
				} as any);

				const record = await findBackgroundTaskByTaskId({
					taskId: "bg_progress_phase_matrix",
					nowMs: nowMs + 1,
				});

				const progress = (record as any)?.progress;
				const lastProductiveAtMs = expectFiniteNonNegativeNumber(
					progress?.lastProductiveAtMs,
				);
				const nextExpectedUpdateByMs = expectFiniteNonNegativeNumber(
					progress?.nextExpectedUpdateByMs,
				);
				expect(progress?.phase).toBe(phase);
				expect(lastProductiveAtMs).toBe(nowMs);
				expectedDeadline = Math.max(expectedDeadline, nowMs + 5_000);
				expect(nextExpectedUpdateByMs).toBe(expectedDeadline);
				if (phase === "blocked") {
					expect(progress?.blockedReasonCode).toBe("NO_PRODUCTIVE_PROGRESS");
				}

				expect(LIFECYCLE_STATUSES.has(String((record as any)?.status))).toBe(true);
				expect((record as any)?.status).not.toBe(phase);

				nowMs += 100;
			}
		} finally {
			restoreEnv("OPENCODE_ROOT", previousOpenCodeRoot);
		}
	});
});

describe("background semantic progress blocker regressions (Task 3)", () => {
	test("deadline-only and timer-only productive heartbeats do not mutate productive timestamps", async () => {
		const paiDir = createTempPaiDir();
		const previousOpenCodeRoot = process.env.OPENCODE_ROOT;
		process.env.OPENCODE_ROOT = paiDir;

		try {
			await recordBackgroundTaskLaunch({
				taskId: "bg_progress_blockers_deadline_only",
				childSessionId: "child-progress-blockers-deadline-only",
				parentSessionId: "parent-progress-blockers-deadline-only",
				status: "running",
				nowMs: 1_000,
				task_kind: "review",
			} as any);

			const baseline = await findBackgroundTaskByTaskId({
				taskId: "bg_progress_blockers_deadline_only",
				nowMs: 1_001,
			});
			const baselineLastProductiveAtMs = (baseline as any)?.progress?.lastProductiveAtMs;
			const baselineDeadline = (baseline as any)?.progress?.nextExpectedUpdateByMs;

			await recordBackgroundTaskProgressHeartbeat({
				taskId: "bg_progress_blockers_deadline_only",
				status: "running",
				nextExpectedUpdateByMs: (baselineDeadline ?? 0) + 60_000,
				nowMs: 1_100,
			} as any);

			const afterDeadlineOnly = await findBackgroundTaskByTaskId({
				taskId: "bg_progress_blockers_deadline_only",
				nowMs: 1_101,
			});
			expect((afterDeadlineOnly as any)?.progress?.lastProductiveAtMs).toBe(
				baselineLastProductiveAtMs,
			);
			expect((afterDeadlineOnly as any)?.progress?.nextExpectedUpdateByMs).toBe(
				baselineDeadline,
			);

			await recordBackgroundTaskProgressHeartbeat({
				taskId: "bg_progress_blockers_deadline_only",
				status: "running",
				productive: true,
				nowMs: 1_200,
			} as any);

			const afterProductiveOnly = await findBackgroundTaskByTaskId({
				taskId: "bg_progress_blockers_deadline_only",
				nowMs: 1_201,
			});
			expect((afterProductiveOnly as any)?.progress?.lastProductiveAtMs).toBe(
				baselineLastProductiveAtMs,
			);
			expect((afterProductiveOnly as any)?.progress?.nextExpectedUpdateByMs).toBe(
				baselineDeadline,
			);

			await recordBackgroundTaskProgressHeartbeat({
				taskId: "bg_progress_blockers_deadline_only",
				status: "running",
				counterIncrements: {
					tools: 1,
				},
				productive: true,
				nowMs: 1_300,
			} as any);

			const afterMeasurableProgress = await findBackgroundTaskByTaskId({
				taskId: "bg_progress_blockers_deadline_only",
				nowMs: 1_301,
			});
			expect((afterMeasurableProgress as any)?.progress?.lastProductiveAtMs).toBe(
				1_300,
			);
			expect((afterMeasurableProgress as any)?.progress?.counters?.tools).toBe(1);
		} finally {
			restoreEnv("OPENCODE_ROOT", previousOpenCodeRoot);
		}
	});

	test("nextExpectedUpdateByMs remains monotonic even under explicit deadline overrides", async () => {
		const paiDir = createTempPaiDir();
		const previousOpenCodeRoot = process.env.OPENCODE_ROOT;
		process.env.OPENCODE_ROOT = paiDir;

		try {
			await recordBackgroundTaskLaunch({
				taskId: "bg_progress_blockers_monotonic_deadline",
				childSessionId: "child-progress-blockers-monotonic-deadline",
				parentSessionId: "parent-progress-blockers-monotonic-deadline",
				status: "running",
				nowMs: 5_000,
				task_kind: "review",
			} as any);

			const baseline = await findBackgroundTaskByTaskId({
				taskId: "bg_progress_blockers_monotonic_deadline",
				nowMs: 5_001,
			});
			const baselineDeadline = expectFiniteNonNegativeNumber(
				(baseline as any)?.progress?.nextExpectedUpdateByMs,
			);

			const forwardDeadline = baselineDeadline + 5_000;
			await recordBackgroundTaskProgressHeartbeat({
				taskId: "bg_progress_blockers_monotonic_deadline",
				status: "running",
				phase: "collecting",
				productive: true,
				nextExpectedUpdateByMs: forwardDeadline,
				nowMs: 5_100,
			} as any);

			await recordBackgroundTaskProgressHeartbeat({
				taskId: "bg_progress_blockers_monotonic_deadline",
				status: "running",
				phase: "analyzing",
				productive: true,
				nextExpectedUpdateByMs: baselineDeadline - 1_000,
				nowMs: 5_200,
			} as any);

			const finalRecord = await findBackgroundTaskByTaskId({
				taskId: "bg_progress_blockers_monotonic_deadline",
				nowMs: 5_201,
			});
			expect((finalRecord as any)?.progress?.nextExpectedUpdateByMs).toBe(
				forwardDeadline,
			);
		} finally {
			restoreEnv("OPENCODE_ROOT", previousOpenCodeRoot);
		}
	});

	test("unchanged poller cycles do not mutate persisted progress timestamps or counters", async () => {
		const paiDir = createTempPaiDir();
		const previousOpenCodeRoot = process.env.OPENCODE_ROOT;
		process.env.OPENCODE_ROOT = paiDir;

		let nowMs = 20_000;

		try {
			await recordBackgroundTaskLaunch({
				taskId: "bg_progress_blockers_poller_stability",
				childSessionId: "child-progress-blockers-poller-stability",
				parentSessionId: "parent-progress-blockers-poller-stability",
				status: "running",
				nowMs,
				task_kind: "review",
			} as any);

			await recordBackgroundTaskProgressHeartbeat({
				taskId: "bg_progress_blockers_poller_stability",
				status: "running",
				counterIncrements: {
					tools: 1,
					artifacts: 1,
				},
				productive: true,
				nowMs: nowMs + 1,
			} as any);

			const beforePoll = await findBackgroundTaskByTaskId({
				taskId: "bg_progress_blockers_poller_stability",
				nowMs: nowMs + 2,
			});

			const poller = new BackgroundTaskPoller({
				client: {
					session: {
						status: async () => ({
							data: {
								"child-progress-blockers-poller-stability": { type: "running" },
							},
						}),
					},
				},
				listActiveBackgroundTasks,
				markBackgroundTaskTerminalAtomic,
				recordBackgroundTaskObservation,
				nowMs: () => nowMs,
				stableCompletionEnabled: true,
				stableCompletionPolicy: {
					minimumRuntimeMs: 0,
					stableIdleObservationMs: 0,
					staleNoProgressMs: 1_000_000,
				},
			});

			nowMs += 100;
			await poller.pollOnce();
			nowMs += 100;
			await poller.pollOnce();

			const afterPoll = await findBackgroundTaskByTaskId({
				taskId: "bg_progress_blockers_poller_stability",
				nowMs,
			});

			expect(afterPoll?.last_progress_at_ms).toBe(beforePoll?.last_progress_at_ms);
			expect((afterPoll as any)?.progress?.lastProductiveAtMs).toBe(
				(beforePoll as any)?.progress?.lastProductiveAtMs,
			);
			expect((afterPoll as any)?.progress?.counters).toEqual(
				(beforePoll as any)?.progress?.counters,
			);
			expect((afterPoll as any)?.progress?.nextExpectedUpdateByMs).toBe(
				(beforePoll as any)?.progress?.nextExpectedUpdateByMs,
			);
		} finally {
			restoreEnv("OPENCODE_ROOT", previousOpenCodeRoot);
		}
	});

		test("tool.execute.after wires child tool completions into heartbeat progress updates", async () => {
			const paiDir = createTempPaiDir();
			const previousOpenCodeRoot = process.env.OPENCODE_ROOT;
			process.env.OPENCODE_ROOT = paiDir;
			const launchNowMs = Date.now();

			try {
				await recordBackgroundTaskLaunch({
					taskId: "bg_progress_blockers_child_seam",
					childSessionId: "child-progress-blockers-seam",
					parentSessionId: "parent-progress-blockers-seam",
					status: "running",
					nowMs: launchNowMs,
					task_kind: "review",
				} as any);

				const before = await findBackgroundTaskByTaskId({
					taskId: "bg_progress_blockers_child_seam",
					nowMs: launchNowMs + 1,
				});

			const seamOutput: Record<string, unknown> = {
				output: "ok",
			};
			let findCalls = 0;
			let heartbeatCalls = 0;
			let lastHeartbeatResult: unknown;

			await handleToolExecuteAfter({
				input: {
					tool: "bash",
					sessionID: "child-progress-blockers-seam",
					callID: "call-child-progress-seam",
					args: {
						command: "bun --version",
					},
				},
				output: seamOutput,
				config: null,
				cwd: process.cwd(),
				deps: {
					executePostToolUseHooks: async () => ({
						block: false,
					}),
					findBackgroundTaskByChildSessionId: async (args) => {
						findCalls += 1;
						return findBackgroundTaskByChildSessionId(args);
					},
					recordBackgroundTaskProgressHeartbeat: async (args) => {
						heartbeatCalls += 1;
						lastHeartbeatResult =
							await recordBackgroundTaskProgressHeartbeat(args);
						return lastHeartbeatResult;
					},
				},
			});

			const after = await findBackgroundTaskByTaskId({
				taskId: "bg_progress_blockers_child_seam",
			});

			expect(findCalls).toBe(1);
			expect(heartbeatCalls).toBe(1);
			expect((lastHeartbeatResult as any)?.task_id).toBe(
				"bg_progress_blockers_child_seam",
			);
			expect((after as any)?.progress?.counters?.tools).toBe(1);
			expect((after as any)?.progress?.lastProductiveAtMs).toBeGreaterThanOrEqual(
				(before as any)?.progress?.lastProductiveAtMs ?? 0,
			);
			expect((after as any)?.last_progress_at_ms).toBeGreaterThanOrEqual(
				before?.last_progress_at_ms ?? 0,
			);
		} finally {
			restoreEnv("OPENCODE_ROOT", previousOpenCodeRoot);
		}
	});
});
