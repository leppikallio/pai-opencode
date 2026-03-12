import type { BackgroundTaskStatus } from "./lifecycle-normalizer";
import type {
	BackgroundProgressPhase,
	BackgroundTaskProgress,
	ReasonCode,
} from "./review-contract";

const DEFAULT_PROGRESS_PHASE: BackgroundProgressPhase = "started";

export type BackgroundTaskProgressCounterPatch = Partial<
	NonNullable<BackgroundTaskProgress["counters"]>
>;

export type BackgroundTaskProgressHeartbeat = {
	phase?: BackgroundProgressPhase;
	lastProductiveAtMs?: number;
	nextExpectedUpdateByMs?: number;
	blockedReasonCode?: ReasonCode;
	counters?: BackgroundTaskProgressCounterPatch;
	counterIncrements?: BackgroundTaskProgressCounterPatch;
	productive?: boolean;
};

export type ApplyBackgroundTaskProgressHeartbeatResult = {
	progress: BackgroundTaskProgress;
	changed: boolean;
	productiveAtMs?: number;
};

function isExecutionStatus(status: BackgroundTaskStatus): boolean {
	return status === "running" || status === "stable_idle";
}

function asNonNegativeFiniteNumber(value: unknown): number | undefined {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
		return undefined;
	}

	return value;
}

function asNonNegativeInteger(value: unknown): number | undefined {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
		return undefined;
	}

	return Math.floor(value);
}

function hasCounterValues(
	counters: BackgroundTaskProgressCounterPatch | undefined,
): counters is BackgroundTaskProgressCounterPatch {
	if (!counters) {
		return false;
	}

	return (
		counters.tools != null ||
		counters.artifacts != null ||
		counters.checkpoints != null
	);
}

function normalizeCounterPatch(
	value: BackgroundTaskProgressCounterPatch | undefined,
): BackgroundTaskProgressCounterPatch | undefined {
	if (!value) {
		return undefined;
	}

	const normalized: BackgroundTaskProgressCounterPatch = {
		tools: asNonNegativeInteger(value.tools),
		artifacts: asNonNegativeInteger(value.artifacts),
		checkpoints: asNonNegativeInteger(value.checkpoints),
	};

	return hasCounterValues(normalized) ? normalized : undefined;
}

function mergeCounters(args: {
	existing: BackgroundTaskProgressCounterPatch | undefined;
	overwrite: BackgroundTaskProgressCounterPatch | undefined;
	increments: BackgroundTaskProgressCounterPatch | undefined;
}): BackgroundTaskProgressCounterPatch | undefined {
	const existing = normalizeCounterPatch(args.existing);
	const overwrite = normalizeCounterPatch(args.overwrite);
	const increments = normalizeCounterPatch(args.increments);

	const merged: BackgroundTaskProgressCounterPatch = {
		tools: existing?.tools,
		artifacts: existing?.artifacts,
		checkpoints: existing?.checkpoints,
	};

	if (overwrite?.tools != null) {
		merged.tools = Math.max(merged.tools ?? 0, overwrite.tools);
	}
	if (overwrite?.artifacts != null) {
		merged.artifacts = Math.max(merged.artifacts ?? 0, overwrite.artifacts);
	}
	if (overwrite?.checkpoints != null) {
		merged.checkpoints = Math.max(merged.checkpoints ?? 0, overwrite.checkpoints);
	}

	if (increments?.tools != null) {
		merged.tools = (merged.tools ?? 0) + increments.tools;
	}
	if (increments?.artifacts != null) {
		merged.artifacts = (merged.artifacts ?? 0) + increments.artifacts;
	}
	if (increments?.checkpoints != null) {
		merged.checkpoints = (merged.checkpoints ?? 0) + increments.checkpoints;
	}

	return hasCounterValues(merged) ? merged : undefined;
}

