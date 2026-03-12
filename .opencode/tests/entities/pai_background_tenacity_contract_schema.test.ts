import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { normalizeBackgroundTaskLifecycle } from "../../plugins/pai-cc-hooks/background/lifecycle-normalizer";
import { createPaiBackgroundCancelTool } from "../../plugins/pai-cc-hooks/tools/background-cancel";
import {
	findBackgroundTaskByTaskId,
	recordBackgroundTaskLaunch,
} from "../../plugins/pai-cc-hooks/tools/background-task-state";
import { createPaiTaskTool } from "../../plugins/pai-cc-hooks/tools/task";

const CANONICAL_REASON_CODES = new Set([
	"MIN_TENANCY_BLOCK",
	"POLICY_BLOCK",
	"USER_CANCEL",
	"USER_FORCE_CANCEL",
	"STALL_SUSPECTED",
	"STALL_CONFIRMED",
	"NO_PRODUCTIVE_PROGRESS",
	"CHILD_ERROR",
	"INTERNAL_ERROR",
]);

const CANCELLATION_OUTCOMES = new Set([
	"refused",
	"accepted_pending_terminalization",
	"accepted_terminal",
]);

const SALVAGE_STATUSES = new Set([
	"not_attempted",
	"attempted",
	"succeeded",
	"failed",
]);

const CANCEL_POLICIES = new Set(["salvage-first", "hard-cancel-ok"]);

const PROGRESS_PHASES = new Set([
	"started",
	"collecting",
	"analyzing",
	"drafting",
	"finalizing",
	"blocked",
]);

function createTempPaiDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "pai-bg-tenacity-contract-"));
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

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasOwnField(record: Record<string, unknown>, field: string): boolean {
	return Object.hasOwn(record, field);
}

