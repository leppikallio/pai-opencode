import * as fs from "node:fs";
import * as path from "node:path";
import { completeWorkSession } from "../handlers/work-tracker";
import { ensureDir, getStateDir } from "../lib/paths";
import { BackgroundTaskPoller } from "./background/poller";
import {
	type BackgroundCompletionDeps,
	createLegacyCompletionNotifyAdapter,
	emitCompletionAttentionDefault,
	maybeHandleBackgroundTaskCompletion,
	notifyBackgroundTaskCompletion,
} from "./background-completion";
import {
	buildCompactionContinuationBundle,
	PAI_COMPACTION_CONTINUATION_MAX_BYTES,
	PAI_COMPACTION_CONTINUATION_MAX_LINES,
	renderCompactionContinuationContext,
} from "./compaction/continuation-bundle";
import {
	applyCombinedCompactionBudget,
	executePreCompactHooks,
} from "./compaction/precompact";
import {
	rehydrateCompactionDerivedStateOnParentTurn,
	snapshotCompactionDerivedState,
} from "./compaction/isc-preserver";
import { handleChatMessage } from "./chat-message";
import { executeStopHooks, setStopHookActive } from "./claude/stop";
import { resolvePaiOrchestrationFeatureFlags } from "./feature-flags";
import {
	asRecord,
	getBoolean,
	getParentSessionIdFromEvent,
	getRecord,
	getSessionGetFromContext,
	getSessionIdFromEvent,
	getSessionPromptAsyncFromContext,
	getString,
} from "./session-helpers";
import {
	executeSessionLifecycleHooks,
	resolveSessionStartPolicy,
} from "./session-lifecycle";
import {
	getPaiCcHooksSettings,
	resetPaiCcHooksSettingsCacheForTests,
} from "./settings-cache";
import { notify as notifyCmuxDefault } from "./shared/cmux-adapter";
import {
	deleteSessionRootId,
	getSessionRootId,
	setSessionRootId,
} from "./shared/session-root";
import { handleToolExecuteAfter } from "./tool-after";
import { handleToolExecuteBefore } from "./tool-before";
import {
	findBackgroundTaskByChildSessionId as findBackgroundTaskByChildSessionIdDefault,
	listActiveBackgroundTasks as listActiveBackgroundTasksDefault,
	listBackgroundTasksByParent as listBackgroundTasksByParentDefault,
	markBackgroundTaskTerminalAtomic as markBackgroundTaskTerminalAtomicDefault,
	shouldSuppressDuplicate as shouldSuppressDuplicateDefault,
} from "./tools/background-task-state";
import type {
	EventHookHandler,
	HookHandler,
	SessionPromptAsyncFn,
	UnknownRecord,
} from "./types";

type SessionDeleteFn = (args: { path: { id: string } }) => Promise<unknown>;
type TuiPublishFn = (args: {
	body: {
		type: "tui.command.execute";
		properties: {
			command: "app.exit";
		};
	};
}) => Promise<unknown>;
type TuiShowToastFn = (args: {
	body: {
		message: "Failed to exit TUI";
		variant: "error";
		duration: 5000;
	};
}) => Promise<unknown>;

type WqDeps = {
	writeMarker?: (sessionId: string) => Promise<void>;
	completeWorkSession?: (sessionId: string) => Promise<unknown>;
	sessionDelete?: (sessionId: string) => Promise<unknown>;
	nowMs?: () => number;
};

type ExecuteSessionLifecycleHooksFn = (
	args: {
		sessionId: string;
		cwd: string;
		hookEventName: "SessionStart" | "SessionEnd";
		rootSessionId?: string;
		sessionStartPolicy?: Awaited<
			ReturnType<typeof resolveSessionStartPolicy>
		>["policy"];
		promptSessionAsync?: SessionPromptAsyncFn;
	},
	config: Parameters<typeof executeSessionLifecycleHooks>[1],
	settingsEnv?: Record<string, string>,
) => Promise<void>;

const WQ_EXIT_TIMEOUT_MS = 1_000;
const WQ_CLEANUP_DEADLINE_MS = 600;

class WqExitCancelledError extends Error {
	constructor() {
		super("/wq intercepted; exiting TUI");
		this.name = "WqExitCancelledError";
		this.stack = undefined;
	}
}

