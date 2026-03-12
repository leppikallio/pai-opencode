import type { BackgroundTaskRecord } from "../tools/background-task-state";
import { normalizeBackgroundTaskLifecycle } from "./lifecycle-normalizer";

type PromptAsyncFn = (args: {
	path: { id: string };
	body: {
		noReply: boolean;
		parts: Array<{ type: "text"; text: string; synthetic?: boolean }>;
	};
}) => Promise<unknown>;

type NotifyDeps = {
	promptAsync?: PromptAsyncFn;
	listBackgroundTasksByParent: (args: {
		parentSessionId: string;
		nowMs?: number;
	}) => Promise<BackgroundTaskRecord[]>;
	shouldSuppressDuplicate: (args: {
		sessionId: string;
		title: string;
		body: string;
		nowMs?: number;
	}) => Promise<boolean>;
	nowMs?: number;
};

type ParentFanInState = {
	tail: Promise<void>;
	partialSent: boolean;
	allCompleteSent: boolean;
	lastAllCompleteFingerprint?: string;
};

const parentFanInStateBySession = new Map<string, ParentFanInState>();

function formatDurationMs(durationMs: number | undefined): string {
	if (!Number.isFinite(durationMs) || Number(durationMs) <= 0) {
		return "unknown";
	}

	const roundedSeconds = Math.max(1, Math.round(Number(durationMs) / 1_000));
	if (roundedSeconds % 60 === 0) {
		return `${roundedSeconds / 60}m`;
	}

	return `${roundedSeconds}s`;
}

function formatEpochMs(value: number | undefined): string {
	if (!Number.isFinite(value) || Number(value) < 0) {
		return "pending execution start";
	}

	return `ms ${Math.floor(Number(value))}`;
}

function resolveTaskKind(task: BackgroundTaskRecord): string {
	return task.contract?.kind ?? task.task_kind ?? "generic";
}

export function buildBackgroundLaunchContractReminder(args: {
	taskRecord: BackgroundTaskRecord;
}): string {
	if (resolveTaskKind(args.taskRecord) !== "review") {
		return "";
	}

	const quietWindowText = formatDurationMs(
		args.taskRecord.contract?.expectedQuietWindowMs,
	);
	const nextExpectedUpdateText = formatEpochMs(
		args.taskRecord.progress?.nextExpectedUpdateByMs,
	);
	const minimumTenancyText = formatEpochMs(
		args.taskRecord.cancellation?.minimumTenancyUntilMs,
	);

	return [
		"Reminder:",
		`- Quiet analysis is expected for review tasks (quiet window ${quietWindowText}).`,
		`- Next update target from persisted state: ${nextExpectedUpdateText}.`,
		`- Cancel only for explicit failure, explicit user request, or stall policy after minimum tenancy (${minimumTenancyText}).`,
	].join("\n");
}

function buildRemainingStateSummary(remainingTasks: BackgroundTaskRecord[]): string | null {
	if (remainingTasks.length === 0) {
		return null;
	}

	const phaseCounts = new Map<string, number>();
	const statusCounts = new Map<string, number>();
	let reviewTaskCount = 0;
	let earliestNextExpectedUpdateByMs: number | undefined;

	for (const task of remainingTasks) {
		const lifecycleStatus = normalizeBackgroundTaskLifecycle(task).status;
		statusCounts.set(lifecycleStatus, (statusCounts.get(lifecycleStatus) ?? 0) + 1);

		if (resolveTaskKind(task) === "review") {
			reviewTaskCount += 1;
		}

		const phase = task.progress?.phase;
		if (phase) {
			phaseCounts.set(phase, (phaseCounts.get(phase) ?? 0) + 1);
		}

		const candidateDeadline = task.progress?.nextExpectedUpdateByMs;
		if (typeof candidateDeadline === "number" && Number.isFinite(candidateDeadline)) {
			earliestNextExpectedUpdateByMs =
				earliestNextExpectedUpdateByMs == null
					? candidateDeadline
					: Math.min(earliestNextExpectedUpdateByMs, candidateDeadline);
		}
	}

	const phaseSummary =
		phaseCounts.size === 0
			? "semantic phases unavailable"
			: `phases ${Array.from(phaseCounts.entries())
					.sort(([left], [right]) => left.localeCompare(right))
					.map(([phase, count]) => `${phase}=${count}`)
					.join(", ")}`;
	const statusSummary = `statuses ${Array.from(statusCounts.entries())
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([status, count]) => `${status}=${count}`)
		.join(", ")}`;
	const nextUpdateText =
		earliestNextExpectedUpdateByMs == null
			? "next update pending execution start"
			: `next update by ms ${Math.floor(earliestNextExpectedUpdateByMs)}`;
	const quietHint =
		reviewTaskCount > 0
			? "Review quiet-analysis windows remain valid; "
			: "";

	return `State snapshot: ${quietHint}${phaseSummary}; ${statusSummary}; ${nextUpdateText}.`;
}

function isCompleteForParent(task: BackgroundTaskRecord): boolean {
	return normalizeBackgroundTaskLifecycle(task).isTerminal;
}

function pluralize(count: number, singular: string, plural?: string): string {
	if (count === 1) return singular;
	return plural ?? `${singular}s`;
}

