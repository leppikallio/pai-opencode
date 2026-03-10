import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { normalizeBackgroundTaskLifecycle } from "../../plugins/pai-cc-hooks/background/lifecycle-normalizer";
import {
	findBackgroundTaskByTaskId,
	getBackgroundTaskStatePath,
	listActiveBackgroundTasks,
	markBackgroundTaskCancelled,
	markBackgroundTaskCompleted,
	recordBackgroundTaskLaunch,
	recordBackgroundTaskLaunchError,
} from "../../plugins/pai-cc-hooks/tools/background-task-state";

function createTempPaiDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "pai-bg-state-machine-"));
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

describe("background task state machine + migration", () => {
	test("writer cutover persists version 2 record marker and legal launch transitions", async () => {
		const paiDir = createTempPaiDir();
		const originalOpenCodeRoot = process.env.OPENCODE_ROOT;
		process.env.OPENCODE_ROOT = paiDir;
		try {
			await recordBackgroundTaskLaunch({
				taskId: "bg_state_1",
				childSessionId: "child_state_1",
				parentSessionId: "parent_state_1",
				status: "queued",
				concurrencyGroup: "model:openai/gpt-5.3-codex",
				nowMs: 1_000,
			});
			await recordBackgroundTaskLaunch({
				taskId: "bg_state_1",
				childSessionId: "child_state_1",
				parentSessionId: "parent_state_1",
				status: "running",
				nowMs: 2_000,
			});
			await recordBackgroundTaskLaunch({
				taskId: "bg_state_1",
				childSessionId: "child_state_1",
				parentSessionId: "parent_state_1",
				status: "stable_idle",
				nowMs: 3_000,
			});
			const completed = await markBackgroundTaskCompleted({
				taskId: "bg_state_1",
				nowMs: 4_000,
			});

			expect(completed?.status).toBe("completed");
			expect(completed?.terminal_reason).toBe("completed");
			expect(completed?.completed_at_ms).toBe(4_000);

			const raw = JSON.parse(
				fs.readFileSync(getBackgroundTaskStatePath(), "utf-8"),
			) as {
				version?: number;
				backgroundTasks?: Record<
					string,
					{
						version?: number;
						status?: string;
						terminal_reason?: string;
						concurrency_group?: string;
					}
				>;
			};
			expect(raw.version).toBe(2);
			expect(raw.backgroundTasks?.bg_state_1).toMatchObject({
				version: 2,
				status: "completed",
				terminal_reason: "completed",
				concurrency_group: "model:openai/gpt-5.3-codex",
			});
		} finally {
			if (originalOpenCodeRoot === undefined) {
				delete process.env.OPENCODE_ROOT;
			} else {
				process.env.OPENCODE_ROOT = originalOpenCodeRoot;
			}
		}
	});

	test("terminal precedence keeps cancelled over later failure/completed writes", async () => {
		const paiDir = createTempPaiDir();
		const originalOpenCodeRoot = process.env.OPENCODE_ROOT;
		process.env.OPENCODE_ROOT = paiDir;
		try {
			await recordBackgroundTaskLaunch({
				taskId: "bg_precedence",
				childSessionId: "child_precedence",
				parentSessionId: "parent_precedence",
				nowMs: 10,
			});
			await markBackgroundTaskCancelled({
				taskId: "bg_precedence",
				reason: "cancelled by user",
				nowMs: 11,
			});
			await recordBackgroundTaskLaunchError({
				taskId: "bg_precedence",
				errorMessage: "late failure after cancel",
				nowMs: 12,
			});
			await markBackgroundTaskCompleted({ taskId: "bg_precedence", nowMs: 13 });

			const record = await findBackgroundTaskByTaskId({
				taskId: "bg_precedence",
				nowMs: 13,
			});
			expect(record?.status).toBe("cancelled");
			expect(record?.terminal_reason).toBe("cancelled");
			expect(record?.completed_at_ms).toBe(11);
		} finally {
			if (originalOpenCodeRoot === undefined) {
				delete process.env.OPENCODE_ROOT;
			} else {
				process.env.OPENCODE_ROOT = originalOpenCodeRoot;
			}
		}
	});

	test("explicit continuation reactivates a previously terminal record on the same task_id", async () => {
		const paiDir = createTempPaiDir();
		const originalOpenCodeRoot = process.env.OPENCODE_ROOT;
		process.env.OPENCODE_ROOT = paiDir;
		try {
			await recordBackgroundTaskLaunch({
				taskId: "bg_reactivate",
				childSessionId: "child_reactivate",
				parentSessionId: "parent_reactivate",
				nowMs: 1_000,
			});
			await markBackgroundTaskCompleted({
				taskId: "bg_reactivate",
				nowMs: 1_100,
			});

			const terminalRecord = await findBackgroundTaskByTaskId({
				taskId: "bg_reactivate",
				nowMs: 1_101,
			});
			expect(terminalRecord).toMatchObject({
				status: "completed",
				terminal_reason: "completed",
				completed_at_ms: 1_100,
			});

			await recordBackgroundTaskLaunch({
				taskId: "bg_reactivate",
				childSessionId: "child_reactivate",
				parentSessionId: "parent_reactivate",
				status: "queued",
				nowMs: 1_200,
			});

			const queuedRecord = await findBackgroundTaskByTaskId({
				taskId: "bg_reactivate",
				nowMs: 1_201,
			});
			expect(queuedRecord).toMatchObject({
				task_id: "bg_reactivate",
				child_session_id: "child_reactivate",
				status: "queued",
				terminal_reason: undefined,
				completed_at_ms: undefined,
				launched_at_ms: 1_000,
			});

			await recordBackgroundTaskLaunch({
				taskId: "bg_reactivate",
				childSessionId: "child_reactivate",
				parentSessionId: "parent_reactivate",
				status: "running",
				nowMs: 1_300,
			});

			const reactivatedRecord = await findBackgroundTaskByTaskId({
				taskId: "bg_reactivate",
				nowMs: 1_301,
			});
			expect(reactivatedRecord).toMatchObject({
				status: "running",
				terminal_reason: undefined,
				completed_at_ms: undefined,
				launched_at_ms: 1_000,
			});

			const active = await listActiveBackgroundTasks({ nowMs: 1_302 });
			expect(active.map((record) => record.task_id)).toEqual(["bg_reactivate"]);
		} finally {
			if (originalOpenCodeRoot === undefined) {
				delete process.env.OPENCODE_ROOT;
			} else {
				process.env.OPENCODE_ROOT = originalOpenCodeRoot;
			}
		}
	});

	test("mixed records normalize with v2 precedence over legacy diagnostics", async () => {
		const paiDir = createTempPaiDir();
		const originalOpenCodeRoot = process.env.OPENCODE_ROOT;
		process.env.OPENCODE_ROOT = paiDir;
		try {
			writeStateFile(paiDir, {
				version: 1,
				updatedAtMs: 1_000,
				notifiedTaskIds: {},
				duplicateBySession: {},
				backgroundTasks: {
					legacy_failed: {
						task_id: "legacy_failed",
						child_session_id: "child_legacy_failed",
						parent_session_id: "parent_legacy_failed",
						launched_at_ms: 100,
						updated_at_ms: 200,
						launch_error: "prompt send exploded",
						launch_error_at_ms: 200,
					},
					legacy_completed: {
						task_id: "legacy_completed",
						child_session_id: "child_legacy_completed",
						parent_session_id: "parent_legacy_completed",
						launched_at_ms: 100,
						updated_at_ms: 400,
						completed_at_ms: 400,
					},
					v2_completed_with_diagnostic: {
						version: 2,
						task_id: "v2_completed_with_diagnostic",
						child_session_id: "child_v2",
						parent_session_id: "parent_v2",
						launched_at_ms: 100,
						updated_at_ms: 500,
						completed_at_ms: 500,
						status: "completed",
						terminal_reason: "completed",
						launch_error: "diagnostic only",
						launch_error_at_ms: 450,
					},
				},
			});

			const legacyFailed = await findBackgroundTaskByTaskId({
				taskId: "legacy_failed",
				nowMs: 600,
			});
			const legacyCompleted = await findBackgroundTaskByTaskId({
				taskId: "legacy_completed",
				nowMs: 600,
			});
			const v2Completed = await findBackgroundTaskByTaskId({
				taskId: "v2_completed_with_diagnostic",
				nowMs: 600,
			});

			expect(legacyFailed).toMatchObject({
				version: 2,
				status: "failed",
				terminal_reason: "failed",
			});
			expect(legacyCompleted).toMatchObject({
				version: 2,
				status: "completed",
				terminal_reason: "completed",
			});
			expect(v2Completed).toMatchObject({
				version: 2,
				status: "completed",
				terminal_reason: "completed",
			});

			expect(normalizeBackgroundTaskLifecycle(v2Completed ?? {}).status).toBe(
				"completed",
			);
		} finally {
			if (originalOpenCodeRoot === undefined) {
				delete process.env.OPENCODE_ROOT;
			} else {
				process.env.OPENCODE_ROOT = originalOpenCodeRoot;
			}
		}
	});

	test("active-list consumer uses normalization helper for legacy records", async () => {
		const paiDir = createTempPaiDir();
		const originalOpenCodeRoot = process.env.OPENCODE_ROOT;
		process.env.OPENCODE_ROOT = paiDir;
		try {
			writeStateFile(paiDir, {
				version: 1,
				updatedAtMs: 1_000,
				notifiedTaskIds: {},
				duplicateBySession: {},
				backgroundTasks: {
					legacy_running: {
						task_id: "legacy_running",
						child_session_id: "child_running",
						parent_session_id: "parent_running",
						launched_at_ms: 100,
						updated_at_ms: 200,
					},
					legacy_failed: {
						task_id: "legacy_failed",
						child_session_id: "child_failed",
						parent_session_id: "parent_failed",
						launched_at_ms: 100,
						updated_at_ms: 300,
						launch_error: "exploded",
						launch_error_at_ms: 300,
					},
				},
			});

			const active = await listActiveBackgroundTasks({ nowMs: 1_500 });
			expect(active.map((record) => record.task_id)).toEqual(["legacy_running"]);
		} finally {
			if (originalOpenCodeRoot === undefined) {
				delete process.env.OPENCODE_ROOT;
			} else {
				process.env.OPENCODE_ROOT = originalOpenCodeRoot;
			}
		}
	});
});
