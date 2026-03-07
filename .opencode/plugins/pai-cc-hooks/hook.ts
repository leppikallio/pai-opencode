import { emitAmbient } from "../../hooks/lib/cmux-attention";
import { notifyParentSessionBackgroundCompletion } from "./background/parent-notifier";
import { BackgroundTaskPoller } from "./background/poller";
import {
	type LoadedClaudeHookSettings,
	loadClaudeHookSettings,
} from "./claude/config";
import { executePostToolUseHooks } from "./claude/post-tool-use";
import { executePreToolUseHooks } from "./claude/pre-tool-use";
import { executeStopHooks, setStopHookActive } from "./claude/stop";
import type {
	ClaudeHooksConfig,
	SessionEndInput,
	SessionStartInput,
} from "./claude/types";
import { executeUserPromptSubmitHooks } from "./claude/user-prompt-submit";
import { notify as notifyCmuxDefault } from "./shared/cmux-adapter";
import { executeHookCommand } from "./shared/execute-hook-command";
import { findMatchingHooks } from "./shared/pattern-matcher";
import {
	deleteSessionRootId,
	getSessionRootId,
	setSessionRootId,
} from "./shared/session-root";
import { completeWorkSession } from "../handlers/work-tracker";
import { ensureDir, getStateDir } from "../lib/paths";
import * as fs from "node:fs";
import * as path from "node:path";
import {
	type BackgroundTaskRecord,
	findBackgroundTaskByChildSessionId as findBackgroundTaskByChildSessionIdDefault,
	listActiveBackgroundTasks as listActiveBackgroundTasksDefault,
	listBackgroundTasksByParent as listBackgroundTasksByParentDefault,
	markBackgroundTaskCompleted as markBackgroundTaskCompletedDefault,
	markNotified as markNotifiedDefault,
	shouldSuppressDuplicate as shouldSuppressDuplicateDefault,
} from "./tools/background-task-state";
import { createPaiVoiceNotifyTool } from "./tools/voice-notify";

type EventHookHandler = (input: unknown) => Promise<void>;
type HookHandler = (input: unknown, output: unknown) => Promise<void>;
type SessionGetFn = (args: { path: { id: string } }) => Promise<unknown>;
type SessionDeleteFn = (args: { path: { id: string } }) => Promise<unknown>;
type SessionPromptAsyncFn = (args: {
	path: { id: string };
	body: {
		noReply: boolean;
		parts: Array<{ type: "text"; text: string; synthetic?: boolean }>;
	};
}) => Promise<unknown>;
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

type UnknownRecord = Record<string, unknown>;
type SessionLifecycleEventName = "SessionStart" | "SessionEnd";
type SessionStartPolicy = {
	allowLoadContext: boolean;
	allowLoadContextStdoutInjection: boolean;
	allowScratchpadBindingStdoutInjection: boolean;
};
type CmuxNotifyFn = (args: {
	sessionId: string;
	title: string;
	subtitle: string;
	body: string;
}) => Promise<void>;
type CompletionAttentionNotifyFn = (event: {
	eventKey: "AGENT_COMPLETED";
	sessionId: string;
	reasonShort: string;
}) => Promise<void>;
type FetchLike = (url: string, init?: RequestInit) => Promise<unknown>;

type BackgroundCompletionDeps = {
	findBackgroundTaskByChildSessionId: (args: {
		childSessionId: string;
	}) => Promise<BackgroundTaskRecord | null>;
	markBackgroundTaskCompleted: (args: {
		taskId: string;
		nowMs?: number;
	}) => Promise<BackgroundTaskRecord | null>;
	markNotified: (taskId: string, nowMs?: number) => Promise<boolean>;
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
};

type WqDeps = {
	writeMarker?: (sessionId: string) => Promise<void>;
	completeWorkSession?: (sessionId: string) => Promise<unknown>;
	sessionDelete?: (sessionId: string) => Promise<unknown>;
	nowMs?: () => number;
};

