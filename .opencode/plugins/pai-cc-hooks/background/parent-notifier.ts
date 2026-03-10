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
}): string {
	return `<system-reminder>
[BACKGROUND TASK COMPLETED]
**ID:** \`${args.taskId}\`

**${args.remainingCount} ${pluralize(args.remainingCount, "task")} still in progress.** You WILL be notified when ALL complete.
Do NOT poll - continue productive work.

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
				const remainingCount = tasks.filter((t) => !isCompleteForParent(t)).length;

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
