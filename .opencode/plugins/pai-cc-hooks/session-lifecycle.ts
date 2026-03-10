import type {
	ClaudeHooksConfig,
	SessionEndInput,
	SessionStartInput,
} from "./claude/types";
import {
	asRecord,
	getParentSessionIdFromEvent,
	getRecord,
} from "./session-helpers";
import { executeHookCommand } from "./shared/execute-hook-command";
import { findMatchingHooks } from "./shared/pattern-matcher";
import type {
	SessionGetFn,
	SessionLifecycleEventName,
	SessionPromptAsyncFn,
	SessionStartPolicy,
} from "./types";

const DEFAULT_HOOK_COMMAND_CONFIG = {
	forceZsh: process.platform !== "win32",
	zshPath: "/bin/zsh",
};

function isDebugLoggingEnabled(): boolean {
	return process.env.PAI_CC_HOOKS_DEBUG === "1";
}

function sanitizeDebugReason(error: unknown): string {
	const reason = error instanceof Error ? error.message : String(error);
	return reason.trim().replace(/\s+/g, " ") || "unknown error";
}

function isLoadContextHookCommand(command: string): boolean {
	return command.includes("LoadContext.hook.ts");
}

function isScratchpadBindingHookCommand(command: string): boolean {
	return command.includes("ScratchpadBinding.hook.ts");
}

function isRtkAwarenessHookCommand(command: string): boolean {
	return command.includes("RtkAwareness.hook.ts");
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

	if (isRtkAwarenessHookCommand(args.command)) {
		return args.policy.allowRtkAwarenessStdoutInjection;
	}

	return false;
}

export async function resolveSessionStartPolicy(args: {
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
				allowRtkAwarenessStdoutInjection: true,
			},
		};
	}

	try {
		const session = asRecord(await args.sessionGet({ path: { id: args.sessionId } }));
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
				allowRtkAwarenessStdoutInjection: true,
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
				allowRtkAwarenessStdoutInjection: true,
			},
		};
	}
}

export async function executeSessionLifecycleHooks(
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

			if (result.exitCode !== 0 && isDebugLoggingEnabled()) {
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
