import { emitAmbient } from "../../hooks/lib/cmux-attention";
import { resolvePaiOrchestrationFeatureFlags } from "./feature-flags";
import { normalizeBackgroundTaskLifecycle } from "./background/lifecycle-normalizer";
import {
	stabilizeBackgroundTaskMetadata,
	type BackgroundMetadataStabilizerTimeout,
} from "./background/metadata-stabilizer";
import { notifyParentSessionBackgroundCompletion } from "./background/parent-notifier";
import {
	hasStableIdleCompletionConfidence,
	resolveStableCompletionPolicy,
	terminalizeBackgroundTask,
} from "./background/terminalize";
import type { BackgroundTaskRecord } from "./tools/background-task-state";
import { recordBackgroundTaskObservation as recordBackgroundTaskObservationDefault } from "./tools/background-task-state";
import { createPaiVoiceNotifyTool } from "./tools/voice-notify";
import type {
	CmuxNotifyFn,
	CompletionAttentionNotifyFn,
	FetchLike,
	SessionGetFn,
	SessionPromptAsyncFn,
} from "./types";

export type BackgroundCompletionDeps = {
	findBackgroundTaskByChildSessionId: (args: {
		childSessionId: string;
	}) => Promise<BackgroundTaskRecord | null>;
	recordBackgroundTaskObservation?: (args: {
		taskId: string;
		status: "running" | "idle";
		nowMs?: number;
	}) => Promise<BackgroundTaskRecord | null>;
	markBackgroundTaskTerminalAtomic: (args: {
		taskId: string;
		reason: "completed" | "failed" | "cancelled" | "stale";
		message?: string;
		nowMs?: number;
	}) => Promise<BackgroundTaskRecord | null>;
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
	sessionGet?: SessionGetFn;
	promptParentSessionAsync?: SessionPromptAsyncFn;
	notifyCmux: CmuxNotifyFn;
	emitCompletionAttention: CompletionAttentionNotifyFn;
	fetchImpl: FetchLike;
	nowMs?: () => number;
	stableCompletionEnabled?: boolean;
	metadataStabilizerMaxWaitMs?: number;
	metadataStabilizerPollIntervalMs?: number;
	onMetadataStabilizationTimeout?: (
		result: BackgroundMetadataStabilizerTimeout,
	) => Promise<void> | void;
};

function collapseWhitespace(value: string): string {
	return value.trim().replace(/\s+/g, " ");
}

function stripOpaqueIdentifiers(value: string): string {
	return value
		.replace(/\bbg_ses_[a-z0-9_-]+\b/gi, "background task")
		.replace(/\bses_[a-z0-9_-]+\b/gi, "session")
		.replace(
			/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,
			"id",
		)
		.replace(/\btask_[a-z0-9_-]{8,}\b/gi, "task");
}

function truncatePhrase(
	value: string,
	maxWords: number,
	maxChars: number,
): string {
	if (!value) {
		return "";
	}

	const words = value.split(" ").filter(Boolean);
	const wordsTruncated = words.length > maxWords;
	const byWords = (wordsTruncated ? words.slice(0, maxWords) : words).join(" ");
	const charsTruncated = byWords.length > maxChars;
	const byChars = charsTruncated
		? byWords.slice(0, maxChars).trimEnd()
		: byWords;

	if (wordsTruncated || charsTruncated) {
		return `${byChars.replace(/[\s,;:.!-]+$/g, "")}…`;
	}

	return byChars;
}

