import { BackgroundTaskPoller } from "./background/poller";
import { executeStopHooks, setStopHookActive } from "./claude/stop";
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
	deleteSessionRootId,
	getSessionRootId,
	setSessionRootId,
} from "./shared/session-root";
import { notify as notifyCmuxDefault } from "./shared/cmux-adapter";
import {
	findBackgroundTaskByChildSessionId as findBackgroundTaskByChildSessionIdDefault,
	listActiveBackgroundTasks as listActiveBackgroundTasksDefault,
	listBackgroundTasksByParent as listBackgroundTasksByParentDefault,
	markBackgroundTaskCompleted as markBackgroundTaskCompletedDefault,
	markNotified as markNotifiedDefault,
	shouldSuppressDuplicate as shouldSuppressDuplicateDefault,
} from "./tools/background-task-state";
import { handleToolExecuteAfter } from "./tool-after";
import { handleToolExecuteBefore } from "./tool-before";
import type {
	EventHookHandler,
	HookHandler,
	UnknownRecord,
} from "./types";
import {
	type BackgroundCompletionDeps,
	createLegacyCompletionNotifyAdapter,
	emitCompletionAttentionDefault,
	maybeHandleBackgroundTaskCompletion,
	notifyBackgroundTaskCompletion,
} from "./background-completion";
import { handleChatMessage } from "./chat-message";
import {
	getPaiCcHooksSettings,
	resetPaiCcHooksSettingsCacheForTests,
} from "./settings-cache";
import {
	executeSessionLifecycleHooks,
	resolveSessionStartPolicy,
} from "./session-lifecycle";

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
	deps?: Partial<BackgroundCompletionDeps>;
}): {
	event: EventHookHandler;
	"chat.message": HookHandler;
	"tool.execute.before": HookHandler;
	"tool.execute.after": HookHandler;
} {
	const parentSessionIdCache = new Map<string, string | null>();
	const sessionGet = getSessionGetFromContext(ctx);
	const promptParentSessionAsyncFromContext =
		getSessionPromptAsyncFromContext(ctx);
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
		markBackgroundTaskCompleted:
			deps?.markBackgroundTaskCompleted ?? markBackgroundTaskCompletedDefault,
		markNotified: deps?.markNotified ?? markNotifiedDefault,
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
		markNotified: backgroundCompletionDeps.markNotified,
		markBackgroundTaskCompleted: ({ taskId, nowMs }) =>
			backgroundCompletionDeps.markBackgroundTaskCompleted({ taskId, nowMs }),
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
					? (getSessionRootId(fallbackParentSessionId) ?? fallbackParentSessionId)
					: sessionId;
				setSessionRootId(sessionId, fallbackRootSessionId || sessionId);
			}

			if (eventType === "session.deleted") {
				deleteSessionRootId(sessionId);
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
				parentSessionIdCache.set(sessionId, sessionStart.parentSessionId ?? null);
				const resolvedRootSessionId = sessionStart.parentSessionId
					? (getSessionRootId(sessionStart.parentSessionId) ??
						sessionStart.parentSessionId)
					: sessionId;
				setSessionRootId(sessionId, resolvedRootSessionId || sessionId);

				await executeSessionLifecycleHooks(
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

				await executeSessionLifecycleHooks(
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
