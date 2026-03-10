import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
	BackgroundConcurrencyCancelledError,
	BackgroundConcurrencyManager,
	BackgroundConcurrencySaturationError,
	deriveBackgroundConcurrencyGroup,
	resolveBackgroundConcurrencyManagerConfig,
} from "../../plugins/pai-cc-hooks/background/concurrency";
import { findBackgroundTaskByTaskId } from "../../plugins/pai-cc-hooks/tools/background-task-state";
import { createPaiTaskTool } from "../../plugins/pai-cc-hooks/tools/task";

function createTempPaiDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "pai-bg-concurrency-"));
}

function parseTaskId(result: string): string {
	const match = result.match(/Task ID:\s*(\S+)/);
	return match?.[1] ?? "";
}

function createDeferred<T>(): {
	promise: Promise<T>;
	resolve: (value: T) => void;
	reject: (reason?: unknown) => void;
} {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

async function waitFor(
	predicate: () => boolean,
	timeoutMs = 750,
): Promise<boolean> {
	const started = Date.now();
	while (Date.now() - started < timeoutMs) {
		if (predicate()) {
			return true;
		}
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	return false;
}

describe("background concurrency manager", () => {
	test("acquire/release is FIFO and rejects double-release", async () => {
		const manager = new BackgroundConcurrencyManager({
			defaultLimit: 1,
			maxQueuePerGroup: 4,
		});

		const lease1 = await manager.acquire({ group: "agent:engineer", taskId: "t1" });
		let lease2Granted = false;
		const lease2Promise = manager
			.acquire({ group: "agent:engineer", taskId: "t2" })
			.then((lease) => {
				lease2Granted = true;
				return lease;
			});

		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(lease2Granted).toBe(false);
		expect(manager.getSnapshot("agent:engineer")[0]).toMatchObject({
			active: 1,
			queued: 1,
			limit: 1,
		});

		expect(lease1.release()).toBe(true);
		const lease2 = await lease2Promise;
		expect(lease2Granted).toBe(true);
		expect(lease1.release()).toBe(false);
		expect(lease2.release()).toBe(true);
	});

	test("waiters are cancellation-safe and saturation is explicit", async () => {
		const manager = new BackgroundConcurrencyManager({
			defaultLimit: 1,
			maxQueuePerGroup: 1,
		});

		const lease1 = await manager.acquire({ group: "agent:qa", taskId: "active" });
		const abortController = new AbortController();
		const cancelledPromise = manager.acquire({
			group: "agent:qa",
			taskId: "queued-cancelled",
			signal: abortController.signal,
		});
		abortController.abort();

		await expect(cancelledPromise).rejects.toBeInstanceOf(
			BackgroundConcurrencyCancelledError,
		);

		const queuedPromise = manager.acquire({
			group: "agent:qa",
			taskId: "queued",
		});
		await expect(
			manager.acquire({ group: "agent:qa", taskId: "overflow" }),
		).rejects.toBeInstanceOf(BackgroundConcurrencySaturationError);

		expect(manager.cancelPendingTask("queued", "agent:qa")).toBe(true);
		await expect(queuedPromise).rejects.toBeInstanceOf(
			BackgroundConcurrencyCancelledError,
		);

		expect(lease1.release()).toBe(true);
		expect(manager.getSnapshot("agent:qa")[0]).toMatchObject({
			active: 0,
			queued: 0,
		});
	});

	test("config surface resolves defaults and env overrides", () => {
		const config = resolveBackgroundConcurrencyManagerConfig({
			PAI_BACKGROUND_CONCURRENCY_LIMIT_DEFAULT: "3",
			PAI_BACKGROUND_CONCURRENCY_MAX_QUEUE: "9",
			PAI_BACKGROUND_CONCURRENCY_LIMIT_OVERRIDES:
				"model:openai/gpt-5=2,agent:engineer=1",
			PAI_BACKGROUND_CONCURRENCY_DEBUG: "1",
		});

		expect(config.defaultLimit).toBe(3);
		expect(config.maxQueuePerGroup).toBe(9);
		expect(config.groupLimitOverrides["model:openai/gpt-5"]).toBe(2);
		expect(config.groupLimitOverrides["agent:engineer"]).toBe(1);
		expect(config.debug).toBe(true);
		expect(
			deriveBackgroundConcurrencyGroup({
				providerId: "openai",
				modelId: "gpt-5.3-codex",
				subagentType: "Engineer",
			}),
		).toBe("model:openai/gpt-5.3-codex");
	});
});

describe("task tool concurrency feature flag", () => {
	test("flag OFF keeps ungated launch behavior while persisting group metadata", async () => {
		const paiDir = createTempPaiDir();
		const originalOpenCodeRoot = process.env.OPENCODE_ROOT;
		const originalConcurrencyFlag =
			process.env.PAI_ORCHESTRATION_CONCURRENCY_ENABLED;

		process.env.OPENCODE_ROOT = paiDir;
		process.env.PAI_ORCHESTRATION_CONCURRENCY_ENABLED = "0";

		const manager = new BackgroundConcurrencyManager({
			defaultLimit: 1,
			maxQueuePerGroup: 10,
		});

		const firstPrompt = createDeferred<{ data: { parts: Array<{ type: "text"; text: string }> } }>();
		let createIdx = 0;
		const promptCalls: string[] = [];

		try {
			const taskTool = createPaiTaskTool({
				client: {
					session: {
						create: async () => {
							createIdx += 1;
							return { data: { id: `child-off-${createIdx}` } };
						},
						prompt: async (payload: unknown) => {
							const sessionId =
								typeof payload === "object" &&
								payload !== null &&
								"path" in payload &&
								typeof (payload as { path?: { id?: unknown } }).path?.id ===
									"string"
									? ((payload as { path: { id: string } }).path.id as string)
									: "";
							if (sessionId) {
								promptCalls.push(sessionId);
							}
							if (sessionId === "child-off-1") {
								return firstPrompt.promise;
							}
							return { data: { parts: [{ type: "text", text: "ok" }] } };
						},
					},
				},
				$: (() => Promise.resolve(null)) as unknown,
				backgroundConcurrencyManager: manager,
			});

			const firstResult = await taskTool.execute(
				{
					description: "flag-off one",
					prompt: "do one",
					subagent_type: "Engineer",
					run_in_background: true,
				},
				{ sessionID: "parent-off", directory: "/tmp" } as any,
			);
			const secondResult = await taskTool.execute(
				{
					description: "flag-off two",
					prompt: "do two",
					subagent_type: "Engineer",
					run_in_background: true,
				},
				{ sessionID: "parent-off", directory: "/tmp" } as any,
			);

			const bothPrompted = await waitFor(() => promptCalls.length >= 2);
			expect(bothPrompted).toBe(true);

			const firstTaskId = parseTaskId(firstResult);
			const secondTaskId = parseTaskId(secondResult);
			expect(firstTaskId).toBe("bg_child-off-1");
			expect(secondTaskId).toBe("bg_child-off-2");

			const firstRecord = await findBackgroundTaskByTaskId({ taskId: firstTaskId });
			const secondRecord = await findBackgroundTaskByTaskId({ taskId: secondTaskId });
			expect(firstRecord?.status).toBe("running");
			expect(secondRecord?.status).toBe("running");
			expect(firstRecord?.concurrency_group).toBe("agent:engineer");
			expect(secondRecord?.concurrency_group).toBe("agent:engineer");

			firstPrompt.resolve({ data: { parts: [{ type: "text", text: "done" }] } });
		} finally {
			if (originalOpenCodeRoot === undefined) {
				delete process.env.OPENCODE_ROOT;
			} else {
				process.env.OPENCODE_ROOT = originalOpenCodeRoot;
			}

			if (originalConcurrencyFlag === undefined) {
				delete process.env.PAI_ORCHESTRATION_CONCURRENCY_ENABLED;
			} else {
				process.env.PAI_ORCHESTRATION_CONCURRENCY_ENABLED =
					originalConcurrencyFlag;
			}
		}
	});

	test("flag ON enforces per-group queueing and advances queued task after release", async () => {
		const paiDir = createTempPaiDir();
		const originalOpenCodeRoot = process.env.OPENCODE_ROOT;
		const originalConcurrencyFlag =
			process.env.PAI_ORCHESTRATION_CONCURRENCY_ENABLED;

		process.env.OPENCODE_ROOT = paiDir;
		process.env.PAI_ORCHESTRATION_CONCURRENCY_ENABLED = "1";

		const manager = new BackgroundConcurrencyManager({
			defaultLimit: 1,
			maxQueuePerGroup: 10,
		});

		const firstPrompt = createDeferred<{ data: { parts: Array<{ type: "text"; text: string }> } }>();
		let createIdx = 0;
		const promptCalls: string[] = [];

		try {
			const taskTool = createPaiTaskTool({
				client: {
					session: {
						create: async () => {
							createIdx += 1;
							return { data: { id: `child-on-${createIdx}` } };
						},
						prompt: async (payload: unknown) => {
							const sessionId =
								typeof payload === "object" &&
								payload !== null &&
								"path" in payload &&
								typeof (payload as { path?: { id?: unknown } }).path?.id ===
									"string"
									? ((payload as { path: { id: string } }).path.id as string)
									: "";
							if (sessionId) {
								promptCalls.push(sessionId);
							}
							if (sessionId === "child-on-1") {
								return firstPrompt.promise;
							}
							return { data: { parts: [{ type: "text", text: "ok" }] } };
						},
					},
				},
				$: (() => Promise.resolve(null)) as unknown,
				backgroundConcurrencyManager: manager,
			});

			const firstResult = await taskTool.execute(
				{
					description: "flag-on one",
					prompt: "do one",
					subagent_type: "Engineer",
					run_in_background: true,
				},
				{ sessionID: "parent-on", directory: "/tmp" } as any,
			);
			const secondResult = await taskTool.execute(
				{
					description: "flag-on two",
					prompt: "do two",
					subagent_type: "Engineer",
					run_in_background: true,
				},
				{ sessionID: "parent-on", directory: "/tmp" } as any,
			);

			await new Promise((resolve) => setTimeout(resolve, 40));
			expect(promptCalls).toEqual(["child-on-1"]);

			const firstTaskId = parseTaskId(firstResult);
			const secondTaskId = parseTaskId(secondResult);
			expect(firstTaskId).toBe("bg_child-on-1");
			expect(secondTaskId).toBe("bg_child-on-2");

			const secondBeforeRelease = await findBackgroundTaskByTaskId({
				taskId: secondTaskId,
			});
			expect(secondBeforeRelease?.status).toBe("queued");

			firstPrompt.resolve({ data: { parts: [{ type: "text", text: "done" }] } });
			const secondPrompted = await waitFor(() =>
				promptCalls.includes("child-on-2"),
			);
			expect(secondPrompted).toBe(true);

			const secondAfterRelease = await findBackgroundTaskByTaskId({
				taskId: secondTaskId,
			});
			expect(secondAfterRelease?.status).toBe("running");

			const firstAfterRelease = await findBackgroundTaskByTaskId({
				taskId: firstTaskId,
			});
			expect(firstAfterRelease?.concurrency_group).toBe("agent:engineer");
			expect(secondAfterRelease?.concurrency_group).toBe("agent:engineer");
		} finally {
			if (originalOpenCodeRoot === undefined) {
				delete process.env.OPENCODE_ROOT;
			} else {
				process.env.OPENCODE_ROOT = originalOpenCodeRoot;
			}

			if (originalConcurrencyFlag === undefined) {
				delete process.env.PAI_ORCHESTRATION_CONCURRENCY_ENABLED;
			} else {
				process.env.PAI_ORCHESTRATION_CONCURRENCY_ENABLED =
					originalConcurrencyFlag;
			}
		}
	});
});