function buildAllCompleteText(args: {
	completedTasks: BackgroundTaskRecord[];
	fallbackTaskId: string;
}): string {
	const completedTasksText = args.completedTasks
		.map((t) => `- \`${t.task_id}\``)
		.join("\n");

	return `<system-reminder>
[ALL BACKGROUND TASKS COMPLETE]

**Completed:**
${completedTasksText || `- \`${args.fallbackTaskId}\``}

Use \`background_output(task_id="<id>")\` to retrieve each result.
</system-reminder>`;
}

function buildSingleCompleteText(args: {
	taskId: string;
	remainingCount: number;
	remainingTasks: BackgroundTaskRecord[];
}): string {
	const remainingStateSummary = buildRemainingStateSummary(args.remainingTasks);
	const remainingStateBlock = remainingStateSummary
		? `\n${remainingStateSummary}`
		: "";

	return `<system-reminder>
[BACKGROUND TASK COMPLETED]
**ID:** \`${args.taskId}\`

**${args.remainingCount} ${pluralize(args.remainingCount, "task")} still in progress.** You WILL be notified when ALL complete.
Do NOT poll - continue productive work.
${remainingStateBlock}

Use \`background_output(task_id="${args.taskId}")\` to retrieve this result when ready.
</system-reminder>`;
}

function getOrCreateParentFanInState(parentSessionId: string): ParentFanInState {
	const existing = parentFanInStateBySession.get(parentSessionId);
	if (existing) {
		return existing;
	}

	const created: ParentFanInState = {
		tail: Promise.resolve(),
		partialSent: false,
		allCompleteSent: false,
		lastAllCompleteFingerprint: undefined,
	};
	parentFanInStateBySession.set(parentSessionId, created);
	return created;
}

async function enqueueParentFanIn(args: {
	parentSessionId: string;
	work: (state: ParentFanInState) => Promise<void>;
}): Promise<void> {
	const state = getOrCreateParentFanInState(args.parentSessionId);
	const previousTail = state.tail.catch(() => undefined);
	const nextTail = previousTail.then(() => args.work(state));
	state.tail = nextTail;

	await nextTail.finally(() => {
		if (
			parentFanInStateBySession.get(args.parentSessionId) === state &&
			!state.partialSent &&
			!state.allCompleteSent
		) {
			parentFanInStateBySession.delete(args.parentSessionId);
		}
	});
}

export async function notifyParentSessionBackgroundCompletion(args: {
	taskRecord: BackgroundTaskRecord;
	deps: NotifyDeps;
}): Promise<void> {
	const visibleFallback =
		process.env.PAI_BACKGROUND_COMPLETION_VISIBLE_FALLBACK === "1";
	const parentSessionId = args.taskRecord.parent_session_id?.trim();
	if (!parentSessionId) return;

	const promptAsync = args.deps.promptAsync;
	if (!promptAsync) return;

	await enqueueParentFanIn({
		parentSessionId,
		work: async (state) => {
			try {
				const tasks = await args.deps.listBackgroundTasksByParent({
					parentSessionId,
					nowMs: args.deps.nowMs,
				});
				if (tasks.length === 0) {
					state.partialSent = false;
					state.allCompleteSent = false;
					state.lastAllCompleteFingerprint = undefined;
					return;
				}

				const allComplete = tasks.every(isCompleteForParent);
				const completedTasks = allComplete ? tasks.filter(isCompleteForParent) : [];
				const remainingTasks = tasks.filter((t) => !isCompleteForParent(t));
				const remainingCount = remainingTasks.length;

				if (allComplete) {
					const allCompleteFingerprint = completedTasks
						.map((task) => task.task_id)
						.sort()
						.join("|");
					if (
						state.allCompleteSent &&
						state.lastAllCompleteFingerprint === allCompleteFingerprint
					) {
						return;
					}

					const notificationText = buildAllCompleteText({
						completedTasks,
						fallbackTaskId: args.taskRecord.task_id,
					});
					const shouldSuppress = await args.deps.shouldSuppressDuplicate({
						sessionId: parentSessionId,
						title: "OpenCode",
						body: notificationText,
						nowMs: args.deps.nowMs,
					});

					if (!shouldSuppress) {
						await promptAsync({
							path: { id: parentSessionId },
							body: {
								noReply: false,
								parts: [
									{
										type: "text",
										text: notificationText,
										synthetic: !visibleFallback,
									},
								],
							},
						});
					}

					state.partialSent = false;
					state.allCompleteSent = true;
					state.lastAllCompleteFingerprint = allCompleteFingerprint;
					return;
				}

				state.allCompleteSent = false;
				state.lastAllCompleteFingerprint = undefined;
				if (state.partialSent) {
					return;
				}

				const notificationText = buildSingleCompleteText({
					taskId: args.taskRecord.task_id,
					remainingCount,
					remainingTasks,
				});
				const shouldSuppress = await args.deps.shouldSuppressDuplicate({
					sessionId: parentSessionId,
					title: "OpenCode",
					body: notificationText,
					nowMs: args.deps.nowMs,
				});
				if (!shouldSuppress) {
					await promptAsync({
						path: { id: parentSessionId },
						body: {
							noReply: true,
							parts: [
								{
									type: "text",
									text: notificationText,
									synthetic: !visibleFallback,
								},
							],
						},
					});
				}

				state.partialSent = true;
			} catch {
				// Best effort by design.
			}
		},
	});
}