type WqExitIntentMarkerV1 = {
	v: 1;
	pid: number;
	sessionId: string;
	createdAt: string;
};

async function bestEffortWriteWqExitIntentMarker(args: {
	sessionId: string;
	now: number;
}): Promise<void> {
	try {
		const stateDir = getStateDir();
		await ensureDir(stateDir);
		const marker: WqExitIntentMarkerV1 = {
			v: 1,
			pid: process.pid,
			sessionId: args.sessionId,
			createdAt: new Date(args.now).toISOString(),
		};
		const filePath = path.join(
			stateDir,
			`pai-wq-exit-intent.${process.pid}.${args.now}.json`,
		);
		await fs.promises.writeFile(
			filePath,
			`${JSON.stringify(marker, null, 2)}\n`,
			"utf8",
		);
	} catch {
		// Best effort by design.
	}
}

function getSessionDeleteFromContext(
	ctx: unknown,
): SessionDeleteFn | undefined {
	const context = asRecord(ctx);
	const client = asRecord(context.client);
	const session = asRecord(client.session);
	const del = session.delete;
	if (typeof del !== "function") {
		return undefined;
	}

	return (args) =>
		(del as (this: unknown, args: unknown) => Promise<unknown>).call(
			session,
			args,
		);
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	let timeoutId: ReturnType<typeof setTimeout> | undefined;

	try {
		return await Promise.race([
			promise,
			new Promise<T>((_, reject) => {
				timeoutId = setTimeout(() => {
					reject(new Error(`Operation timed out after ${ms}ms`));
				}, ms);
			}),
		]);
	} finally {
		if (timeoutId) {
			clearTimeout(timeoutId);
		}
	}
}

function getTuiPublishFromContext(ctx: unknown): TuiPublishFn | undefined {
	const context = asRecord(ctx);
	const client = asRecord(context.client);
	const tui = asRecord(client.tui);
	const publish = tui.publish;

	if (typeof publish !== "function") {
		return undefined;
	}

	return (args) =>
		(publish as (this: unknown, args: unknown) => Promise<unknown>).call(
			tui,
			args,
		);
}

function getTuiShowToastFromContext(ctx: unknown): TuiShowToastFn | undefined {
	const context = asRecord(ctx);
	const client = asRecord(context.client);
	const tui = asRecord(client.tui);
	const showToast = tui.showToast;

	if (typeof showToast !== "function") {
		return undefined;
	}

	return (args) =>
		(showToast as (this: unknown, args: unknown) => Promise<unknown>).call(
			tui,
			args,
		);
}

export function __resetPaiCcHooksSettingsCacheForTests(): void {
	resetPaiCcHooksSettingsCacheForTests();
}

export {
	createPreToolSecurityDecisionFromError,
	createPreToolSecurityDecisionFromResult,
	type PreToolSecurityDecision,
} from "./security-adapter";

