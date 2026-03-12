import { resolvePaiOrchestrationFeatureFlags } from "../feature-flags";
import {
	recordBackgroundTaskObservation as recordBackgroundTaskObservationDefault,
	type BackgroundTaskRecord,
	type RecordBackgroundTaskObservationArgs,
	updateBackgroundTaskPolicyMetadata,
} from "../tools/background-task-state";
import {
	buildNoProgressTimeoutMessage,
	getTaskLastProgressAtMs,
	hasStableIdleCompletionConfidence,
	resolveStableCompletionPolicy,
	type StableCompletionPolicy,
	terminalizeBackgroundTask,
} from "./terminalize";
import {
	applyBackgroundCancellationPolicy,
	classifyBackgroundTaskStall,
} from "./cancellation-policy";

type CarrierClient = {
	session?: {
		status?: (options?: unknown) => Promise<unknown>;
		abort?: (options?: unknown) => Promise<unknown>;
	};
};

type StatusMap = Record<string, { type?: string }>;

type PollerDeps = {
	client: unknown;
	listActiveBackgroundTasks: (args?: {
		nowMs?: number;
	}) => Promise<BackgroundTaskRecord[]>;
	markBackgroundTaskTerminalAtomic: (args: {
		taskId: string;
		reason: "completed" | "failed" | "cancelled" | "stale";
		message?: string;
		nowMs?: number;
	}) => Promise<BackgroundTaskRecord | null>;
	recordBackgroundTaskObservation?: (
		args: RecordBackgroundTaskObservationArgs,
	) => Promise<BackgroundTaskRecord | null>;
	onTaskCompleted?: (record: BackgroundTaskRecord) => Promise<void>;
	pollIntervalMs?: number;
	nowMs?: () => number;
	stableCompletionEnabled?: boolean;
	stableCompletionPolicy?: Partial<StableCompletionPolicy>;
	requestTaskCancellation?: (args: {
		taskRecord: BackgroundTaskRecord;
	}) => Promise<void>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function getAnyProp(obj: unknown, key: string): unknown {
	return isRecord(obj) ? obj[key] : undefined;
}

function normalizeStatusMap(result: unknown): StatusMap {
	const data = getAnyProp(result, "data");
	if (isRecord(data)) {
		return Object.fromEntries(
			Object.entries(data).map(([sessionId, status]) => {
				return [sessionId, isRecord(status) ? status : {}];
			}),
		);
	}
	if (isRecord(result)) {
		return Object.fromEntries(
			Object.entries(result).map(([sessionId, status]) => {
				return [sessionId, isRecord(status) ? status : {}];
			}),
		);
	}
	return {};
}

function normalizeStatusType(status: { type?: string } | undefined): string {
	if (!status || typeof status.type !== "string") {
		return "";
	}

	return status.type.trim().toLowerCase();
}

export class BackgroundTaskPoller {
	private readonly client: CarrierClient;
	private readonly listActiveBackgroundTasks: PollerDeps["listActiveBackgroundTasks"];
	private readonly markBackgroundTaskTerminalAtomic: PollerDeps["markBackgroundTaskTerminalAtomic"];
	private readonly recordBackgroundTaskObservation: NonNullable<
		PollerDeps["recordBackgroundTaskObservation"]
	>;
	private readonly onTaskCompleted: PollerDeps["onTaskCompleted"];
	private readonly pollIntervalMs: number;
	private readonly nowMs: () => number;
	private readonly stableCompletionEnabledOverride?: boolean;
	private readonly stableCompletionPolicy: StableCompletionPolicy;
	private readonly requestTaskCancellation: PollerDeps["requestTaskCancellation"];
	private pollingInFlight = false;
	private pollingInterval?: ReturnType<typeof setInterval>;

	constructor(deps: PollerDeps) {
		this.client = (deps.client ?? {}) as CarrierClient;
		this.listActiveBackgroundTasks = deps.listActiveBackgroundTasks;
		this.markBackgroundTaskTerminalAtomic = deps.markBackgroundTaskTerminalAtomic;
		this.recordBackgroundTaskObservation =
			deps.recordBackgroundTaskObservation ??
			recordBackgroundTaskObservationDefault;
		this.onTaskCompleted = deps.onTaskCompleted;
		this.pollIntervalMs = Math.max(250, Math.min(deps.pollIntervalMs ?? 1_500, 60_000));
		this.nowMs = deps.nowMs ?? (() => new Date().valueOf());
		this.stableCompletionEnabledOverride = deps.stableCompletionEnabled;
		const defaults = resolveStableCompletionPolicy();
		this.stableCompletionPolicy = {
			minimumRuntimeMs:
				deps.stableCompletionPolicy?.minimumRuntimeMs ?? defaults.minimumRuntimeMs,
			stableIdleObservationMs:
				deps.stableCompletionPolicy?.stableIdleObservationMs ??
				defaults.stableIdleObservationMs,
			staleNoProgressMs:
				deps.stableCompletionPolicy?.staleNoProgressMs ??
				defaults.staleNoProgressMs,
		};
		this.requestTaskCancellation =
			deps.requestTaskCancellation ?? (async ({ taskRecord }) => {
				const session = this.client.session;
				if (typeof session?.abort !== "function") {
					return;
				}

				try {
					await session.abort({ path: { id: taskRecord.child_session_id } });
				} catch {
					// Best effort cancellation only.
				}
			});
	}

	private isStableCompletionEnabled(): boolean {
		if (typeof this.stableCompletionEnabledOverride === "boolean") {
			return this.stableCompletionEnabledOverride;
		}

		return resolvePaiOrchestrationFeatureFlags()
			.paiOrchestrationStableCompletionEnabled;
	}

	start(): void {
		if (this.pollingInterval) return;

		this.pollingInterval = setInterval(() => {
			void this.pollOnce();
		}, this.pollIntervalMs);
		this.pollingInterval.unref?.();
	}

	stop(): void {
		if (!this.pollingInterval) return;
		clearInterval(this.pollingInterval);
		this.pollingInterval = undefined;
	}

	private async terminalizeTask(args: {
		taskId: string;
		reason: "completed" | "stale" | "cancelled";
		nowMs: number;
		message?: string;
	}): Promise<void> {
		await terminalizeBackgroundTask({
			taskId: args.taskId,
			reason: args.reason,
			nowMs: args.nowMs,
			message: args.message,
			deps: {
				markBackgroundTaskTerminalAtomic:
					this.markBackgroundTaskTerminalAtomic,
				onTaskTerminalized: this.onTaskCompleted,
			},
		});
	}

	private async handleLegacyIdleCompletion(args: {
		record: BackgroundTaskRecord;
		status: { type?: string } | undefined;
		nowMs: number;
	}): Promise<void> {
		if (normalizeStatusType(args.status) !== "idle") {
			return;
		}

		await this.terminalizeTask({
			taskId: args.record.task_id,
			reason: "completed",
			nowMs: args.nowMs,
		});
	}

	private async handleStableCompletion(args: {
		record: BackgroundTaskRecord;
		status: { type?: string } | undefined;
		nowMs: number;
	}): Promise<void> {
		let observed = args.record;
		const stall = classifyBackgroundTaskStall({
			taskRecord: observed,
			nowMs: args.nowMs,
			staleNoProgressMs: this.stableCompletionPolicy.staleNoProgressMs,
		});
		if (stall.changed) {
			observed =
				(await updateBackgroundTaskPolicyMetadata({
					taskId: observed.task_id,
					stall: stall.stall,
					nowMs: args.nowMs,
				})) ?? observed;
		}

		const isReviewTask = observed.contract?.kind === "review";
		const shouldCancelForStall =
			stall.stage === "confirmed_stall" ||
			(!isReviewTask && stall.stage === "suspected_stall");
		if (shouldCancelForStall) {
			const staleDurationMs = Math.max(
				0,
				args.nowMs - getTaskLastProgressAtMs(observed),
			);
			await applyBackgroundCancellationPolicy({
				taskRecord: observed,
				source: "stall_monitor",
				nowMs: args.nowMs,
				reasonCode:
					stall.stage === "confirmed_stall"
						? "STALL_CONFIRMED"
						: "STALL_SUSPECTED",
				reason: buildNoProgressTimeoutMessage(staleDurationMs),
				requestTaskCancellation: async ({ taskRecord }) => {
					await this.requestTaskCancellation?.({ taskRecord });
				},
				shouldTerminalize: true,
				terminalReason: isReviewTask ? "cancelled" : "stale",
				onTaskTerminalized: this.onTaskCompleted,
			});
			return;
		}

		const statusType = normalizeStatusType(args.status);
		if (statusType === "idle") {
			const idleObserved =
				(await this.recordBackgroundTaskObservation({
					taskId: observed.task_id,
					status: "idle",
					source: "poller",
					nowMs: args.nowMs,
				})) ?? observed;

			if (
				!hasStableIdleCompletionConfidence({
					taskRecord: idleObserved,
					nowMs: args.nowMs,
					policy: this.stableCompletionPolicy,
				})
			) {
				return;
			}

			await this.terminalizeTask({
				taskId: idleObserved.task_id,
				reason: "completed",
				nowMs: args.nowMs,
			});
			return;
		}

		if (statusType && observed.status === "stable_idle") {
			await this.recordBackgroundTaskObservation({
				taskId: observed.task_id,
				status: "running",
				source: "poller",
				nowMs: args.nowMs,
			});
		}
	}

	async pollOnce(): Promise<void> {
		if (this.pollingInFlight) return;
		this.pollingInFlight = true;
		try {
			const session = this.client.session;
			if (typeof session?.status !== "function") {
				return;
			}

			const nowMs = this.nowMs();
			const active = await this.listActiveBackgroundTasks({ nowMs });
			if (active.length === 0) {
				return;
			}

			const statusResult = await session.status();
			const statuses = normalizeStatusMap(statusResult);
			const stableCompletionEnabled = this.isStableCompletionEnabled();

			for (const record of active) {
				try {
					const status = statuses[record.child_session_id];
					if (!stableCompletionEnabled) {
						await this.handleLegacyIdleCompletion({
							record,
							status,
							nowMs,
						});
						continue;
					}

					await this.handleStableCompletion({
						record,
						status,
						nowMs,
					});
				} catch {
					// Safety guard: never let one task failure break polling for other tasks.
				}
			}
		} finally {
			this.pollingInFlight = false;
		}
	}
}
