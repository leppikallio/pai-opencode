export type BackgroundTaskStatus =
	| "queued"
	| "running"
	| "stable_idle"
	| "completed"
	| "failed"
	| "cancelled"
	| "stale";

export type BackgroundTaskTerminalReason =
	| "completed"
	| "failed"
	| "cancelled"
	| "stale";

export type BackgroundTaskLifecycleLikeRecord = {
	version?: unknown;
	status?: unknown;
	terminal_reason?: unknown;
	completed_at_ms?: unknown;
	launch_error?: unknown;
	launch_error_at_ms?: unknown;
	updated_at_ms?: unknown;
};

export type NormalizedBackgroundTaskLifecycle = {
	status: BackgroundTaskStatus;
	terminalReason?: BackgroundTaskTerminalReason;
	completedAtMs?: number;
	isTerminal: boolean;
};

const VALID_STATUSES = new Set<BackgroundTaskStatus>([
	"queued",
	"running",
	"stable_idle",
	"completed",
	"failed",
	"cancelled",
	"stale",
]);

const VALID_TERMINAL_REASONS = new Set<BackgroundTaskTerminalReason>([
	"completed",
	"failed",
	"cancelled",
	"stale",
]);

const TERMINAL_PRECEDENCE: Record<BackgroundTaskTerminalReason, number> = {
	cancelled: 4,
	failed: 3,
	stale: 2,
	completed: 1,
};

function asFiniteNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function asStatus(value: unknown): BackgroundTaskStatus | undefined {
	const status = asString(value);
	if (!status || !VALID_STATUSES.has(status as BackgroundTaskStatus)) {
		return undefined;
	}

	return status as BackgroundTaskStatus;
}

function asTerminalReason(value: unknown):
	| BackgroundTaskTerminalReason
	| undefined {
	const reason = asString(value);
	if (
		!reason ||
		!VALID_TERMINAL_REASONS.has(reason as BackgroundTaskTerminalReason)
	) {
		return undefined;
	}

	return reason as BackgroundTaskTerminalReason;
}

function inferReasonFromLaunchError(
	launchError: string | undefined,
): BackgroundTaskTerminalReason | undefined {
	if (!launchError) {
		return undefined;
	}

	const normalized = launchError.trim().toLowerCase();
	if (!normalized) {
		return undefined;
	}

	if (
		normalized.includes("cancel") ||
		normalized.includes("abort") ||
		normalized.includes("interrupted")
	) {
		return "cancelled";
	}

	return "failed";
}

export function getTerminalReasonPrecedence(
	reason: BackgroundTaskTerminalReason | undefined,
): number {
	if (!reason) {
		return 0;
	}

	return TERMINAL_PRECEDENCE[reason];
}

export function selectTerminalReasonByPrecedence(args: {
	current?: BackgroundTaskTerminalReason;
	incoming?: BackgroundTaskTerminalReason;
}): BackgroundTaskTerminalReason | undefined {
	const currentScore = getTerminalReasonPrecedence(args.current);
	const incomingScore = getTerminalReasonPrecedence(args.incoming);
  if (incomingScore > currentScore) {
		return args.incoming;
	}

	return args.current ?? args.incoming;
}

function deriveLegacyLifecycle(
	record: BackgroundTaskLifecycleLikeRecord,
): NormalizedBackgroundTaskLifecycle {
	const launchError = asString(record.launch_error);
	const completedAtMs = asFiniteNumber(record.completed_at_ms);
	const launchErrorAtMs = asFiniteNumber(record.launch_error_at_ms);
	const updatedAtMs = asFiniteNumber(record.updated_at_ms);

	if (launchError) {
		const reason = inferReasonFromLaunchError(launchError) ?? "failed";
		return {
			status: reason,
			terminalReason: reason,
			completedAtMs: completedAtMs ?? launchErrorAtMs ?? updatedAtMs,
			isTerminal: true,
		};
	}

	if (completedAtMs != null) {
		return {
			status: "completed",
			terminalReason: "completed",
			completedAtMs,
			isTerminal: true,
		};
	}

	return {
		status: "running",
		isTerminal: false,
	};
}

export function normalizeBackgroundTaskLifecycle(
	record: BackgroundTaskLifecycleLikeRecord,
): NormalizedBackgroundTaskLifecycle {
	const version = asFiniteNumber(record.version);
	const parsedStatus = asStatus(record.status);
	const parsedTerminalReason = asTerminalReason(record.terminal_reason);
	const completedAtMs = asFiniteNumber(record.completed_at_ms);

	if (version === 2 && (parsedStatus || parsedTerminalReason || completedAtMs != null)) {
		const terminalReason = (() => {
			if (parsedTerminalReason) {
				return parsedTerminalReason;
			}

			if (
				parsedStatus === "completed" ||
				parsedStatus === "failed" ||
				parsedStatus === "cancelled" ||
				parsedStatus === "stale"
			) {
				return parsedStatus;
			}

			if (completedAtMs != null) {
				return "completed";
			}

			return undefined;
		})();

		if (terminalReason) {
			return {
				status: terminalReason,
				terminalReason,
				completedAtMs:
					completedAtMs ??
					asFiniteNumber(record.launch_error_at_ms) ??
					asFiniteNumber(record.updated_at_ms),
				isTerminal: true,
			};
		}

		if (parsedStatus) {
			return {
				status: parsedStatus,
				isTerminal: false,
			};
		}
	}

	return deriveLegacyLifecycle(record);
}

export function isBackgroundTaskTerminal(
	record: BackgroundTaskLifecycleLikeRecord,
): boolean {
	return normalizeBackgroundTaskLifecycle(record).isTerminal;
}

export function isBackgroundTaskActive(
	record: BackgroundTaskLifecycleLikeRecord,
): boolean {
	return !isBackgroundTaskTerminal(record);
}

export function isBackgroundTaskFailed(
	record: BackgroundTaskLifecycleLikeRecord,
): boolean {
	return normalizeBackgroundTaskLifecycle(record).terminalReason === "failed";
}

export function isBackgroundTaskCancelled(
	record: BackgroundTaskLifecycleLikeRecord,
): boolean {
	return normalizeBackgroundTaskLifecycle(record).terminalReason === "cancelled";
}