function areCountersEqual(
	left: BackgroundTaskProgressCounterPatch | undefined,
	right: BackgroundTaskProgressCounterPatch | undefined,
): boolean {
	return (
		left?.tools === right?.tools &&
		left?.artifacts === right?.artifacts &&
		left?.checkpoints === right?.checkpoints
	);
}

function hasCounterGrowth(args: {
	baseline: BackgroundTaskProgressCounterPatch | undefined;
	next: BackgroundTaskProgressCounterPatch | undefined;
}): boolean {
	const baselineTools = args.baseline?.tools ?? 0;
	const baselineArtifacts = args.baseline?.artifacts ?? 0;
	const baselineCheckpoints = args.baseline?.checkpoints ?? 0;
	const nextTools = args.next?.tools ?? 0;
	const nextArtifacts = args.next?.artifacts ?? 0;
	const nextCheckpoints = args.next?.checkpoints ?? 0;

	return (
		nextTools > baselineTools ||
		nextArtifacts > baselineArtifacts ||
		nextCheckpoints > baselineCheckpoints
	);
}

function areProgressEqual(
	left: BackgroundTaskProgress,
	right: BackgroundTaskProgress,
): boolean {
	return (
		left.phase === right.phase &&
		left.lastProductiveAtMs === right.lastProductiveAtMs &&
		left.nextExpectedUpdateByMs === right.nextExpectedUpdateByMs &&
		left.blockedReasonCode === right.blockedReasonCode &&
		areCountersEqual(left.counters, right.counters)
	);
}

function normalizeProgress(progress: BackgroundTaskProgress): BackgroundTaskProgress {
	return {
		phase: progress.phase,
		lastProductiveAtMs: asNonNegativeFiniteNumber(progress.lastProductiveAtMs),
		nextExpectedUpdateByMs: asNonNegativeFiniteNumber(
			progress.nextExpectedUpdateByMs,
		),
		counters: normalizeCounterPatch(progress.counters),
		blockedReasonCode:
			progress.phase === "blocked" ? progress.blockedReasonCode : undefined,
	};
}

function hasHeartbeatPayload(
	heartbeat: BackgroundTaskProgressHeartbeat | undefined,
): boolean {
	if (!heartbeat) {
		return false;
	}

	return (
		heartbeat.phase != null ||
		heartbeat.lastProductiveAtMs != null ||
		heartbeat.nextExpectedUpdateByMs != null ||
		heartbeat.blockedReasonCode != null ||
		heartbeat.counters != null ||
		heartbeat.counterIncrements != null ||
		typeof heartbeat.productive === "boolean"
	);
}

export function buildLaunchProgressBaseline(args: {
	existing?: BackgroundTaskProgress;
	nextStatus: BackgroundTaskStatus;
	nowMs: number;
	quietWindowMs: number;
	isTerminalReactivation: boolean;
}): BackgroundTaskProgress {
	const existingProgress = args.isTerminalReactivation
		? undefined
		: args.existing;
	const lastProductiveAtMs = isExecutionStatus(args.nextStatus)
		? args.nowMs
		: undefined;
	const candidateNextExpectedUpdateByMs =
		lastProductiveAtMs == null
			? undefined
			: lastProductiveAtMs + Math.max(0, args.quietWindowMs);

	return normalizeProgress({
		phase: existingProgress?.phase ?? DEFAULT_PROGRESS_PHASE,
		lastProductiveAtMs,
		nextExpectedUpdateByMs:
			candidateNextExpectedUpdateByMs == null
				? undefined
				: existingProgress?.nextExpectedUpdateByMs == null
					? candidateNextExpectedUpdateByMs
					: Math.max(
							existingProgress.nextExpectedUpdateByMs,
							candidateNextExpectedUpdateByMs,
						),
		counters: existingProgress?.counters,
		blockedReasonCode: existingProgress?.blockedReasonCode,
	});
}