type ExecuteSessionLifecycleHooksFn = (args: {
	sessionId: string;
	cwd: string;
	hookEventName: SessionLifecycleEventName;
	rootSessionId?: string;
	sessionStartPolicy?: SessionStartPolicy;
	promptSessionAsync?: SessionPromptAsyncFn;
}, config: ClaudeHooksConfig | null, settingsEnv?: Record<string, string>) => Promise<void>;

const DEFAULT_HOOK_COMMAND_CONFIG = {
	forceZsh: process.platform !== "win32",
	zshPath: "/bin/zsh",
};

type AskGateEntry = {
	confirmId: string;
	createdAt: number;
	confirmedAt?: number;
	key: string;
	reason?: string;
	hookName?: string;
	toolName?: string;
	inputLines?: string;
};

// Hook "ask" decisions can't currently trigger OpenCode's permission UI
// (PermissionNext.ask) from tool.execute.before. Instead, we block the tool and
// require an explicit user confirmation message.
const ASK_GATE_TTL_MS = 5 * 60 * 1000;
const WQ_EXIT_TIMEOUT_MS = 1_000;
const WQ_CLEANUP_DEADLINE_MS = 600;
const askGateByConfirmId = new Map<string, AskGateEntry>();
const askGateByKey = new Map<string, AskGateEntry>();

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

function stableStringify(value: unknown): string {
	const seen = new WeakSet<object>();

	const stringify = (v: unknown): string => {
		if (v === null) return "null";
		const t = typeof v;
		if (t === "string") return JSON.stringify(v);
		if (t === "number" || t === "boolean") return String(v);
		if (t !== "object") return JSON.stringify(String(v));

		if (Array.isArray(v)) {
			return `[${v.map((x) => stringify(x)).join(",")}]`;
		}

		const obj = v as Record<string, unknown>;
		if (seen.has(obj)) return '"[Circular]"';
		seen.add(obj);
		const keys = Object.keys(obj).sort();
		const entries = keys.map(
			(k) => `${JSON.stringify(k)}:${stringify(obj[k])}`,
		);
		return `{${entries.join(",")}}`;
	};

	return stringify(value);
}

function buildAskGateKey(args: {
	sessionId: string;
	toolName: string;
	toolInput: UnknownRecord;
}): string {
	return `${args.sessionId}:${args.toolName}:${stableStringify(args.toolInput)}`;
}

function newConfirmId(): string {
	return `pai_confirm_${Math.random().toString(36).slice(2, 10)}`;
}

function parseConfirmMessage(text: string): string | undefined {
	const trimmed = text.trim();
	const match = trimmed.match(
		/^(?:PAI_CONFIRM|pai_confirm)\s+([a-zA-Z0-9_-]+)$/,
	);
	return match?.[1];
}

function pruneAskGate(now: number): void {
	for (const [id, entry] of askGateByConfirmId.entries()) {
		if (now - entry.createdAt > ASK_GATE_TTL_MS) {
			askGateByConfirmId.delete(id);
			if (askGateByKey.get(entry.key)?.confirmId === id) {
				askGateByKey.delete(entry.key);
			}
		}
	}
}

function asRecord(value: unknown): UnknownRecord {
	return typeof value === "object" && value !== null
		? (value as UnknownRecord)
		: {};
}

function getString(obj: UnknownRecord, key: string): string | undefined {
	const value = obj[key];
	return typeof value === "string" ? value : undefined;
}

function getRecord(obj: UnknownRecord, key: string): UnknownRecord | undefined {
	const value = obj[key];
	return typeof value === "object" && value !== null
		? (value as UnknownRecord)
		: undefined;
}

function getBoolean(obj: UnknownRecord, key: string): boolean | undefined {
	const value = obj[key];
	return typeof value === "boolean" ? value : undefined;
}

function getSessionIdFromEvent(
	properties: UnknownRecord,
	info: UnknownRecord,
): string {
	return (
		getString(properties, "sessionID") ??
		getString(info, "sessionID") ??
		getString(info, "id") ??
		""
	);
}