function summarizeBackgroundText(value: string | undefined): string {
	if (!value) {
		return "";
	}

	const sanitized = collapseWhitespace(stripOpaqueIdentifiers(value))
		.replace(/["'`]+/g, "")
		.trim();

	return truncatePhrase(sanitized, 12, 72);
}

function composeBackgroundReason(prefix: string, summary: string): string {
	const base = summary ? `${prefix}: ${summary}` : prefix;
	return truncatePhrase(base, 15, 96);
}

function buildBackgroundCompletionReason(
	taskRecord: BackgroundTaskRecord,
): string {
	const lifecycle = normalizeBackgroundTaskLifecycle(taskRecord);
	const errorSummary = summarizeBackgroundText(taskRecord.launch_error);
	const descriptionSummary = summarizeBackgroundText(
		taskRecord.task_description,
	);

	if (lifecycle.terminalReason === "failed") {
		const summary = errorSummary || descriptionSummary;
		return composeBackgroundReason("Background task failed", summary);
	}

	if (lifecycle.terminalReason === "cancelled") {
		const summary = errorSummary || descriptionSummary;
		return composeBackgroundReason("Background task cancelled", summary);
	}

	if (lifecycle.terminalReason === "stale") {
		const summary = descriptionSummary || errorSummary;
		return composeBackgroundReason("Background task became stale", summary);
	}

	if (descriptionSummary) {
		return composeBackgroundReason(
			"Background task completed",
			descriptionSummary,
		);
	}

	return "Background task completed";
}

export async function emitCompletionAttentionDefault(event: {
	eventKey: "AGENT_COMPLETED";
	sessionId: string;
	reasonShort: string;
}): Promise<void> {
	await emitAmbient(event);
}

export function createLegacyCompletionNotifyAdapter(
	notifyCmux: CmuxNotifyFn,
): CompletionAttentionNotifyFn {
	return async (event) => {
		await notifyCmux({
			sessionId: event.sessionId,
			title: "OpenCode",
			subtitle: "Background task",
			body: event.reasonShort,
		});
	};
}

async function emitBackgroundTaskCompletionNotifications(args: {
	taskRecord: BackgroundTaskRecord;
	deps: BackgroundCompletionDeps;
}): Promise<void> {
	const notifySessionId =
		args.taskRecord.parent_session_id || args.taskRecord.child_session_id;
	const title = "OpenCode";
	const body = buildBackgroundCompletionReason(args.taskRecord);

	try {
		await args.deps.emitCompletionAttention({
			eventKey: "AGENT_COMPLETED",
			sessionId: notifySessionId,
			reasonShort: body,
		});
	} catch {
		// Best effort by design.
	}

	// Route voice through the same `voice_notify` implementation.
	// This will no-op when voice is disabled, networking is disabled,
	// or the target session is a subagent.
	try {
		const toolDef = createPaiVoiceNotifyTool({
			client: {
				session: {
					get: args.deps.sessionGet,
				},
			},
			fetchImpl: args.deps.fetchImpl,
		});
		const voiceCtx = {
			sessionID: notifySessionId,
		} as unknown as Parameters<typeof toolDef.execute>[1];
		await toolDef.execute({ message: body, title }, voiceCtx);
	} catch {
		// Best effort by design.
	}
}

export async function notifyBackgroundTaskCompletion(args: {
	taskRecord: BackgroundTaskRecord;
	deps: BackgroundCompletionDeps;
}): Promise<void> {
	await emitBackgroundTaskCompletionNotifications(args);

	await notifyParentSessionBackgroundCompletion({
		taskRecord: args.taskRecord,
		deps: {
			promptAsync: args.deps.promptParentSessionAsync,
			listBackgroundTasksByParent: args.deps.listBackgroundTasksByParent,
			shouldSuppressDuplicate: args.deps.shouldSuppressDuplicate,
		},
	});
}

function isStableCompletionEnabled(
	deps: BackgroundCompletionDeps,
): boolean {
	if (typeof deps.stableCompletionEnabled === "boolean") {
		return deps.stableCompletionEnabled;
	}

	return resolvePaiOrchestrationFeatureFlags()
		.paiOrchestrationStableCompletionEnabled;
}

async function handleMetadataStabilizerTimeout(args: {
	deps: BackgroundCompletionDeps;
	result: BackgroundMetadataStabilizerTimeout;
}): Promise<void> {
	await args.deps.onMetadataStabilizationTimeout?.(args.result);

	if (process.env.PAI_CC_HOOKS_DEBUG !== "1") {
		return;
	}

	console.warn(
		`[pai-cc-hooks] background metadata stabilization timed out for ${args.result.childSessionId} after ${args.result.waitedMs}ms (${args.result.attempts} attempts)`,
	);
}

export async function maybeHandleBackgroundTaskCompletion(args: {
	sessionId: string;
	deps: BackgroundCompletionDeps;
}): Promise<void> {
	const nowMs = args.deps.nowMs?.() ?? Date.now();
	const metadata = await stabilizeBackgroundTaskMetadata({
		childSessionId: args.sessionId,
		deps: {
			findBackgroundTaskByChildSessionId:
				args.deps.findBackgroundTaskByChildSessionId,
			nowMs: args.deps.nowMs,
			maxWaitMs: args.deps.metadataStabilizerMaxWaitMs,
			pollIntervalMs: args.deps.metadataStabilizerPollIntervalMs,
			onTimeout: async (result) => {
				await handleMetadataStabilizerTimeout({
					deps: args.deps,
					result,
				});
			},
		},
	});
	if (metadata.status !== "ready") {
		return;
	}

	const stableCompletionEnabled = isStableCompletionEnabled(args.deps);
	const taskRecord = metadata.taskRecord;
	if (stableCompletionEnabled) {
		const policy = resolveStableCompletionPolicy();
		const observedTaskRecord =
			(await (
				args.deps.recordBackgroundTaskObservation ??
				recordBackgroundTaskObservationDefault
			)({
				taskId: taskRecord.task_id,
				status: "idle",
				nowMs,
			})) ?? taskRecord;

		if (
			!hasStableIdleCompletionConfidence({
				taskRecord: observedTaskRecord,
				nowMs,
				policy,
			})
		) {
			return;
		}
	}

	await terminalizeBackgroundTask({
		taskId: taskRecord.task_id,
		reason: "completed",
		nowMs,
		deps: {
			markBackgroundTaskTerminalAtomic:
				args.deps.markBackgroundTaskTerminalAtomic,
			onTaskTerminalized: async (completedTask) => {
				await notifyBackgroundTaskCompletion({
					taskRecord: completedTask,
					deps: args.deps,
				});
			},
		},
	});
}