export function applyBackgroundTaskProgressHeartbeat(args: {
	existing?: BackgroundTaskProgress;
	heartbeat?: BackgroundTaskProgressHeartbeat;
	nowMs: number;
	quietWindowMs: number;
}): ApplyBackgroundTaskProgressHeartbeatResult {
	const baseline = normalizeProgress(
		args.existing ?? {
			phase: DEFAULT_PROGRESS_PHASE,
		},
	);

	if (!hasHeartbeatPayload(args.heartbeat)) {
		return {
			progress: baseline,
			changed: args.existing == null,
		};
	}

	const heartbeat = args.heartbeat ?? {};
	const nextPhase = heartbeat.phase ?? baseline.phase;
	const hasPhaseTransition =
		heartbeat.phase != null && heartbeat.phase !== baseline.phase;
	const hasNonBlockedPhaseTransition =
		hasPhaseTransition && nextPhase !== "blocked";
	const hasBlockedPhaseEntry = hasPhaseTransition && nextPhase === "blocked";

	const counters = mergeCounters({
		existing: baseline.counters,
		overwrite: heartbeat.counters,
		increments: heartbeat.counterIncrements,
	});
	const hasCounterProgressSignal = hasCounterGrowth({
		baseline: baseline.counters,
		next: counters,
	});

	const explicitLastProductiveAtMs = asNonNegativeFiniteNumber(
		heartbeat.lastProductiveAtMs,
	);
	const hasMeasurableProductiveSignal =
		explicitLastProductiveAtMs != null ||
		hasNonBlockedPhaseTransition ||
		hasCounterProgressSignal;

	const productiveCandidateAtMs =
		explicitLastProductiveAtMs ??
		(heartbeat.productive === true && hasMeasurableProductiveSignal
			? args.nowMs
			: undefined);
	const nextLastProductiveAtMs =
		productiveCandidateAtMs == null
			? baseline.lastProductiveAtMs
			: baseline.lastProductiveAtMs == null
				? productiveCandidateAtMs
				: Math.max(baseline.lastProductiveAtMs, productiveCandidateAtMs);

	const explicitNextExpectedUpdateByMs = asNonNegativeFiniteNumber(
		heartbeat.nextExpectedUpdateByMs,
	);
	const hasMeasurableHeartbeatSignal =
		hasMeasurableProductiveSignal ||
		hasBlockedPhaseEntry ||
		(nextPhase === "blocked" && heartbeat.blockedReasonCode != null);
	const acceptedExplicitNextExpectedUpdateByMs =
		explicitNextExpectedUpdateByMs != null && hasMeasurableHeartbeatSignal
			? explicitNextExpectedUpdateByMs
			: undefined;
	const candidateNextExpectedUpdateByMs =
		acceptedExplicitNextExpectedUpdateByMs ??
		(productiveCandidateAtMs == null || nextLastProductiveAtMs == null
			? undefined
			: nextLastProductiveAtMs + Math.max(0, args.quietWindowMs));
	const nextExpectedUpdateByMs =
		candidateNextExpectedUpdateByMs == null
			? baseline.nextExpectedUpdateByMs
			: baseline.nextExpectedUpdateByMs == null
				? candidateNextExpectedUpdateByMs
				: Math.max(
						baseline.nextExpectedUpdateByMs,
						candidateNextExpectedUpdateByMs,
					);

	const blockedReasonCode =
		nextPhase === "blocked"
			? heartbeat.blockedReasonCode ?? baseline.blockedReasonCode
			: undefined;

	const progress = normalizeProgress({
		phase: nextPhase,
		lastProductiveAtMs: nextLastProductiveAtMs,
		nextExpectedUpdateByMs,
		counters,
		blockedReasonCode,
	});

	const changed = !areProgressEqual(baseline, progress);
	const productiveAtMs =
		changed && progress.lastProductiveAtMs !== baseline.lastProductiveAtMs
			? progress.lastProductiveAtMs
			: undefined;

	return {
		progress,
		changed,
		productiveAtMs,
	};
}