describe("background tenacity contract schema lock (Task 0 RED)", () => {
	test("lifecycle status remains backward-compatible and excludes progress-phase names", () => {
		const canonicalStatuses = [
			"queued",
			"running",
			"stable_idle",
			"completed",
			"failed",
			"cancelled",
			"stale",
		] as const;

		for (const status of canonicalStatuses) {
			const normalized = normalizeBackgroundTaskLifecycle({
				version: 2,
				status,
			});
			expect(normalized.status).toBe(status);
		}

		for (const progressPhase of [
			"started",
			"collecting",
			"analyzing",
			"drafting",
			"finalizing",
			"blocked",
		] as const) {
			const normalized = normalizeBackgroundTaskLifecycle({
				version: 2,
				status: progressPhase,
			});
			expect(canonicalStatuses.includes(normalized.status)).toBe(true);
			expect(normalized.status).not.toBe(progressPhase);
		}
	});

	test("contract/progress/stall/cancellation are additive and task_kind normalizes with contract.kind", async () => {
		const paiDir = createTempPaiDir();
		const originalOpenCodeRoot = process.env.OPENCODE_ROOT;
		process.env.OPENCODE_ROOT = paiDir;

		try {
			const taskTool = createPaiTaskTool({
				client: {
					session: {
						create: async () => ({ data: { id: "child-contract-review" } }),
						promptAsync: async () => ({
							data: { parts: [{ type: "text", text: "ok" }] },
						}),
					},
				},
				$: (() => Promise.resolve(null)) as unknown,
			});

			const launchResult = await taskTool.execute(
				{
					description: "review tenacity contract",
					prompt: "analyze repo",
					subagent_type: "Engineer",
					run_in_background: true,
					task_kind: "Review",
				} as any,
				{
					sessionID: "parent-contract-review",
					directory: "/tmp/workspace",
				} as any,
			);

			const taskId = parseTaskId(launchResult);
			expect(taskId).toBe("bg_child-contract-review");

			const record = await findBackgroundTaskByTaskId({
				taskId,
				nowMs: 1_000,
			});

			expect(record?.status).toBe("running");
			expect((record as any)?.task_kind).toBe("review");
			expect((record as any)?.contract?.kind).toBe("review");
			const cancelPolicy =
				typeof (record as any)?.contract?.cancelPolicy === "string"
					? (record as any).contract.cancelPolicy
					: "";
			expect(CANCEL_POLICIES.has(cancelPolicy)).toBe(true);

			const progressPhase =
				typeof (record as any)?.progress?.phase === "string"
					? (record as any).progress.phase
					: "";
			expect(PROGRESS_PHASES.has(progressPhase)).toBe(true);
			expect((record as any)?.stall?.stage).toBe("healthy");
			expect((record as any)?.cancellation).toBeTruthy();
			expect((record as any)?.progress?.nextExpectedUpdateByMs).toBeTypeOf(
				"number",
			);
			expect((record as any)?.nextExpectedUpdateByMs).toBeUndefined();
			expect((record as any)?.contract?.nextExpectedUpdateByMs).toBeUndefined();
		} finally {
			restoreEnv("OPENCODE_ROOT", originalOpenCodeRoot);
		}
	});

	test("task_kind defaults remain backward-compatible when omitted", async () => {
		const paiDir = createTempPaiDir();
		const originalOpenCodeRoot = process.env.OPENCODE_ROOT;
		process.env.OPENCODE_ROOT = paiDir;

		try {
			const taskTool = createPaiTaskTool({
				client: {
					session: {
						create: async () => ({ data: { id: "child-contract-generic" } }),
						promptAsync: async () => ({
							data: { parts: [{ type: "text", text: "ok" }] },
						}),
					},
				},
				$: (() => Promise.resolve(null)) as unknown,
			});

			const launchResult = await taskTool.execute(
				{
					description: "generic tenacity contract",
					prompt: "analyze",
					subagent_type: "Engineer",
					run_in_background: true,
				} as any,
				{
					sessionID: "parent-contract-generic",
					directory: "/tmp/workspace",
				} as any,
			);

			const taskId = parseTaskId(launchResult);
			const record = await findBackgroundTaskByTaskId({ taskId, nowMs: 2_000 });

			expect((record as any)?.task_kind).toBe("generic");
			expect((record as any)?.contract?.kind).toBe("generic");
		} finally {
			restoreEnv("OPENCODE_ROOT", originalOpenCodeRoot);
		}
	});

	test("minimumTenancyUntilMs derives from execution_started_at_ms", async () => {
		const paiDir = createTempPaiDir();
		const originalOpenCodeRoot = process.env.OPENCODE_ROOT;
		process.env.OPENCODE_ROOT = paiDir;

		try {
			await recordBackgroundTaskLaunch({
				taskId: "bg_tenancy_anchor",
				childSessionId: "child-tenancy-anchor",
				parentSessionId: "parent-tenancy-anchor",
				status: "queued",
				nowMs: 1_000,
				task_kind: "review",
			} as any);

			await recordBackgroundTaskLaunch({
				taskId: "bg_tenancy_anchor",
				childSessionId: "child-tenancy-anchor",
				parentSessionId: "parent-tenancy-anchor",
				status: "running",
				nowMs: 9_000,
				task_kind: "review",
			} as any);

			const record = await findBackgroundTaskByTaskId({
				taskId: "bg_tenancy_anchor",
				nowMs: 9_001,
			});

			const executionStartedAtMs = (record as any)?.execution_started_at_ms;
			const minimumTenancyMs = (record as any)?.contract?.minimumTenancyMs;
			const minimumTenancyUntilMs =
				(record as any)?.cancellation?.minimumTenancyUntilMs;

			expect(executionStartedAtMs).toBe(9_000);
			expect(minimumTenancyMs).toBeTypeOf("number");
			expect(minimumTenancyUntilMs).toBe(
				executionStartedAtMs + minimumTenancyMs,
			);
			expect(minimumTenancyUntilMs).not.toBe(
				(record?.launched_at_ms ?? 0) + minimumTenancyMs,
			);
		} finally {
			restoreEnv("OPENCODE_ROOT", originalOpenCodeRoot);
		}
	});

	test("background_cancel response uses fixed discriminators, canonical reason codes, and review salvage path", async () => {
		const paiDir = createTempPaiDir();
		const originalOpenCodeRoot = process.env.OPENCODE_ROOT;
		process.env.OPENCODE_ROOT = paiDir;

		try {
			const taskId = "bg_cancel_contract_review";
			await recordBackgroundTaskLaunch({
				taskId,
				childSessionId: "child-cancel-contract-review",
				parentSessionId: "parent-cancel-contract-review",
				status: "running",
				nowMs: 10_000,
				task_kind: "review",
			} as any);

			const cancelTool = createPaiBackgroundCancelTool({
				client: {
					session: {
						abort: async () => ({ data: true }),
					},
				},
			});

			const result = (await cancelTool.execute(
				{
					task_id: taskId,
					force: true,
					reason: "explicit user cancel",
				} as any,
				{ directory: "/tmp" } as any,
			)) as unknown;

			expect(isRecord(result)).toBe(true);
			if (!isRecord(result)) {
				return;
			}

			const outcome = typeof result.outcome === "string" ? result.outcome : "";
			expect(CANCELLATION_OUTCOMES.has(outcome)).toBe(true);
			expect(result.task_id).toBe(taskId);

			const reasonCode =
				typeof result.reasonCode === "string" ? result.reasonCode : "";
			expect(CANONICAL_REASON_CODES.has(reasonCode)).toBe(true);

			const salvageStatus =
				typeof result.salvageStatus === "string" ? result.salvageStatus : "";
			expect(SALVAGE_STATUSES.has(salvageStatus)).toBe(true);

			expect(hasOwnField(result, "reasonText")).toBe(true);
			const reasonText =
				typeof result.reasonText === "string" ? result.reasonText : "";
			expect(reasonText.length > 0).toBe(true);

			expect(hasOwnField(result, "stateChanged")).toBe(true);
			expect(typeof result.stateChanged).toBe("boolean");

			if (outcome === "refused") {
				expect(result.stateChanged).toBe(false);
				expect(hasOwnField(result, "forced")).toBe(false);
				expect(hasOwnField(result, "terminalStatus")).toBe(false);
				expect(hasOwnField(result, "salvageArtifactPath")).toBe(false);
			} else {
				expect(result.stateChanged).toBe(true);
				expect(hasOwnField(result, "forced")).toBe(true);
				expect(typeof result.forced).toBe("boolean");

				if (outcome === "accepted_terminal") {
					expect(hasOwnField(result, "terminalStatus")).toBe(true);
					expect(result.terminalStatus).toBe("cancelled");
				} else {
					expect(hasOwnField(result, "terminalStatus")).toBe(false);
				}

				expect(hasOwnField(result, "salvageArtifactPath")).toBe(true);
				const salvageArtifactPath =
					typeof result.salvageArtifactPath === "string"
						? result.salvageArtifactPath
						: "";
				const expectedPathPattern = new RegExp(
					`(?:^|[\\\\/])salvage[\\\\/]${escapeRegex(taskId)}\\.json$`,
				);
				expect(expectedPathPattern.test(salvageArtifactPath)).toBe(true);
			}
		} finally {
			restoreEnv("OPENCODE_ROOT", originalOpenCodeRoot);
		}
	});
});