function getParentSessionIdFromEvent(
	properties: UnknownRecord,
	info: UnknownRecord,
): string | undefined {
	return (
		getString(info, "parentID") ??
		getString(info, "parentId") ??
		getString(properties, "parentSessionID") ??
		getString(properties, "parentSessionId")
	);
}

function getSessionGetFromContext(ctx: unknown): SessionGetFn | undefined {
	const context = asRecord(ctx);
	const client = asRecord(context.client);
	const session = asRecord(client.session);
	const get = session.get;
	if (typeof get !== "function") {
		return undefined;
	}

	return (args) =>
		(get as (this: unknown, args: unknown) => Promise<unknown>).call(
			session,
			args,
		);
}

function getSessionDeleteFromContext(ctx: unknown): SessionDeleteFn | undefined {
	const context = asRecord(ctx);
	const client = asRecord(context.client);
	const session = asRecord(client.session);
	const del = session.delete;
	if (typeof del !== "function") {
		return undefined;
	}

	return (args) =>
		(del as (this: unknown, args: unknown) => Promise<unknown>).call(session, args);
}

function isDebugLoggingEnabled(): boolean {
	return process.env.PAI_CC_HOOKS_DEBUG === "1";
}

function sanitizeDebugReason(error: unknown): string {
	const reason = error instanceof Error ? error.message : String(error);
	return summarizeBackgroundText(reason) || "unknown error";
}

