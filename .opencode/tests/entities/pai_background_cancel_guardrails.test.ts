import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createPaiBackgroundCancelTool } from "../../plugins/pai-cc-hooks/tools/background-cancel";
import {
	findBackgroundTaskByTaskId,
	recordBackgroundTaskLaunch,
} from "../../plugins/pai-cc-hooks/tools/background-task-state";

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

const SILENCE_ONLY_FORBIDDEN_REASON_CODES = new Set([
	"STALL_SUSPECTED",
	"STALL_CONFIRMED",
	"NO_PRODUCTIVE_PROGRESS",
]);

const ACCEPTED_CANCEL_OUTCOMES = new Set([
	"accepted_pending_terminalization",
	"accepted_terminal",
]);

function createTempPaiDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "pai-bg-cancel-guardrails-"));
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

describe("background cancel guardrails contract (Task 1 RED)", () => {
	test("background_cancel schema includes force + reason controls", () => {
		const toolDef = createPaiBackgroundCancelTool({ client: {} });
		expect(toolDef.args).toHaveProperty("task_id");
		expect(toolDef.args).toHaveProperty("force");
		expect(toolDef.args).toHaveProperty("reason");
		expect((toolDef.args as any).force.safeParse(true).success).toBe(true);
		expect((toolDef.args as any).force.safeParse(false).success).toBe(true);
		expect((toolDef.args as any).force.safeParse("true").success).toBe(false);
		expect((toolDef.args as any).reason.safeParse("user requested cancel").success).toBe(
			true,
		);
		expect((toolDef.args as any).reason.safeParse(42).success).toBe(false);
	});

	test("minimum tenancy blocks non-forced cancel with deterministic refusal shape", async () => {
		const paiDir = createTempPaiDir();
		const previousOpenCodeRoot = process.env.OPENCODE_ROOT;
		process.env.OPENCODE_ROOT = paiDir;

		const abortCalls: unknown[] = [];
		try {
			await recordBackgroundTaskLaunch({
				taskId: "bg_cancel_refusal",
				childSessionId: "child-cancel-refusal",
				parentSessionId: "parent-cancel-refusal",
				status: "running",
				nowMs: 5_000,
				task_kind: "review",
			} as any);

			const toolDef = createPaiBackgroundCancelTool({
				client: {
					session: {
						abort: async (payload: unknown) => {
							abortCalls.push(payload);
							return { data: true };
						},
					},
				},
			});

			const first = await toolDef.execute(
				{
					task_id: "bg_cancel_refusal",
					reason: "user asked too early",
				} as any,
				{ directory: "/tmp" } as any,
			);
			const second = await toolDef.execute(
				{
					task_id: "bg_cancel_refusal",
					reason: "user asked too early",
				} as any,
				{ directory: "/tmp" } as any,
			);

			const firstRecord = asRecord(first);
			const secondRecord = asRecord(second);
			expect(firstRecord).not.toBeNull();
			expect(secondRecord).not.toBeNull();
			if (!firstRecord || !secondRecord) {
				return;
			}

			expect(firstRecord.outcome).toBe("refused");
			expect(firstRecord.task_id).toBe("bg_cancel_refusal");
			expect(firstRecord.reasonCode).toBe("MIN_TENANCY_BLOCK");
			expect(firstRecord.reasonText).toBe(secondRecord.reasonText);
			expect(firstRecord.stateChanged).toBe(false);
			expect(firstRecord.salvageStatus).toBe("not_attempted");
		expect(abortCalls).toHaveLength(0);
	} finally {
		restoreEnv("OPENCODE_ROOT", previousOpenCodeRoot);
	}
	});

	test("silence-only evidence cannot classify stall codes or return accepted cancel outcome", async () => {
		const paiDir = createTempPaiDir();
		const previousOpenCodeRoot = process.env.OPENCODE_ROOT;
		process.env.OPENCODE_ROOT = paiDir;

		const abortCalls: unknown[] = [];
		try {
			await recordBackgroundTaskLaunch({
				taskId: "bg_cancel_silence_only",
				childSessionId: "child-cancel-silence-only",
				parentSessionId: "parent-cancel-silence-only",
				status: "running",
				nowMs: 25_000,
				task_kind: "review",
			} as any);

			const toolDef = createPaiBackgroundCancelTool({
				client: {
					session: {
						abort: async (payload: unknown) => {
							abortCalls.push(payload);
							return { data: true };
						},
					},
				},
			});

			const result = await toolDef.execute(
				{
					task_id: "bg_cancel_silence_only",
					reason: "no output observed yet",
				} as any,
				{ directory: "/tmp" } as any,
			);

			const shaped = asRecord(result);
			expect(shaped).not.toBeNull();
			if (!shaped) {
				return;
			}

			expect(shaped.task_id).toBe("bg_cancel_silence_only");
			expect(shaped.outcome).toBe("refused");
			expect(ACCEPTED_CANCEL_OUTCOMES.has(String(shaped.outcome))).toBe(false);
			expect(
				SILENCE_ONLY_FORBIDDEN_REASON_CODES.has(String(shaped.reasonCode)),
			).toBe(false);
			expect(shaped.stateChanged).toBe(false);
			expect(shaped.salvageStatus).toBe("not_attempted");
			expect(abortCalls).toHaveLength(0);
		} finally {
			restoreEnv("OPENCODE_ROOT", previousOpenCodeRoot);
		}
	});

	test("forced review cancel requires structured result and salvage artifact path", async () => {
		const paiDir = createTempPaiDir();
		const previousOpenCodeRoot = process.env.OPENCODE_ROOT;
		process.env.OPENCODE_ROOT = paiDir;

		try {
			await recordBackgroundTaskLaunch({
				taskId: "bg_cancel_forced_review",
				childSessionId: "child-cancel-forced-review",
				parentSessionId: "parent-cancel-forced-review",
				status: "running",
				nowMs: 9_000,
				task_kind: "review",
			} as any);

			const toolDef = createPaiBackgroundCancelTool({
				client: {
					session: {
						abort: async () => ({ data: true }),
					},
				},
			});

			const result = await toolDef.execute(
				{
					task_id: "bg_cancel_forced_review",
					force: true,
					reason: "explicit user force cancel",
				} as any,
				{ directory: "/tmp" } as any,
			);

			const shaped = asRecord(result);
			expect(shaped).not.toBeNull();
			if (!shaped) {
				return;
			}

			expect([
				"accepted_pending_terminalization",
				"accepted_terminal",
			]).toContain(String(shaped.outcome));
			expect(shaped.forced).toBe(true);
			expect(shaped.reasonCode).toBe("USER_FORCE_CANCEL");
			expect(CANONICAL_REASON_CODES.has(String(shaped.reasonCode))).toBe(true);
			expect(typeof shaped.reasonText).toBe("string");
			expect(String(shaped.reasonText).length > 0).toBe(true);
			expect(typeof shaped.salvageArtifactPath).toBe("string");
			expect(String(shaped.salvageArtifactPath)).toMatch(
				/(?:^|[\\/])salvage[\\/]bg_cancel_forced_review\.json$/,
			);

			const persisted = await findBackgroundTaskByTaskId({
				taskId: "bg_cancel_forced_review",
				nowMs: 9_100,
			});
			expect((persisted as any)?.cancellation?.cancelReasonCode).toBe(
				"USER_FORCE_CANCEL",
			);
			expect((persisted as any)?.cancellation?.salvageArtifactPath).toBeTypeOf(
				"string",
			);
		} finally {
			restoreEnv("OPENCODE_ROOT", previousOpenCodeRoot);
		}
	});
});
