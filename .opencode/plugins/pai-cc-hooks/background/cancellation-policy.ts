import fs from "node:fs";
import path from "node:path";

import type {
	BackgroundTaskTerminalReason,
} from "./lifecycle-normalizer";
import { terminalizeBackgroundTask } from "./terminalize";
import type { BackgroundTaskRecord } from "../tools/background-task-state";
import {
	getBackgroundTaskArtifactRootPath,
	markBackgroundTaskCancelled,
	markBackgroundTaskTerminalAtomic,
	updateBackgroundTaskPolicyMetadata,
} from "../tools/background-task-state";
import type {
	BackgroundTaskCancellation,
	BackgroundTaskStall,
	ReasonCode,
	SalvageStatus,
} from "./review-contract";
import { currentEpochMs } from "./clock";

const SYNTHETIC_EPOCH_THRESHOLD_MS = 1_000_000_000_000;

const CANONICAL_REASON_CODES: ReadonlySet<ReasonCode> = new Set([
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

export type BackgroundCancelResult =
	| {
			outcome: "refused";
			task_id: string;
			reasonCode: ReasonCode;
			reasonText: string;
			stateChanged: false;
			salvageStatus: SalvageStatus;
	  }
	| {
			outcome: "accepted_pending_terminalization";
			task_id: string;
			forced: boolean;
			reasonCode: ReasonCode;
			reasonText: string;
			stateChanged: true;
			salvageStatus: SalvageStatus;
			salvageArtifactPath: string;
	  }
	| {
			outcome: "accepted_terminal";
			task_id: string;
			forced: boolean;
			terminalStatus: "cancelled";
			reasonCode: ReasonCode;
			reasonText: string;
			stateChanged: true;
			salvageStatus: SalvageStatus;
			salvageArtifactPath: string;
	  };

export type StallClassificationResult = {
	stage: BackgroundTaskStall["stage"];
	reasonCode?: ReasonCode;
	quietWindowExceeded: boolean;
	deadlineMissed: boolean;
	noProgressSignalChange: boolean;
	effectiveDeadlineMs?: number;
	stall: BackgroundTaskStall;
	changed: boolean;
};

type CancellationSource = "manual" | "stall_monitor";

type ApplyBackgroundCancellationPolicyArgs = {
	taskRecord: BackgroundTaskRecord;
	source: CancellationSource;
	nowMs?: number;
	nowProvider?: () => number;
	force?: boolean;
	reason?: string;
	reasonCode?: ReasonCode;
	shouldTerminalize?: boolean;
	terminalReason?: BackgroundTaskTerminalReason;
	onTaskTerminalized?: (record: BackgroundTaskRecord) => Promise<void>;
	requestTaskCancellation?: (args: {
		taskRecord: BackgroundTaskRecord;
	}) => Promise<void>;
};

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function asOptionalTrimmedString(value: unknown): string | undefined {
	if (typeof value !== "string") {
		return undefined;
	}

	const trimmed = value.trim();
	return trimmed ? trimmed : undefined;
}

function isReasonCode(value: unknown): value is ReasonCode {
	return CANONICAL_REASON_CODES.has(value as ReasonCode);
}

function isReviewTask(taskRecord: BackgroundTaskRecord): boolean {
	return taskRecord.contract?.kind === "review" || taskRecord.task_kind === "review";
}

function getProductiveAnchorMs(taskRecord: BackgroundTaskRecord): number {
	return (
		taskRecord.progress?.lastProductiveAtMs ??
		taskRecord.last_progress_at_ms ??
		taskRecord.execution_started_at_ms ??
		taskRecord.updated_at_ms ??
		taskRecord.launched_at_ms
	);
}

function selectEarlierDeadline(values: Array<number | undefined>): number | undefined {
	let selected: number | undefined;
	for (const value of values) {
		if (!isFiniteNumber(value)) {
			continue;
		}

		if (selected == null || value < selected) {
			selected = value;
		}
	}

	return selected;
}

function areStallEqual(
	left: BackgroundTaskStall | undefined,
	right: BackgroundTaskStall | undefined,
): boolean {
	return (
		left?.stage === right?.stage &&
		left?.suspectedAtMs === right?.suspectedAtMs &&
		left?.confirmedAtMs === right?.confirmedAtMs &&
		left?.reasonCode === right?.reasonCode
	);
}

function normalizeCancellation(
	cancellation: BackgroundTaskCancellation,
): BackgroundTaskCancellation | undefined {
	if (
		cancellation.minimumTenancyUntilMs == null &&
		cancellation.refusalReasonCode == null &&
		cancellation.cancelReasonCode == null &&
		cancellation.cancelReasonText == null &&
		cancellation.salvageAttemptedAtMs == null &&
		cancellation.salvageStatus == null &&
		cancellation.salvageSummary == null &&
		cancellation.salvageArtifactPath == null
	) {
		return undefined;
	}

	return cancellation;
}

export function resolveCancellationNowMs(args: {
	taskRecord: Pick<BackgroundTaskRecord, "launched_at_ms" | "updated_at_ms">;
	nowMs?: number;
	nowProvider?: () => number;
}): number {
	if (isFiniteNumber(args.nowMs)) {
		return args.nowMs;
	}

	const providedNowMs = (args.nowProvider ?? currentEpochMs)();
	const launchedAtMs = args.taskRecord.launched_at_ms;
	if (
		isFiniteNumber(launchedAtMs) &&
		launchedAtMs < SYNTHETIC_EPOCH_THRESHOLD_MS &&
		providedNowMs > SYNTHETIC_EPOCH_THRESHOLD_MS
	) {
		return args.taskRecord.updated_at_ms;
	}

	return providedNowMs;
}

export function buildBackgroundSalvageArtifactPath(taskId: string): string {
	return path.join(
		getBackgroundTaskArtifactRootPath(),
		"salvage",
		`${taskId}.json`,
	);
}

export function classifyBackgroundTaskStall(args: {
	taskRecord: BackgroundTaskRecord;
	nowMs: number;
	staleNoProgressMs?: number;
}): StallClassificationResult {
	const productiveAnchorMs = getProductiveAnchorMs(args.taskRecord);
	const reviewTask = isReviewTask(args.taskRecord);
	const persistedQuietWindowDeadlineMs =
		args.taskRecord.progress?.nextExpectedUpdateByMs;
	const fallbackDeadlineMs =
		isFiniteNumber(args.staleNoProgressMs) && args.staleNoProgressMs > 0
			? productiveAnchorMs + args.staleNoProgressMs
			: undefined;
	const effectiveDeadlineMs = reviewTask
		? persistedQuietWindowDeadlineMs ?? fallbackDeadlineMs
		: selectEarlierDeadline([
				persistedQuietWindowDeadlineMs,
				fallbackDeadlineMs,
			]);
	const quietWindowDeadlineMs = reviewTask
		? persistedQuietWindowDeadlineMs ?? effectiveDeadlineMs
		: effectiveDeadlineMs;
	const quietWindowExceeded =
		quietWindowDeadlineMs != null && args.nowMs > quietWindowDeadlineMs;
	const deadlineMissed =
		effectiveDeadlineMs != null && args.nowMs > effectiveDeadlineMs;

	const suspectedAtMs = args.taskRecord.stall?.suspectedAtMs;
	const productiveSignalMs =
		args.taskRecord.progress?.lastProductiveAtMs ?? productiveAnchorMs;
	const noProgressSignalChange =
		suspectedAtMs == null || productiveSignalMs <= suspectedAtMs;

	const hasStallEvidence =
		quietWindowExceeded && deadlineMissed && noProgressSignalChange;

	let stall: BackgroundTaskStall;
	if (!hasStallEvidence) {
		stall = { stage: "healthy" };
	} else if (
		args.taskRecord.stall?.stage === "suspected_stall" &&
		suspectedAtMs != null &&
		args.nowMs > suspectedAtMs
	) {
		stall = {
			stage: "confirmed_stall",
			suspectedAtMs,
			confirmedAtMs: args.taskRecord.stall.confirmedAtMs ?? args.nowMs,
			reasonCode: "STALL_CONFIRMED",
		};
	} else if (args.taskRecord.stall?.stage === "confirmed_stall") {
		stall = {
			stage: "confirmed_stall",
			suspectedAtMs: suspectedAtMs ?? args.nowMs,
			confirmedAtMs: args.taskRecord.stall.confirmedAtMs ?? args.nowMs,
			reasonCode: "STALL_CONFIRMED",
		};
	} else {
		stall = {
			stage: "suspected_stall",
			suspectedAtMs: suspectedAtMs ?? args.nowMs,
			reasonCode: "STALL_SUSPECTED",
		};
	}

	return {
		stage: stall.stage,
		reasonCode: stall.reasonCode,
		quietWindowExceeded,
		deadlineMissed,
		noProgressSignalChange,
		effectiveDeadlineMs,
		stall,
		changed: !areStallEqual(args.taskRecord.stall, stall),
	};
}

function shouldBlockByMinimumTenancy(args: {
	taskRecord: BackgroundTaskRecord;
	nowMs: number;
	force: boolean;
}): boolean {
	if (args.force) {
		return false;
	}

	const minimumTenancyUntilMs = args.taskRecord.cancellation?.minimumTenancyUntilMs;
	if (!isFiniteNumber(minimumTenancyUntilMs)) {
		return false;
	}

	const requiresForceDuringMinimumTenancy =
		args.taskRecord.contract?.cancellationGuardrails
			?.requiresForceDuringMinimumTenancy === true;
	if (!requiresForceDuringMinimumTenancy) {
		return false;
	}

	return args.nowMs < minimumTenancyUntilMs;
}

function resolveAcceptedReasonCode(args: {
	force: boolean;
	source: CancellationSource;
	reasonCode?: ReasonCode;
}): ReasonCode {
	if (isReasonCode(args.reasonCode)) {
		return args.reasonCode;
	}

	if (args.force) {
		return "USER_FORCE_CANCEL";
	}

	if (args.source === "stall_monitor") {
		return "STALL_CONFIRMED";
	}

	return "USER_CANCEL";
}

function buildReasonText(args: {
	reasonCode: ReasonCode;
	reason?: string;
	minimumTenancyUntilMs?: number;
}): string {
	const customReason = asOptionalTrimmedString(args.reason);
	if (customReason) {
		return customReason;
	}

	switch (args.reasonCode) {
		case "MIN_TENANCY_BLOCK":
			if (isFiniteNumber(args.minimumTenancyUntilMs)) {
				return `Cancellation blocked by minimum tenancy window until ${args.minimumTenancyUntilMs}.`;
			}
			return "Cancellation blocked by minimum tenancy window.";
		case "USER_FORCE_CANCEL":
			return "Cancellation force-requested by user.";
		case "USER_CANCEL":
			return "cancelled";
		case "STALL_SUSPECTED":
			return "Stall suspected: quiet window exceeded without measurable progress.";
		case "STALL_CONFIRMED":
			return "Stall confirmed: quiet window exceeded and deadline missed without measurable progress.";
		case "NO_PRODUCTIVE_PROGRESS":
			return "No productive progress detected within expected window.";
		case "POLICY_BLOCK":
			return "Cancellation blocked by policy.";
		case "CHILD_ERROR":
			return "Cancellation requested due to child task error.";
		default:
			return "Cancellation requested due to internal error.";
	}
}

function shouldAttemptSalvage(taskRecord: BackgroundTaskRecord): boolean {
	if (isReviewTask(taskRecord)) {
		return true;
	}

	if (taskRecord.contract?.salvageOnCancelRequired === true) {
		return true;
	}

	return taskRecord.contract?.cancelPolicy === "salvage-first";
}

async function captureSalvageSnapshot(args: {
	taskRecord: BackgroundTaskRecord;
	nowMs: number;
	reasonCode: ReasonCode;
	reasonText: string;
}): Promise<{
	status: SalvageStatus;
	summary: string;
	artifactPath: string;
}> {
	const artifactPath = buildBackgroundSalvageArtifactPath(args.taskRecord.task_id);
	if (!shouldAttemptSalvage(args.taskRecord)) {
		return {
			status: "not_attempted",
			summary: "Salvage not required by task contract.",
			artifactPath,
		};
	}

	const snapshot = {
		taskId: args.taskRecord.task_id,
		childSessionId: args.taskRecord.child_session_id,
		contractKind: args.taskRecord.contract?.kind ?? args.taskRecord.task_kind ?? "generic",
		lastProgressPhase: args.taskRecord.progress?.phase,
		cancellationReasonCode: args.reasonCode,
		cancellationReasonText: args.reasonText,
		lastKnownProgressTimestamps: {
			lastProductiveAtMs: args.taskRecord.progress?.lastProductiveAtMs,
			nextExpectedUpdateByMs: args.taskRecord.progress?.nextExpectedUpdateByMs,
			lastProgressAtMs: args.taskRecord.last_progress_at_ms,
			updatedAtMs: args.taskRecord.updated_at_ms,
		},
		reviewOutputTailSummary: args.taskRecord.launch_error ?? null,
		capturedAtMs: args.nowMs,
	};

	try {
		await fs.promises.mkdir(path.dirname(artifactPath), { recursive: true });
		await fs.promises.writeFile(
			artifactPath,
			`${JSON.stringify(snapshot, null, 2)}\n`,
			"utf-8",
		);
		return {
			status: "succeeded",
			summary: "Salvage snapshot persisted.",
			artifactPath,
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			status: "failed",
			summary: `Salvage snapshot write failed: ${message}`,
			artifactPath,
		};
	}
}

export async function applyBackgroundCancellationPolicy(
	args: ApplyBackgroundCancellationPolicyArgs,
): Promise<BackgroundCancelResult> {
	const taskId = args.taskRecord.task_id.trim();
	if (!taskId) {
		return {
			outcome: "refused",
			task_id: "",
			reasonCode: "INTERNAL_ERROR",
			reasonText: "Cancellation requires a non-empty task id.",
			stateChanged: false,
			salvageStatus: "not_attempted",
		};
	}

	const force = args.force === true;
	const nowMs = resolveCancellationNowMs({
		taskRecord: args.taskRecord,
		nowMs: args.nowMs,
		nowProvider: args.nowProvider,
	});

	const minimumTenancyUntilMs = args.taskRecord.cancellation?.minimumTenancyUntilMs;
	if (
		shouldBlockByMinimumTenancy({
			taskRecord: args.taskRecord,
			nowMs,
			force,
		})
	) {
		const reasonCode: ReasonCode = "MIN_TENANCY_BLOCK";
		const reasonText = buildReasonText({
			reasonCode,
			minimumTenancyUntilMs,
		});

		const refusalCancellation = normalizeCancellation({
			...(args.taskRecord.cancellation ?? {}),
			minimumTenancyUntilMs,
			refusalReasonCode: reasonCode,
			cancelReasonText: reasonText,
		});
		await updateBackgroundTaskPolicyMetadata({
			taskId,
			cancellation: refusalCancellation,
			nowMs,
		});

		return {
			outcome: "refused",
			task_id: taskId,
			reasonCode,
			reasonText,
			stateChanged: false,
			salvageStatus: "not_attempted",
		};
	}

	const reasonCode = resolveAcceptedReasonCode({
		force,
		source: args.source,
		reasonCode: args.reasonCode,
	});
	const reasonText = buildReasonText({
		reasonCode,
		reason: args.reason,
	});

	const salvage = await captureSalvageSnapshot({
		taskRecord: args.taskRecord,
		nowMs,
		reasonCode,
		reasonText,
	});

	const acceptedCancellation = normalizeCancellation({
		...(args.taskRecord.cancellation ?? {}),
		minimumTenancyUntilMs,
		refusalReasonCode: undefined,
		cancelReasonCode: reasonCode,
		cancelReasonText: reasonText,
		salvageAttemptedAtMs:
			salvage.status === "not_attempted" ? undefined : nowMs,
		salvageStatus: salvage.status,
		salvageSummary: salvage.summary,
		salvageArtifactPath: salvage.artifactPath,
	});

	await updateBackgroundTaskPolicyMetadata({
		taskId,
		cancellation: acceptedCancellation,
		nowMs,
	});

	try {
		await args.requestTaskCancellation?.({ taskRecord: args.taskRecord });
	} catch {
		// Best-effort signal; cancellation state remains authoritative.
	}

	if (args.shouldTerminalize === false) {
		return {
			outcome: "accepted_pending_terminalization",
			task_id: taskId,
			forced: force,
			reasonCode,
			reasonText,
			stateChanged: true,
			salvageStatus: salvage.status,
			salvageArtifactPath: salvage.artifactPath,
		};
	}

	const terminalReason = args.terminalReason ?? "cancelled";
	if (terminalReason === "cancelled") {
		const terminalRecord = await markBackgroundTaskCancelled({
			taskId,
			reason: reasonText,
			nowMs,
		});
		if (terminalRecord) {
			await args.onTaskTerminalized?.(terminalRecord);
			return {
				outcome: "accepted_terminal",
				task_id: taskId,
				forced: force,
				terminalStatus: "cancelled",
				reasonCode,
				reasonText,
				stateChanged: true,
				salvageStatus: salvage.status,
				salvageArtifactPath: salvage.artifactPath,
			};
		}

		return {
			outcome: "accepted_pending_terminalization",
			task_id: taskId,
			forced: force,
			reasonCode,
			reasonText,
			stateChanged: true,
			salvageStatus: salvage.status,
			salvageArtifactPath: salvage.artifactPath,
		};
	}

	await terminalizeBackgroundTask({
		taskId,
		reason: terminalReason,
		nowMs,
		message: reasonText,
		deps: {
			markBackgroundTaskTerminalAtomic,
			onTaskTerminalized: args.onTaskTerminalized,
		},
	});

	return {
		outcome: "accepted_pending_terminalization",
		task_id: taskId,
		forced: force,
		reasonCode,
		reasonText,
		stateChanged: true,
		salvageStatus: salvage.status,
		salvageArtifactPath: salvage.artifactPath,
	};
}
