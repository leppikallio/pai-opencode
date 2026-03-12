export const BACKGROUND_TASK_KIND_VALUES = ["review", "generic"] as const;

export type BackgroundTaskKind = (typeof BACKGROUND_TASK_KIND_VALUES)[number];

export type BackgroundTaskCancelPolicy = "salvage-first" | "hard-cancel-ok";

export type BackgroundTaskCancellationGuardrails = {
	requiresForceDuringMinimumTenancy: boolean;
	silenceAloneDoesNotJustifyCancel: boolean;
};

export type BackgroundTaskLaunchContract = {
	kind: BackgroundTaskKind;
	expectedQuietWindowMs: number;
	minimumTenancyMs: number;
	expectedDeliverable?: string;
	cancelPolicy: BackgroundTaskCancelPolicy;
	cancellationGuardrails: BackgroundTaskCancellationGuardrails;
	salvageOnCancelRequired: boolean;
};

export type ReasonCode =
	| "MIN_TENANCY_BLOCK"
	| "POLICY_BLOCK"
	| "USER_CANCEL"
	| "USER_FORCE_CANCEL"
	| "STALL_SUSPECTED"
	| "STALL_CONFIRMED"
	| "NO_PRODUCTIVE_PROGRESS"
	| "CHILD_ERROR"
	| "INTERNAL_ERROR";

export type BackgroundProgressPhase =
	| "started"
	| "collecting"
	| "analyzing"
	| "drafting"
	| "finalizing"
	| "blocked";

export type BackgroundTaskProgress = {
	phase: BackgroundProgressPhase;
	lastProductiveAtMs?: number;
	nextExpectedUpdateByMs?: number;
	counters?: {
		tools?: number;
		artifacts?: number;
		checkpoints?: number;
	};
	blockedReasonCode?: ReasonCode;
};

export type BackgroundStallStage =
	| "healthy"
	| "suspected_stall"
	| "confirmed_stall";

export type BackgroundTaskStall = {
	stage: BackgroundStallStage;
	suspectedAtMs?: number;
	confirmedAtMs?: number;
	reasonCode?: ReasonCode;
};

export type SalvageStatus =
	| "not_attempted"
	| "attempted"
	| "succeeded"
	| "failed";

export type BackgroundTaskCancellation = {
	minimumTenancyUntilMs?: number;
	refusalReasonCode?: ReasonCode;
	cancelReasonCode?: ReasonCode;
	cancelReasonText?: string;
	salvageAttemptedAtMs?: number;
	salvageStatus?: SalvageStatus;
	salvageSummary?: string;
	salvageArtifactPath?: string;
};

const REVIEW_DEFAULTS = {
	expectedQuietWindowMs: 120_000,
	minimumTenancyMs: 180_000,
	cancelPolicy: "salvage-first" as const,
	cancellationGuardrails: {
		requiresForceDuringMinimumTenancy: true,
		silenceAloneDoesNotJustifyCancel: true,
	},
	salvageOnCancelRequired: true,
};

const GENERIC_DEFAULTS = {
	expectedQuietWindowMs: 30_000,
	minimumTenancyMs: 30_000,
	cancelPolicy: "hard-cancel-ok" as const,
	cancellationGuardrails: {
		requiresForceDuringMinimumTenancy: false,
		silenceAloneDoesNotJustifyCancel: false,
	},
	salvageOnCancelRequired: false,
};

function asPositiveInt(value: unknown, fallback: number): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return fallback;
	}

	if (value <= 0) {
		return fallback;
	}

	return Math.floor(value);
}

function asCancelPolicy(
	value: unknown,
	fallback: BackgroundTaskCancelPolicy,
): BackgroundTaskCancelPolicy {
	if (value === "salvage-first" || value === "hard-cancel-ok") {
		return value;
	}

	return fallback;
}

function asOptionalTrimmedString(value: unknown): string | undefined {
	if (typeof value !== "string") {
		return undefined;
	}

	const trimmed = value.trim();
	return trimmed ? trimmed : undefined;
}

export function normalizeBackgroundTaskKind(value: unknown): BackgroundTaskKind {
	if (typeof value !== "string") {
		return "generic";
	}

	const normalized = value.trim().toLowerCase();
	if (normalized === "review") {
		return "review";
	}

	if (normalized === "generic") {
		return "generic";
	}

	return "generic";
}

export function buildBackgroundTaskLaunchContract(args: {
	taskKind: unknown;
	expectedQuietWindowMs?: unknown;
	minimumTenancyMs?: unknown;
	expectedDeliverable?: unknown;
	cancelPolicy?: unknown;
	cancellationGuardrails?: Partial<BackgroundTaskCancellationGuardrails>;
	salvageOnCancelRequired?: unknown;
}): BackgroundTaskLaunchContract {
	const kind = normalizeBackgroundTaskKind(args.taskKind);
	const defaults = kind === "review" ? REVIEW_DEFAULTS : GENERIC_DEFAULTS;

	return {
		kind,
		expectedQuietWindowMs: asPositiveInt(
			args.expectedQuietWindowMs,
			defaults.expectedQuietWindowMs,
		),
		minimumTenancyMs: asPositiveInt(
			args.minimumTenancyMs,
			defaults.minimumTenancyMs,
		),
		expectedDeliverable: asOptionalTrimmedString(args.expectedDeliverable),
		cancelPolicy: asCancelPolicy(args.cancelPolicy, defaults.cancelPolicy),
		cancellationGuardrails: {
			requiresForceDuringMinimumTenancy:
				typeof args.cancellationGuardrails?.requiresForceDuringMinimumTenancy ===
				"boolean"
					? args.cancellationGuardrails.requiresForceDuringMinimumTenancy
					: defaults.cancellationGuardrails
						.requiresForceDuringMinimumTenancy,
			silenceAloneDoesNotJustifyCancel:
				typeof args.cancellationGuardrails?.silenceAloneDoesNotJustifyCancel ===
				"boolean"
					? args.cancellationGuardrails.silenceAloneDoesNotJustifyCancel
					: defaults.cancellationGuardrails.silenceAloneDoesNotJustifyCancel,
		},
		salvageOnCancelRequired:
			typeof args.salvageOnCancelRequired === "boolean"
				? args.salvageOnCancelRequired
				: defaults.salvageOnCancelRequired,
	};
}

export function resolveMinimumTenancyUntilMs(args: {
	executionStartedAtMs?: number;
	contract: BackgroundTaskLaunchContract;
}): number | undefined {
	if (!Number.isFinite(args.executionStartedAtMs)) {
		return undefined;
	}

	return (
		Number(args.executionStartedAtMs) +
		asPositiveInt(args.contract.minimumTenancyMs, REVIEW_DEFAULTS.minimumTenancyMs)
	);
}