export function createPaiClaudeHooks({
	ctx,
	deps,
}: {
	ctx: unknown;
	deps?: Partial<BackgroundCompletionDeps> & {
		wq?: WqDeps;
		executeSessionLifecycleHooks?: ExecuteSessionLifecycleHooksFn;
	};
}): {
	event: EventHookHandler;
	"chat.message": HookHandler;
	"experimental.session.compacting": HookHandler;
	"command.execute.before": HookHandler;
	"tool.execute.before": HookHandler;
	"tool.execute.after": HookHandler;
} {
	const parentSessionIdCache = new Map<string, string | null>();
	const internalSessions = new Set<string>();
	const sessionGet = getSessionGetFromContext(ctx);
	const sessionDelete = getSessionDeleteFromContext(ctx);
	const lifecycleExecutor =
		deps?.executeSessionLifecycleHooks ?? executeSessionLifecycleHooks;
	const promptParentSessionAsyncFromContext =
		getSessionPromptAsyncFromContext(ctx);
	const tuiPublish = getTuiPublishFromContext(ctx);
	const tuiShowToast = getTuiShowToastFromContext(ctx);
	const wqDeps = deps?.wq;
	const wqNowMs = wqDeps?.nowMs ?? (() => Date.now());
	const wqWriteMarker =
		wqDeps?.writeMarker ??
		((sessionId: string) =>
			bestEffortWriteWqExitIntentMarker({ sessionId, now: wqNowMs() }));
	const wqCompleteWorkSession =
		wqDeps?.completeWorkSession ??
		((sessionId: string) => completeWorkSession(sessionId));
	const wqSessionDelete =
		wqDeps?.sessionDelete ??
		((sessionId: string) =>
			sessionDelete
				? sessionDelete({ path: { id: sessionId } })
				: Promise.reject(new Error("session.delete unavailable")));
	const notifyCmux = deps?.notifyCmux ?? notifyCmuxDefault;
	const emitCompletionAttention =
		deps?.emitCompletionAttention ??
		(deps?.notifyCmux
			? createLegacyCompletionNotifyAdapter(notifyCmux)
			: emitCompletionAttentionDefault);
	const backgroundCompletionDeps: BackgroundCompletionDeps = {
		findBackgroundTaskByChildSessionId:
			deps?.findBackgroundTaskByChildSessionId ??
			findBackgroundTaskByChildSessionIdDefault,
		markBackgroundTaskTerminalAtomic:
			deps?.markBackgroundTaskTerminalAtomic ??
			markBackgroundTaskTerminalAtomicDefault,
		listBackgroundTasksByParent:
			deps?.listBackgroundTasksByParent ?? listBackgroundTasksByParentDefault,
		shouldSuppressDuplicate:
			deps?.shouldSuppressDuplicate ?? shouldSuppressDuplicateDefault,
		promptParentSessionAsync:
			deps?.promptParentSessionAsync ?? promptParentSessionAsyncFromContext,
		sessionGet,
		notifyCmux,
		emitCompletionAttention,
		fetchImpl: deps?.fetchImpl ?? ((url, init) => fetch(url, init)),
	};

	const poller = new BackgroundTaskPoller({
		client: getRecord(asRecord(ctx), "client"),
		listActiveBackgroundTasks: listActiveBackgroundTasksDefault,
		markBackgroundTaskTerminalAtomic:
			backgroundCompletionDeps.markBackgroundTaskTerminalAtomic,
		onTaskCompleted: async (taskRecord) => {
			await notifyBackgroundTaskCompletion({
				taskRecord,
				deps: backgroundCompletionDeps,
			});
		},
	});
	poller.start();

	const resolveParentSessionId = async (
		sessionId: string,
		properties: UnknownRecord = {},
		info: UnknownRecord = {},
	): Promise<string | undefined> => {
		const parentSessionIdFromEvent = getParentSessionIdFromEvent(
			properties,
			info,
		);
		if (parentSessionIdFromEvent) {
			parentSessionIdCache.set(sessionId, parentSessionIdFromEvent);
			return parentSessionIdFromEvent;
		}

		if (parentSessionIdCache.has(sessionId)) {
			return parentSessionIdCache.get(sessionId) ?? undefined;
		}

		if (!sessionGet) {
			return undefined;
		}

		try {
			const session = asRecord(await sessionGet({ path: { id: sessionId } }));
			const sessionInfo = getRecord(session, "info") ?? {};
			const fetchedParentSessionId = getParentSessionIdFromEvent(
				session,
				sessionInfo,
			);
			parentSessionIdCache.set(sessionId, fetchedParentSessionId ?? null);
			return fetchedParentSessionId;
		} catch {
			return undefined;
		}
	};

	return {
		event: async (input) => {
			const payload = asRecord(input);
			const event = getRecord(payload, "event") ?? payload;
			const eventType = getString(event, "type") ?? "";

			if (
				eventType !== "session.created" &&
				eventType !== "session.idle" &&
				eventType !== "session.deleted"
			) {
				return;
			}
			const properties = getRecord(event, "properties") ?? {};
			const info = getRecord(properties, "info") ?? {};
			const sessionId = getSessionIdFromEvent(properties, info);
			if (!sessionId) return;

			if (eventType === "session.created") {
				const fallbackParentSessionId = getParentSessionIdFromEvent(
					properties,
					info,
				);
				const fallbackRootSessionId = fallbackParentSessionId
					? (getSessionRootId(fallbackParentSessionId) ??
						fallbackParentSessionId)
					: sessionId;
				setSessionRootId(sessionId, fallbackRootSessionId || sessionId);
			}

			if (eventType === "session.deleted") {
				deleteSessionRootId(sessionId);
			}

			const title = getString(info, "title") ?? "";
			const internalFromEventTitle = title
				.trimStart()
				.startsWith("[PAI INTERNAL]");
			const internalFromCache = internalSessions.has(sessionId);
			const isInternalSession = internalFromCache || internalFromEventTitle;

			if (eventType === "session.created" && internalFromEventTitle) {
				internalSessions.add(sessionId);
				parentSessionIdCache.set(sessionId, null);
				return;
			}

			if (eventType === "session.idle" && internalFromCache) {
				return;
			}

			if (eventType === "session.deleted" && isInternalSession) {
				internalSessions.delete(sessionId);
				parentSessionIdCache.delete(sessionId);
				return;
			}

			const { hooks: config, env } = await getPaiCcHooksSettings();

			if (eventType === "session.created") {
				const fallbackParentSessionId = getParentSessionIdFromEvent(
					properties,
					info,
				);
				const sessionStart = await resolveSessionStartPolicy({
					sessionId,
					sessionGet,
					fallbackParentSessionId,
				});
				parentSessionIdCache.set(
					sessionId,
					sessionStart.parentSessionId ?? null,
				);
				const resolvedRootSessionId = sessionStart.parentSessionId
					? (getSessionRootId(sessionStart.parentSessionId) ??
						sessionStart.parentSessionId)
					: sessionId;
				setSessionRootId(sessionId, resolvedRootSessionId || sessionId);

				await lifecycleExecutor(
					{
						sessionId,
						cwd: process.cwd(),
						hookEventName: "SessionStart",
						rootSessionId: resolvedRootSessionId || sessionId,
						sessionStartPolicy: sessionStart.policy,
						promptSessionAsync: promptParentSessionAsyncFromContext,
					},
					config,
					env,
				);
				return;
			}

			const parentSessionId = await resolveParentSessionId(
				sessionId,
				properties,
				info,
			);

			if (eventType === "session.deleted") {
				if (parentSessionId) {
					parentSessionIdCache.delete(sessionId);
					return;
				}

				await lifecycleExecutor(
					{
						sessionId,
						cwd: process.cwd(),
						hookEventName: "SessionEnd",
					},
					config,
					env,
				);
				parentSessionIdCache.delete(sessionId);
				return;
			}

			try {
				await maybeHandleBackgroundTaskCompletion({
					sessionId,
					deps: backgroundCompletionDeps,
				});
			} catch (error) {
				if (process.env.PAI_CC_HOOKS_DEBUG === "1") {
					const reason = error instanceof Error ? error.message : String(error);
					console.warn(
						`[pai-cc-hooks] session.idle background completion failed: ${reason}`,
					);
				}
			}

			const result = await executeStopHooks(
				{
					sessionId,
					parentSessionId,
					cwd: process.cwd(),
					stopHookActive: getBoolean(properties, "stopHookActive"),
				},
				config,
				undefined,
				env,
			);

			if (result.stopHookActive !== undefined) {
				setStopHookActive(sessionId, result.stopHookActive);
			}
		},

		"chat.message": async (input, output) => {
			try {
				const flags = resolvePaiOrchestrationFeatureFlags();
				if (flags.paiOrchestrationCompactionBundleEnabled) {
					const payload = asRecord(input);
					const sessionId =
						getString(payload, "sessionID") ??
						getString(payload, "sessionId") ??
						"";

					if (sessionId) {
						const parentSessionId = await resolveParentSessionId(sessionId);
						if (!parentSessionId) {
							await rehydrateCompactionDerivedStateOnParentTurn({
								sessionId,
							});
						}
					}
				}
			} catch {
				// Fail-open by design.
			}

			const { hooks: config, env } = await getPaiCcHooksSettings();

			await handleChatMessage({
				input,
				output,
				config,
				env,
				cwd: process.cwd(),
				resolveParentSessionId,
			});
		},

		"experimental.session.compacting": async (input, output) => {
			const payload = asRecord(input);
			const sessionId =
				getString(payload, "sessionID") ??
				getString(payload, "sessionId") ??
				"";
			if (!sessionId) {
				return;
			}

			const flags = resolvePaiOrchestrationFeatureFlags();
			const parentSessionId = await resolveParentSessionId(sessionId, payload, {});
			const resolvedRootSessionId =
				getSessionRootId(sessionId) ??
				(parentSessionId
					? (getSessionRootId(parentSessionId) ?? parentSessionId)
					: sessionId);

			const { hooks: config, env } = await getPaiCcHooksSettings();
			const beadsContext = await executePreCompactHooks({
				config,
				cwd: process.cwd(),
				sessionId,
				rootSessionId: resolvedRootSessionId,
				settingsEnv: env,
			});

			let continuationContext: string | undefined;
			if (flags.paiOrchestrationCompactionBundleEnabled) {
				const bundle = await buildCompactionContinuationBundle({
					parentSessionId: sessionId,
				});
				await snapshotCompactionDerivedState({
					sessionId,
					bundle,
				});
				continuationContext = renderCompactionContinuationContext(bundle);
			}

			const bounded = applyCombinedCompactionBudget({
				beadsContext,
				continuationContext,
				maxLines: PAI_COMPACTION_CONTINUATION_MAX_LINES,
				maxBytes: PAI_COMPACTION_CONTINUATION_MAX_BYTES,
			});

			const slices: string[] = [];
			if (bounded.beadsContext && bounded.beadsContext.trim()) {
				slices.push(bounded.beadsContext);
			}
			if (bounded.continuationContext && bounded.continuationContext.trim()) {
				slices.push(bounded.continuationContext);
			}

			if (slices.length === 0 || typeof output !== "object" || output === null) {
				return;
			}

			const outputRecord = output as UnknownRecord;
			if (Array.isArray(outputRecord.context)) {
				(outputRecord.context as unknown[]).push(...slices);
				return;
			}

			outputRecord.context = slices;
		},

		"command.execute.before": async (input) => {
			const payload = asRecord(input);
			const command = getString(payload, "command");
			const sessionId =
				getString(payload, "sessionID") ??
				getString(payload, "sessionId") ??
				"";

			if (command !== "wq") {
				return;
			}

			const publishSucceeded = await (async (): Promise<boolean> => {
				if (!tuiPublish) {
					return false;
				}

				try {
					await withTimeout(
						tuiPublish({
							body: {
								type: "tui.command.execute",
								properties: { command: "app.exit" },
							},
						}),
						WQ_EXIT_TIMEOUT_MS,
					);
					return true;
				} catch {
					return false;
				}
			})();

			if (publishSucceeded) {
				try {
					if (sessionId) {
						const cleanupStart = wqNowMs();
						const cleanupDeadline = cleanupStart + WQ_CLEANUP_DEADLINE_MS;
						const remaining = () => Math.max(0, cleanupDeadline - wqNowMs());

						const bounded = <T>(p: Promise<T>, msCap: number) =>
							withTimeout(p, Math.min(msCap, remaining())).catch(
								() => undefined,
							);

						await Promise.race([
							Promise.allSettled([
								bounded(wqWriteMarker(sessionId), 150),
								bounded(wqCompleteWorkSession(sessionId), 250),
								bounded(wqSessionDelete(sessionId), 250),
							]),
							new Promise<void>((resolve) => setTimeout(resolve, remaining())),
						]);
					}
				} catch {
					// Best-effort cleanup; exit cancellation must still win.
				}

				throw new WqExitCancelledError();
			}

			if (!tuiShowToast) {
				return;
			}

			try {
				await withTimeout(
					tuiShowToast({
						body: {
							message: "Failed to exit TUI",
							variant: "error",
							duration: 5000,
						},
					}),
					WQ_EXIT_TIMEOUT_MS,
				);
			} catch {
				// Best effort by design.
			}
		},

		"tool.execute.before": async (input, output) => {
			const { hooks: config, env } = await getPaiCcHooksSettings();

			await handleToolExecuteBefore({
				input,
				output,
				config,
				env,
				cwd: process.cwd(),
			});
		},

		"tool.execute.after": async (input, output) => {
			const { hooks: config, env } = await getPaiCcHooksSettings();

			await handleToolExecuteAfter({
				input,
				output,
				config,
				env,
				cwd: process.cwd(),
			});
		},
	};
}
