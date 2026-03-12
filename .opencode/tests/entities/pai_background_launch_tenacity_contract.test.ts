import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
	findBackgroundTaskByTaskId,
	recordBackgroundTaskLaunch,
} from "../../plugins/pai-cc-hooks/tools/background-task-state";
import { createPaiTaskTool } from "../../plugins/pai-cc-hooks/tools/task";

function createTempPaiDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "pai-bg-launch-tenacity-"));
}

function restoreEnv(key: string, previousValue: string | undefined): void {
	if (previousValue === undefined) {
		delete process.env[key];
		return;
	}

	process.env[key] = previousValue;
}

function parseTaskId(result: string): string {
	return result.match(/Task ID:\s*(\S+)/)?.[1] ?? "";
}

function expectFinitePositiveNumber(value: unknown): number {
	expect(typeof value).toBe("number");
	expect(Number.isFinite(value)).toBe(true);
	expect((value as number) > 0).toBe(true);
	return value as number;
}

describe("background launch tenacity contract (Task 1 RED)", () => {
	test("review launch exposes contract kind, tenacity window, and cancel guardrails", async () => {
		const paiDir = createTempPaiDir();
		const previousOpenCodeRoot = process.env.OPENCODE_ROOT;
		process.env.OPENCODE_ROOT = paiDir;

		try {
			const taskTool = createPaiTaskTool({
				client: {
					session: {
						create: async () => ({ data: { id: "child-launch-contract" } }),
						promptAsync: async () => ({ data: { queued: true } }),
					},
				},
				$: (() => Promise.resolve(null)) as unknown,
			});

			const launchResult = await taskTool.execute(
				{
					description: "Launch review with tenacity contract",
					prompt: "Perform deep review and report findings",
					subagent_type: "Engineer",
					run_in_background: true,
					task_kind: "review",
				} as any,
				{
					sessionID: "parent-launch-contract",
					directory: "/tmp/workspace",
				} as any,
			);

			expect(launchResult).toContain("Task kind: review");
			expect(launchResult).toContain("Expected quiet window:");
			expect(launchResult).toContain("Minimum tenancy:");
			expect(launchResult).toContain("Cancellation guardrails:");
			expect(launchResult).toContain("Salvage on cancel: required");
			expect(launchResult).toContain("Status:");

			const launchReminderHeaders = launchResult.match(/^Reminder:/gm) ?? [];
			expect(launchReminderHeaders).toHaveLength(1);
			const reminderStartIndex = launchResult.indexOf("Reminder:");
			expect(reminderStartIndex).toBeGreaterThanOrEqual(0);

			const reminderSection = launchResult
				.slice(reminderStartIndex)
				.split("\n\n")[0] ?? "";
			const launchReminderBullets = reminderSection
				.split("\n")
				.filter((line) => line.trim().startsWith("- "));
			expect(launchReminderBullets.length).toBe(3);

			const taskId = parseTaskId(launchResult);
			expect(taskId).toBe("bg_child-launch-contract");

			const persisted = await findBackgroundTaskByTaskId({
				taskId,
				nowMs: 10_000,
			});

			expect((persisted as any)?.task_kind).toBe("review");
			expect((persisted as any)?.contract?.kind).toBe("review");
			const expectedQuietWindowMs = (persisted as any)?.contract?.expectedQuietWindowMs;
			const minimumTenancyMs = (persisted as any)?.contract?.minimumTenancyMs;
			expectFinitePositiveNumber(expectedQuietWindowMs);
			expectFinitePositiveNumber(minimumTenancyMs);
			expect((persisted as any)?.contract?.cancelPolicy).toBe("salvage-first");
			expect((persisted as any)?.contract?.cancellationGuardrails).toEqual({
				requiresForceDuringMinimumTenancy: true,
				silenceAloneDoesNotJustifyCancel: true,
			});
			expect((persisted as any)?.contract?.salvageOnCancelRequired).toBe(true);
		} finally {
			restoreEnv("OPENCODE_ROOT", previousOpenCodeRoot);
		}
	});

	test("minimum tenancy is anchored to execution_started_at_ms and exposed in cancellation metadata", async () => {
		const paiDir = createTempPaiDir();
		const previousOpenCodeRoot = process.env.OPENCODE_ROOT;
		process.env.OPENCODE_ROOT = paiDir;

		try {
			await recordBackgroundTaskLaunch({
				taskId: "bg_launch_tenancy_anchor",
				childSessionId: "child-launch-tenancy-anchor",
				parentSessionId: "parent-launch-tenancy-anchor",
				status: "queued",
				nowMs: 1_000,
				task_kind: "review",
			} as any);

			const queuedRecord = await findBackgroundTaskByTaskId({
				taskId: "bg_launch_tenancy_anchor",
				nowMs: 1_001,
			});

			expect((queuedRecord as any)?.execution_started_at_ms).toBeUndefined();
			expect((queuedRecord as any)?.progress?.nextExpectedUpdateByMs).toBeUndefined();
			expect((queuedRecord as any)?.cancellation?.refusalReasonCode).toBeUndefined();
			expect((queuedRecord as any)?.cancellation?.cancelReasonCode).toBeUndefined();

			await recordBackgroundTaskLaunch({
				taskId: "bg_launch_tenancy_anchor",
				childSessionId: "child-launch-tenancy-anchor",
				parentSessionId: "parent-launch-tenancy-anchor",
				status: "running",
				nowMs: 8_000,
				task_kind: "review",
			} as any);

			const persisted = await findBackgroundTaskByTaskId({
				taskId: "bg_launch_tenancy_anchor",
				nowMs: 8_001,
			});

			const executionStartedAtMs = (persisted as any)?.execution_started_at_ms;
			const minimumTenancyMs = (persisted as any)?.contract?.minimumTenancyMs;
			const minimumTenancyUntilMs =
				(persisted as any)?.cancellation?.minimumTenancyUntilMs;
			const nextExpectedUpdateByMs =
				(persisted as any)?.progress?.nextExpectedUpdateByMs;
			const normalizedMinimumTenancyMs = expectFinitePositiveNumber(minimumTenancyMs);

			expect(executionStartedAtMs).toBe(8_000);
			expect(minimumTenancyUntilMs).toBe(
				executionStartedAtMs + normalizedMinimumTenancyMs,
			);
			expect(minimumTenancyUntilMs).toBeGreaterThan(executionStartedAtMs);
			expectFinitePositiveNumber(nextExpectedUpdateByMs);
			expect(nextExpectedUpdateByMs).toBeGreaterThan(executionStartedAtMs);
			expect((persisted as any)?.cancellation?.refusalReasonCode).toBeUndefined();
			expect((persisted as any)?.cancellation?.cancelReasonCode).toBeUndefined();
			expect((persisted as any)?.cancellation?.cancelReasonText).toBeUndefined();
		} finally {
			restoreEnv("OPENCODE_ROOT", previousOpenCodeRoot);
		}
	});

	test("task_kind is authoritative and launch contract stays immutable after first write", async () => {
		const paiDir = createTempPaiDir();
		const previousOpenCodeRoot = process.env.OPENCODE_ROOT;
		process.env.OPENCODE_ROOT = paiDir;

		try {
			await recordBackgroundTaskLaunch({
				taskId: "bg_launch_contract_immutable",
				childSessionId: "child-launch-contract-immutable",
				parentSessionId: "parent-launch-contract-immutable",
				status: "running",
				nowMs: 5_000,
				task_kind: "review",
				taskKind: "generic",
				expectedQuietWindowMs: 111_000,
				minimumTenancyMs: 222_000,
				expectedDeliverable: "initial-review-artifact",
				cancelPolicy: "salvage-first",
				cancellationGuardrails: {
					requiresForceDuringMinimumTenancy: true,
					silenceAloneDoesNotJustifyCancel: true,
				},
				salvageOnCancelRequired: true,
			} as any);

			await recordBackgroundTaskLaunch({
				taskId: "bg_launch_contract_immutable",
				childSessionId: "child-launch-contract-immutable",
				parentSessionId: "parent-launch-contract-immutable",
				status: "running",
				nowMs: 6_000,
				task_kind: "generic",
				taskKind: "generic",
				expectedQuietWindowMs: 1_000,
				minimumTenancyMs: 2_000,
				expectedDeliverable: "mutated-review-artifact",
				cancelPolicy: "hard-cancel-ok",
				cancellationGuardrails: {
					requiresForceDuringMinimumTenancy: false,
					silenceAloneDoesNotJustifyCancel: false,
				},
				salvageOnCancelRequired: false,
			} as any);

			const persisted = await findBackgroundTaskByTaskId({
				taskId: "bg_launch_contract_immutable",
				nowMs: 6_001,
			});

			expect((persisted as any)?.task_kind).toBe("review");
			expect((persisted as any)?.contract).toEqual({
				kind: "review",
				expectedQuietWindowMs: 111_000,
				minimumTenancyMs: 222_000,
				expectedDeliverable: "initial-review-artifact",
				cancelPolicy: "salvage-first",
				cancellationGuardrails: {
					requiresForceDuringMinimumTenancy: true,
					silenceAloneDoesNotJustifyCancel: true,
				},
				salvageOnCancelRequired: true,
			});
		} finally {
			restoreEnv("OPENCODE_ROOT", previousOpenCodeRoot);
		}
	});
});