function getSessionPromptAsyncFromContext(
	ctx: unknown,
): SessionPromptAsyncFn | undefined {
	const context = asRecord(ctx);
	const client = asRecord(context.client);
	const session = asRecord(client.session);
	const promptAsync = session.promptAsync;
	if (typeof promptAsync !== "function") {
		return undefined;
	}

	return (args) =>
		(promptAsync as (this: unknown, args: unknown) => Promise<unknown>).call(
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

function isLoadContextHookCommand(command: string): boolean {
	return command.includes("LoadContext.hook.ts");
}

function isScratchpadBindingHookCommand(command: string): boolean {
	return command.includes("ScratchpadBinding.hook.ts");
}

function shouldInjectSessionStartStdout(args: {
	command: string;
	policy: SessionStartPolicy;
}): boolean {
	if (isScratchpadBindingHookCommand(args.command)) {
		return args.policy.allowScratchpadBindingStdoutInjection;
	}

	if (isLoadContextHookCommand(args.command)) {
		return args.policy.allowLoadContextStdoutInjection;
	}

	return false;
}

async function resolveSessionStartPolicy(args: {
	sessionId: string;
	sessionGet?: SessionGetFn;
	fallbackParentSessionId?: string;
}): Promise<{ parentSessionId?: string; policy: SessionStartPolicy }> {
	if (!args.sessionGet) {
		if (isDebugLoggingEnabled()) {
			console.warn(
				"[pai-cc-hooks] SessionStart metadata unavailable; skipping LoadContext hook injection.",
			);
		}
		return {
			parentSessionId: args.fallbackParentSessionId,
			policy: {
				allowLoadContext: false,
				allowLoadContextStdoutInjection: false,
				allowScratchpadBindingStdoutInjection: true,
			},
		};
	}

	try {
		const session = asRecord(
			await args.sessionGet({ path: { id: args.sessionId } }),
		);
		const sessionInfo = getRecord(session, "info") ?? {};
		const parentSessionId =
			getParentSessionIdFromEvent(session, sessionInfo) ??
			args.fallbackParentSessionId;
		const isSubagent = Boolean(parentSessionId);

		return {
			parentSessionId,
			policy: {
				allowLoadContext: !isSubagent,
				allowLoadContextStdoutInjection: !isSubagent,
				allowScratchpadBindingStdoutInjection: true,
			},
		};
	} catch (error) {
		if (isDebugLoggingEnabled()) {
			const reason = sanitizeDebugReason(error);
			console.warn(
				`[pai-cc-hooks] SessionStart metadata fetch failed; skipping LoadContext hook injection: ${reason}`,
			);
		}
		return {
			parentSessionId: args.fallbackParentSessionId,
			policy: {
				allowLoadContext: false,
				allowLoadContextStdoutInjection: false,
				allowScratchpadBindingStdoutInjection: true,
			},
		};
	}
}

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
	const errorSummary = summarizeBackgroundText(taskRecord.launch_error);
	if (errorSummary) {
		return composeBackgroundReason("Background task failed", errorSummary);
	}

	const descriptionSummary = summarizeBackgroundText(
		taskRecord.task_description,
	);
	if (descriptionSummary) {
		return composeBackgroundReason(
			"Background task completed",
			descriptionSummary,
		);
	}

	return "Background task completed";
}

async function emitCompletionAttentionDefault(event: {
	eventKey: "AGENT_COMPLETED";
	sessionId: string;
	reasonShort: string;
}): Promise<void> {
	await emitAmbient(event);
}

function createLegacyCompletionNotifyAdapter(
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

async function maybeHandleBackgroundTaskCompletion(args: {
	sessionId: string;
	deps: BackgroundCompletionDeps;
}): Promise<void> {
	const taskRecord = await args.deps.findBackgroundTaskByChildSessionId({
		childSessionId: args.sessionId,
	});
	if (!taskRecord) {
		return;
	}

	const shouldNotify = await args.deps.markNotified(taskRecord.task_id);
	if (!shouldNotify) {
		return;
	}

	const completedTask = await args.deps.markBackgroundTaskCompleted({
		taskId: taskRecord.task_id,
	});
	if (!completedTask) {
		return;
	}

	await emitBackgroundTaskCompletionNotifications({
		taskRecord: completedTask,
		deps: args.deps,
	});

	await notifyParentSessionBackgroundCompletion({
		taskRecord: completedTask,
		deps: {
			promptAsync: args.deps.promptParentSessionAsync,
			listBackgroundTasksByParent: args.deps.listBackgroundTasksByParent,
			shouldSuppressDuplicate: args.deps.shouldSuppressDuplicate,
		},
	});
}

async function executeSessionLifecycleHooks(
	args: {
		sessionId: string;
		cwd: string;
		hookEventName: SessionLifecycleEventName;
		rootSessionId?: string;
		sessionStartPolicy?: SessionStartPolicy;
		promptSessionAsync?: SessionPromptAsyncFn;
	},
	config: ClaudeHooksConfig | null,
	settingsEnv?: Record<string, string>,
): Promise<void> {
	if (!config) {
		return;
	}

	const matchers = findMatchingHooks(config, args.hookEventName);
	if (matchers.length === 0) {
		return;
	}

	const stdinData: SessionStartInput | SessionEndInput = {
		session_id: args.sessionId,
		cwd: args.cwd,
		hook_event_name: args.hookEventName,
		hook_source: "opencode-plugin",
	};

	if (args.hookEventName === "SessionStart") {
		(
			stdinData as SessionStartInput & {
				root_session_id?: string;
			}
		).root_session_id = args.rootSessionId || args.sessionId;
	}

	for (const matcher of matchers) {
		if (!matcher.hooks || matcher.hooks.length === 0) continue;

		for (const hook of matcher.hooks) {
			if (hook.type !== "command") continue;
			if (
				args.hookEventName === "SessionStart" &&
				args.sessionStartPolicy &&
				!args.sessionStartPolicy.allowLoadContext &&
				isLoadContextHookCommand(hook.command)
			) {
				continue;
			}

			const result = await executeHookCommand(
				hook.command,
				JSON.stringify(stdinData),
				args.cwd,
				{
					forceZsh: DEFAULT_HOOK_COMMAND_CONFIG.forceZsh,
					zshPath: DEFAULT_HOOK_COMMAND_CONFIG.zshPath,
					env: settingsEnv,
				},
			);

			if (result.exitCode !== 0 && process.env.PAI_CC_HOOKS_DEBUG === "1") {
				const reason =
					result.stderr || result.stdout || `exit code ${result.exitCode}`;
				console.warn(
					`[pai-cc-hooks] ${args.hookEventName} hook command failed: ${reason}`,
				);
			}

			if (
				args.hookEventName === "SessionStart" &&
				args.sessionStartPolicy &&
				args.promptSessionAsync &&
				shouldInjectSessionStartStdout({
					command: hook.command,
					policy: args.sessionStartPolicy,
				}) &&
				result.exitCode === 0 &&
				result.stdout
			) {
				try {
					await args.promptSessionAsync({
						path: { id: args.sessionId },
						body: {
							noReply: true,
							parts: [
								{
									type: "text",
									text: result.stdout,
									synthetic: true,
								},
							],
						},
					});
				} catch (error) {
					if (isDebugLoggingEnabled()) {
						const reason = sanitizeDebugReason(error);
						console.warn(
							`[pai-cc-hooks] SessionStart stdout injection failed: ${reason}`,
						);
					}
				}
			}
		}
	}
}

let settingsPromise: Promise<LoadedClaudeHookSettings> | null = null;

export function __resetPaiCcHooksSettingsCacheForTests(): void {
	settingsPromise = null;
}

function getSettingsPromise(): Promise<LoadedClaudeHookSettings> {
	if (!settingsPromise) {
		settingsPromise = loadClaudeHookSettings();
	}
	return settingsPromise as Promise<LoadedClaudeHookSettings>;
}

export function createPaiClaudeHooks({
	ctx,
	deps,
}: {
	ctx: unknown;
	deps?:
		Partial<BackgroundCompletionDeps> &
		{
			wq?: WqDeps;
			executeSessionLifecycleHooks?: ExecuteSessionLifecycleHooksFn;
		};
}): {
	event: EventHookHandler;
	"chat.message": HookHandler;
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
		wqDeps?.completeWorkSession ?? ((sessionId: string) => completeWorkSession(sessionId));
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
			await emitBackgroundTaskCompletionNotifications({
				taskRecord,
				deps: backgroundCompletionDeps,
			});

			await notifyParentSessionBackgroundCompletion({
				taskRecord,
				deps: {
					promptAsync: backgroundCompletionDeps.promptParentSessionAsync,
					listBackgroundTasksByParent:
						backgroundCompletionDeps.listBackgroundTasksByParent,
					shouldSuppressDuplicate:
						backgroundCompletionDeps.shouldSuppressDuplicate,
				},
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

			const { hooks: config, env } = await getSettingsPromise();

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
			const payload = asRecord(input);
			const out = asRecord(output);
			const { hooks: config, env } = await getSettingsPromise();

			const partsRaw = payload.parts;
			const parts = Array.isArray(partsRaw)
				? partsRaw.filter(
						(
							part,
						): part is {
							type: "text" | "tool_use" | "tool_result";
							text?: string;
						} => {
							return typeof part === "object" && part !== null;
						},
					)
				: [];

			const prompt =
				getString(payload, "prompt") ??
				parts
					.filter(
						(part) => part.type === "text" && typeof part.text === "string",
					)
					.map((part) => part.text ?? "")
					.join("\n");

			// If the user explicitly confirms a pending hook ask, mark it confirmed.
			// The next retry of the same tool+args will be allowed once.
			pruneAskGate(Date.now());
			const confirmId = parseConfirmMessage(prompt);
			if (confirmId) {
				const pending = askGateByConfirmId.get(confirmId);
				if (pending && !pending.confirmedAt) {
					pending.confirmedAt = Date.now();
					askGateByConfirmId.set(confirmId, pending);
					askGateByKey.set(pending.key, pending);
				}
			}

			const sessionId =
				getString(payload, "sessionID") ??
				getString(payload, "sessionId") ??
				"";
			if (!sessionId) return;
			const parentSessionId = await resolveParentSessionId(sessionId);

			const result = await executeUserPromptSubmitHooks(
				{
					sessionId,
					parentSessionId,
					prompt,
					parts,
					cwd: process.cwd(),
				},
				config,
				undefined,
				env,
			);

			if (result.block) {
				out.error = result.reason ?? "Blocked by UserPromptSubmit hook";
			}

			if (result.messages.length > 0) {
				out.hookMessages = result.messages;
			}
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

						const bounded = <T,>(p: Promise<T>, msCap: number) =>
							withTimeout(p, Math.min(msCap, remaining())).catch(() => undefined);

						await Promise.race([
							Promise.allSettled([
								bounded(wqWriteMarker(sessionId), 150),
								bounded(wqCompleteWorkSession(sessionId), 250),
								bounded(wqSessionDelete(sessionId), 250),
							]),
							new Promise<void>((resolve) =>
								setTimeout(resolve, remaining()),
							),
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
			const payload = asRecord(input);
			const out = asRecord(output);
			const { hooks: config, env } = await getSettingsPromise();

			const toolName = getString(payload, "tool") ?? "";
			const toolInput =
				getRecord(out, "args") ?? getRecord(payload, "args") ?? {};
			const sessionId =
				getString(payload, "sessionID") ??
				getString(payload, "sessionId") ??
				"";

			pruneAskGate(Date.now());
			if (sessionId && toolName) {
				const key = buildAskGateKey({ sessionId, toolName, toolInput });
				const existing = askGateByKey.get(key);
				if (
					existing?.confirmedAt &&
					Date.now() - existing.confirmedAt < ASK_GATE_TTL_MS
				) {
					// One-shot allow: clear the gate for this key.
					askGateByKey.delete(key);
					askGateByConfirmId.delete(existing.confirmId);
					return;
				}
			}

			const result = await executePreToolUseHooks(
				{
					sessionId,
					toolName,
					toolInput,
					cwd: process.cwd(),
					toolUseId:
						getString(payload, "callID") ?? getString(payload, "callId"),
				},
				config,
				undefined,
				env,
			);

			if (result.modifiedInput) {
				out.args = result.modifiedInput;
			}

			if (result.decision === "deny") {
				throw new Error(result.reason ?? "Blocked by PreToolUse hook");
			}

			if (result.decision === "ask") {
				const confirmId = newConfirmId();
				const key = buildAskGateKey({ sessionId, toolName, toolInput });

				const entry: AskGateEntry = {
					confirmId,
					createdAt: Date.now(),
					key,
					reason: result.reason,
					hookName: result.hookName,
					toolName: result.toolName,
					inputLines: result.inputLines,
				};

				askGateByConfirmId.set(confirmId, entry);
				askGateByKey.set(key, entry);

				const reason = result.reason ? `\nReason: ${result.reason}` : "";
				const hook = result.hookName ? `\nHook: ${result.hookName}` : "";
				const tool = result.toolName
					? `\nTool: ${result.toolName}`
					: toolName
						? `\nTool: ${toolName}`
						: "";
				const inputLines = result.inputLines
					? `\nInput:\n${result.inputLines}`
					: "";

				throw new Error(
					`Blocked pending confirmation (hook asked).${hook}${tool}${reason}${inputLines}\n\nTo proceed, reply exactly: PAI_CONFIRM ${confirmId}`,
				);
			}
		},

		"tool.execute.after": async (input, output) => {
			const payload = asRecord(input);
			const out = asRecord(output);
			const { hooks: config, env } = await getSettingsPromise();

			const toolName = getString(payload, "tool") ?? "";
			const toolInput = getRecord(payload, "args") ?? {};
			const toolOutput = asRecord(output);
			const sessionId =
				getString(payload, "sessionID") ??
				getString(payload, "sessionId") ??
				"";

			const result = await executePostToolUseHooks(
				{
					sessionId,
					toolName,
					toolInput,
					toolOutput,
					cwd: process.cwd(),
					toolUseId:
						getString(payload, "callID") ?? getString(payload, "callId"),
				},
				config,
				undefined,
				env,
			);

			if (result.block) {
				throw new Error(result.reason ?? "Blocked by PostToolUse hook");
			}

			if (result.additionalContext) {
				out.additionalContext = result.additionalContext;
			}
		},
	};
}
