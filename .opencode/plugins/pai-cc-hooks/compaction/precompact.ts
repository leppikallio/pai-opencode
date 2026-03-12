import type { ClaudeHooksConfig } from "../claude/types";
import { executeHookCommand } from "../shared/execute-hook-command";
import { findMatchingHooks } from "../shared/pattern-matcher";
import { applyCompactionContinuationSerializationBudget } from "./continuation-bundle";

const DEFAULT_HOOK_COMMAND_CONFIG = {
	forceZsh: process.platform !== "win32",
	zshPath: "/bin/zsh",
};

// Shared marker for precompact payload truncation across context slices.
const PRECOMPACT_TRUNCATION_MARKER = "\n[beads] output truncated";

function isDebugLoggingEnabled(): boolean {
	return process.env.PAI_CC_HOOKS_DEBUG === "1";
}

function sanitizeDebugReason(error: unknown): string {
	const reason = error instanceof Error ? error.message : String(error);
	return reason.trim().replace(/\s+/g, " ") || "unknown error";
}

function getLineCount(value: string): number {
	if (value.length === 0) {
		return 0;
	}

	return value.split("\n").length;
}

function joinSlices(args: {
	beadsContext?: string;
	continuationContext?: string;
}): string {
	const slices: string[] = [];
	if (args.beadsContext && args.beadsContext.length > 0) {
		slices.push(args.beadsContext);
	}

	if (args.continuationContext && args.continuationContext.length > 0) {
		slices.push(args.continuationContext);
	}

	return slices.join("\n");
}

function fitsCombinedBudget(args: {
	beadsContext?: string;
	continuationContext?: string;
	maxLines: number;
	maxBytes: number;
}): boolean {
	const joined = joinSlices(args);
	if (joined.length === 0) {
		return true;
	}

	return (
		getLineCount(joined) <= args.maxLines &&
		Buffer.byteLength(joined, "utf8") <= args.maxBytes
	);
}

function toStandaloneTruncationMarker(): string {
	return PRECOMPACT_TRUNCATION_MARKER.trimStart();
}

function truncateBeadsContext(args: {
	text: string;
	maxLines: number;
	maxBytes: number;
}): string {
	const { text, maxLines, maxBytes } = args;
	if (text.length === 0 || maxLines <= 0 || maxBytes <= 0) {
		return "";
	}

	if (
		getLineCount(text) <= maxLines &&
		Buffer.byteLength(text, "utf8") <= maxBytes
	) {
		return text;
	}

	let trimmed = text;
	while (
		trimmed.length > 0 &&
		(getLineCount(`${trimmed}${PRECOMPACT_TRUNCATION_MARKER}`) > maxLines ||
			Buffer.byteLength(`${trimmed}${PRECOMPACT_TRUNCATION_MARKER}`, "utf8") > maxBytes)
	) {
		trimmed = trimmed.slice(0, -1);
	}

	if (trimmed.length === 0) {
		const standalone = toStandaloneTruncationMarker();
		if (
			getLineCount(standalone) <= maxLines &&
			Buffer.byteLength(standalone, "utf8") <= maxBytes
		) {
			return standalone;
		}

		return "";
	}

	return `${trimmed.trimEnd()}${PRECOMPACT_TRUNCATION_MARKER}`;
}

function truncateContinuationContext(args: {
	text: string;
	maxLines: number;
	maxBytes: number;
}): string {
	if (args.text.length === 0 || args.maxLines <= 0 || args.maxBytes <= 0) {
		return "";
	}

	return applyCompactionContinuationSerializationBudget({
		text: args.text,
		maxLines: args.maxLines,
		maxBytes: args.maxBytes,
	});
}

function separatorCost(args: {
	left?: string;
	right?: string;
}): { lines: number; bytes: number } {
	const left = args.left ?? "";
	const right = args.right ?? "";
	if (left.length === 0 || right.length === 0) {
		return { lines: 0, bytes: 0 };
	}

	const separatorAddsLine = !left.endsWith("\n") && !right.startsWith("\n");
	return { lines: separatorAddsLine ? 1 : 0, bytes: 1 };
}

