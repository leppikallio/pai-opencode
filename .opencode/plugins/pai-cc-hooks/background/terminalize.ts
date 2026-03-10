import type { BackgroundTaskTerminalReason } from "./lifecycle-normalizer";
import type { BackgroundTaskRecord } from "../tools/background-task-state";

const DEFAULT_MINIMUM_RUNTIME_MS = 1_500;
const DEFAULT_STABLE_IDLE_OBSERVATION_MS = 1_200;
const DEFAULT_STALE_NO_PROGRESS_MS = 90_000;

function asPositiveInteger(value: string | undefined): number | undefined {
	if (typeof value !== "string") {
		return undefined;
	}

	const numeric = Number.parseInt(value.trim(), 10);
	if (!Number.isFinite(numeric) || numeric < 0) {
		return undefined;
	}

	return Math.floor(numeric);
}

function clampMs(value: number, minimum: number, maximum: number): number {
	return Math.max(minimum, Math.min(value, maximum));
}

export type StableCompletionPolicy = {
	minimumRuntimeMs: number;
	stableIdleObservationMs: number;
	staleNoProgressMs: number;
};

export function resolveStableCompletionPolicy(
	env: Readonly<Record<string, string | undefined>> = process.env,
): StableCompletionPolicy {
	const minimumRuntimeMs = clampMs(
		asPositiveInteger(env.PAI_BACKGROUND_COMPLETION_MIN_RUNTIME_MS) ??
			DEFAULT_MINIMUM_RUNTIME_MS,
		0,
		10 * 60 * 1_000,
	);
	const stableIdleObservationMs = clampMs(
		asPositiveInteger(env.PAI_BACKGROUND_COMPLETION_STABLE_IDLE_MS) ??
			DEFAULT_STABLE_IDLE_OBSERVATION_MS,
		0,
		10 * 60 * 1_000,
	);
	const staleNoProgressMs = clampMs(
		asPositiveInteger(env.PAI_BACKGROUND_COMPLETION_STALE_MS) ??
			DEFAULT_STALE_NO_PROGRESS_MS,
		1_000,
		60 * 60 * 1_000,
	);

	return {
		minimumRuntimeMs,
		stableIdleObservationMs,
		staleNoProgressMs,
	};
}

export function getTaskRuntimeMs(args: {
	taskRecord: Pick<BackgroundTaskRecord, "launched_at_ms">;
	nowMs: number;
}): number {
	return Math.max(0, args.nowMs - args.taskRecord.launched_at_ms);
}

export function getTaskLastProgressAtMs(
	taskRecord: Pick<
		BackgroundTaskRecord,
		"last_progress_at_ms" | "updated_at_ms" | "launched_at_ms"
	>,
): number {
	return (
		taskRecord.last_progress_at_ms ??
		taskRecord.updated_at_ms ??
		taskRecord.launched_at_ms
	);
}

export function hasStableIdleCompletionConfidence(args: {
	taskRecord: Pick<BackgroundTaskRecord, "launched_at_ms" | "idle_seen_at_ms">;
	nowMs: number;
	policy: Pick<StableCompletionPolicy, "minimumRuntimeMs" | "stableIdleObservationMs">;
}): boolean {
	const runtimeMs = getTaskRuntimeMs({
		taskRecord: args.taskRecord,
		nowMs: args.nowMs,
	});
	if (runtimeMs < args.policy.minimumRuntimeMs) {
		return false;
	}

	const idleSeenAtMs = args.taskRecord.idle_seen_at_ms;
	if (idleSeenAtMs == null) {
		return false;
	}

	const observedIdleMs = Math.max(0, args.nowMs - idleSeenAtMs);
	return observedIdleMs >= args.policy.stableIdleObservationMs;
}

export type BackgroundTerminalizeDeps = {
	markBackgroundTaskTerminalAtomic: (args: {
		taskId: string;
		reason: BackgroundTaskTerminalReason;
		message?: string;
		nowMs?: number;
	}) => Promise<BackgroundTaskRecord | null>;
	onTaskTerminalized?: (record: BackgroundTaskRecord) => Promise<void>;
};

export async function terminalizeBackgroundTask(args: {
	taskId: string;
	reason: BackgroundTaskTerminalReason;
	nowMs?: number;
	message?: string;
	deps: BackgroundTerminalizeDeps;
}): Promise<BackgroundTaskRecord | null> {
	const taskId = args.taskId.trim();
	if (!taskId) {
		return null;
	}

	const terminalRecord = await args.deps.markBackgroundTaskTerminalAtomic({
		taskId,
		reason: args.reason,
		message: args.message,
		nowMs: args.nowMs,
	});
	if (!terminalRecord) {
		return null;
	}

	await args.deps.onTaskTerminalized?.(terminalRecord);
	return terminalRecord;
}
