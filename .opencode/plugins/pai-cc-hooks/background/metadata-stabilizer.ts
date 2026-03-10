import type { BackgroundTaskRecord } from "../tools/background-task-state";

const DEFAULT_MAX_WAIT_MS = 1_200;
const DEFAULT_POLL_INTERVAL_MS = 80;

function clampMs(value: number, minimum: number, maximum: number): number {
	return Math.max(minimum, Math.min(value, maximum));
}

function defaultSleep(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

export type BackgroundMetadataStabilizerTimeout = {
	status: "timeout";
	childSessionId: string;
	attempts: number;
	waitedMs: number;
	maxWaitMs: number;
};

export type BackgroundMetadataStabilizerReady = {
	status: "ready";
	taskRecord: BackgroundTaskRecord;
	childSessionId: string;
	attempts: number;
	waitedMs: number;
	maxWaitMs: number;
};

export type BackgroundMetadataStabilizerResult =
	| BackgroundMetadataStabilizerReady
	| BackgroundMetadataStabilizerTimeout;

export type BackgroundMetadataStabilizerDeps = {
	findBackgroundTaskByChildSessionId: (args: {
		childSessionId: string;
		nowMs?: number;
	}) => Promise<BackgroundTaskRecord | null>;
	nowMs?: () => number;
	sleep?: (ms: number) => Promise<void>;
	maxWaitMs?: number;
	pollIntervalMs?: number;
	onTimeout?: (result: BackgroundMetadataStabilizerTimeout) => void | Promise<void>;
};

export async function stabilizeBackgroundTaskMetadata(args: {
	childSessionId: string;
	deps: BackgroundMetadataStabilizerDeps;
}): Promise<BackgroundMetadataStabilizerResult> {
	const childSessionId = args.childSessionId.trim();
	if (!childSessionId) {
		return {
			status: "timeout",
			childSessionId,
			attempts: 0,
			waitedMs: 0,
			maxWaitMs: 0,
		};
	}

	const nowMs = args.deps.nowMs ?? (() => Date.now());
	const sleep = args.deps.sleep ?? defaultSleep;
	const maxWaitMs = clampMs(args.deps.maxWaitMs ?? DEFAULT_MAX_WAIT_MS, 0, 10_000);
	const pollIntervalMs = clampMs(
		args.deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
		10,
		1_000,
	);

	const startedAtMs = nowMs();
	let attempts = 0;

	while (true) {
		attempts += 1;
		const taskRecord = await args.deps.findBackgroundTaskByChildSessionId({
			childSessionId,
			nowMs: nowMs(),
		});

		const waitedMs = Math.max(0, nowMs() - startedAtMs);
		if (taskRecord) {
			return {
				status: "ready",
				taskRecord,
				childSessionId,
				attempts,
				waitedMs,
				maxWaitMs,
			};
		}

		if (waitedMs >= maxWaitMs) {
			const timeoutResult: BackgroundMetadataStabilizerTimeout = {
				status: "timeout",
				childSessionId,
				attempts,
				waitedMs,
				maxWaitMs,
			};
			await args.deps.onTimeout?.(timeoutResult);
			return timeoutResult;
		}

		const remainingMs = Math.max(0, maxWaitMs - waitedMs);
		const sleepMs = Math.min(pollIntervalMs, remainingMs);
		if (sleepMs <= 0) {
			continue;
		}
		await sleep(sleepMs);
	}
}