export function applyCombinedCompactionBudget(args: {
	beadsContext?: string;
	continuationContext?: string;
	maxLines: number;
	maxBytes: number;
}): {
	beadsContext?: string;
	continuationContext?: string;
} {
	let beadsContext = args.beadsContext;
	let continuationContext = args.continuationContext;

	if (
		fitsCombinedBudget({
			beadsContext,
			continuationContext,
			maxLines: args.maxLines,
			maxBytes: args.maxBytes,
		})
	) {
		return { beadsContext, continuationContext };
	}

	if (beadsContext && beadsContext.length > 0) {
		const sep = separatorCost({
			left: beadsContext,
			right: continuationContext,
		});
		const continuationLines = continuationContext
			? getLineCount(continuationContext)
			: 0;
		const continuationBytes = continuationContext
			? Buffer.byteLength(continuationContext, "utf8")
			: 0;

		const maxLinesForBeads = args.maxLines - continuationLines - sep.lines;
		const maxBytesForBeads = args.maxBytes - continuationBytes - sep.bytes;
		const standaloneMarker = toStandaloneTruncationMarker();
		const markerFitsRelativeBudget =
			maxLinesForBeads >= getLineCount(standaloneMarker) &&
			maxBytesForBeads >= Buffer.byteLength(standaloneMarker, "utf8");
		if (markerFitsRelativeBudget) {
			beadsContext = truncateBeadsContext({
				text: beadsContext,
				maxLines: maxLinesForBeads,
				maxBytes: maxBytesForBeads,
			});
		} else {
			beadsContext = truncateBeadsContext({
				text: beadsContext,
				maxLines: getLineCount(standaloneMarker),
				maxBytes: Buffer.byteLength(standaloneMarker, "utf8"),
			});
		}
	}

	if (
		fitsCombinedBudget({
			beadsContext,
			continuationContext,
			maxLines: args.maxLines,
			maxBytes: args.maxBytes,
		})
	) {
		return {
			beadsContext: beadsContext && beadsContext.length > 0 ? beadsContext : undefined,
			continuationContext:
				continuationContext && continuationContext.length > 0
					? continuationContext
					: undefined,
		};
	}

	if (continuationContext && continuationContext.length > 0) {
		const sep = separatorCost({
			left: beadsContext,
			right: continuationContext,
		});
		const beadsLines = beadsContext ? getLineCount(beadsContext) : 0;
		const beadsBytes = beadsContext ? Buffer.byteLength(beadsContext, "utf8") : 0;

		const maxLinesForContinuation = args.maxLines - beadsLines - sep.lines;
		const maxBytesForContinuation = args.maxBytes - beadsBytes - sep.bytes;

		continuationContext = truncateContinuationContext({
			text: continuationContext,
			maxLines: maxLinesForContinuation,
			maxBytes: maxBytesForContinuation,
		});
	}

	if (
		!fitsCombinedBudget({
			beadsContext,
			continuationContext,
			maxLines: args.maxLines,
			maxBytes: args.maxBytes,
		})
	) {
		if (beadsContext && beadsContext.length > 0) {
			beadsContext = truncateBeadsContext({
				text: beadsContext,
				maxLines: args.maxLines,
				maxBytes: args.maxBytes,
			});
		}

		if (continuationContext && continuationContext.length > 0) {
			const sep = separatorCost({
				left: beadsContext,
				right: continuationContext,
			});
			const beadsLines = beadsContext ? getLineCount(beadsContext) : 0;
			const beadsBytes = beadsContext
				? Buffer.byteLength(beadsContext, "utf8")
				: 0;

			const maxLinesForContinuation = args.maxLines - beadsLines - sep.lines;
			const maxBytesForContinuation = args.maxBytes - beadsBytes - sep.bytes;

			continuationContext = truncateContinuationContext({
				text: continuationContext,
				maxLines: maxLinesForContinuation,
				maxBytes: maxBytesForContinuation,
			});
		}

		if (
			!fitsCombinedBudget({
				beadsContext,
				continuationContext,
				maxLines: args.maxLines,
				maxBytes: args.maxBytes,
			})
		) {
			continuationContext = undefined;
			if (
				!fitsCombinedBudget({
					beadsContext,
					continuationContext,
					maxLines: args.maxLines,
					maxBytes: args.maxBytes,
				})
			) {
				beadsContext = undefined;
			}
		}
	}

	return {
		beadsContext: beadsContext && beadsContext.length > 0 ? beadsContext : undefined,
		continuationContext:
			continuationContext && continuationContext.length > 0
				? continuationContext
				: undefined,
	};
}

export async function executePreCompactHooks(args: {
	config: ClaudeHooksConfig | null;
	cwd: string;
	sessionId: string;
	rootSessionId: string;
	settingsEnv?: Record<string, string>;
}): Promise<string | undefined> {
	if (!args.config) {
		return undefined;
	}

	const matchers = findMatchingHooks(args.config, "PreCompact");
	if (matchers.length === 0) {
		return undefined;
	}

	const stdinData = {
		session_id: args.sessionId,
		root_session_id: args.rootSessionId,
		cwd: args.cwd,
		hook_event_name: "PreCompact",
		hook_source: "opencode-plugin",
	};

	const outputs: string[] = [];
	for (const matcher of matchers) {
		if (!matcher.hooks || matcher.hooks.length === 0) {
			continue;
		}

		for (const hook of matcher.hooks) {
			if (hook.type !== "command") {
				continue;
			}

			try {
				const result = await executeHookCommand(
					hook.command,
					JSON.stringify(stdinData),
					args.cwd,
					{
						forceZsh: DEFAULT_HOOK_COMMAND_CONFIG.forceZsh,
						zshPath: DEFAULT_HOOK_COMMAND_CONFIG.zshPath,
						env: args.settingsEnv,
					},
				);

				if (result.exitCode !== 0) {
					if (isDebugLoggingEnabled()) {
						const reason = result.stderr || result.stdout || `exit code ${result.exitCode}`;
						console.warn(
							`[pai-cc-hooks] PreCompact hook command failed: ${sanitizeDebugReason(reason)}`,
						);
					}
					continue;
				}

				if (result.stdout && result.stdout.length > 0) {
					outputs.push(result.stdout);
				}
			} catch (error) {
				if (isDebugLoggingEnabled()) {
					console.warn(
						`[pai-cc-hooks] PreCompact hook execution threw: ${sanitizeDebugReason(error)}`,
					);
				}
			}
		}
	}

	if (outputs.length === 0) {
		return undefined;
	}

	return outputs.join("\n");
}
