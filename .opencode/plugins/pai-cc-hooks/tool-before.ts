import { normalizeSecurityInputArgs } from "../security";
import {
	createAskGateEntry,
	consumeAskGateOneShotAllowance,
	formatAskGateBlockedMessage,
} from "./ask-gate";
import {
	executePreToolUseHooks,
	type PreToolUseResult,
} from "./claude/pre-tool-use";
import { maybeRewriteBashToolInputWithRtk } from "./rtk";
import type { ClaudeHooksConfig } from "./claude/types";
import { asRecord, getRecord, getString } from "./session-helpers";
import type { UnknownRecord } from "./types";

type ExecutePreToolUseHooksFn = (
	ctx: {
		sessionId: string;
		toolName: string;
		toolInput: Record<string, unknown>;
		cwd: string;
		toolUseId?: string;
	},
	config: ClaudeHooksConfig | null,
	extendedConfig?: unknown,
	settingsEnv?: Record<string, string>,
) => Promise<PreToolUseResult>;

type NormalizeSecurityInputArgsFn = (value: unknown) => unknown;
type MaybeRewriteBashToolInputWithRtkFn = (args: {
	toolName: string;
	toolInput: Record<string, unknown>;
	env?: Record<string, string>;
}) => Promise<Record<string, unknown> | null>;

function replaceArgsObject(target: Record<string, unknown>, next: Record<string, unknown>) {
	if (target === next) {
		return;
	}

	for (const key of Object.keys(target)) {
		delete target[key];
	}

	Object.assign(target, next);
}

export async function handleToolExecuteBefore(args: {
	input: unknown;
	output: unknown;
	config: ClaudeHooksConfig | null;
	env?: Record<string, string>;
	cwd: string;
	deps?: {
		executePreToolUseHooks?: ExecutePreToolUseHooksFn;
		normalizeSecurityInputArgs?: NormalizeSecurityInputArgsFn;
		maybeRewriteBashToolInputWithRtk?: MaybeRewriteBashToolInputWithRtkFn;
	};
}): Promise<void> {
	const payload = asRecord(args.input);
	const out = asRecord(args.output);
	const executePreToolUse =
		args.deps?.executePreToolUseHooks ?? executePreToolUseHooks;
	const normalizeArgs =
		args.deps?.normalizeSecurityInputArgs ?? normalizeSecurityInputArgs;
	const maybeRewriteBashInput =
		args.deps?.maybeRewriteBashToolInputWithRtk ??
		maybeRewriteBashToolInputWithRtk;

	const hasOutputArgs = typeof out.args === "object" && out.args !== null;
	const rawOutputArgs = getRecord(out, "args") as UnknownRecord;
	const normalizedOutputArgs = hasOutputArgs
		? (normalizeArgs(rawOutputArgs) as UnknownRecord)
		: undefined;
	if (hasOutputArgs && normalizedOutputArgs) {
		replaceArgsObject(rawOutputArgs, normalizedOutputArgs);
		out.args = rawOutputArgs;
	}

	const hasPayloadArgs = typeof payload.args === "object" && payload.args !== null;
	const rawPayloadArgs = getRecord(payload, "args") as UnknownRecord;
	const normalizedPayloadArgs = hasPayloadArgs
		? (normalizeArgs(rawPayloadArgs) as UnknownRecord)
		: undefined;
	if (!normalizedOutputArgs && hasPayloadArgs && normalizedPayloadArgs) {
		replaceArgsObject(rawPayloadArgs, normalizedPayloadArgs);
		payload.args = rawPayloadArgs;
	}

	const toolName = getString(payload, "tool") ?? "";
	let toolInput = (rawOutputArgs ?? rawPayloadArgs ?? {}) as Record<
		string,
		unknown
	>;
	const sessionId =
		getString(payload, "sessionID") ?? getString(payload, "sessionId") ?? "";
	const applyArgsUpdate = (next: Record<string, unknown>) => {
		if (hasOutputArgs) {
			replaceArgsObject(rawOutputArgs, next);
			out.args = rawOutputArgs;
			toolInput = rawOutputArgs;
			return;
		}

		if (hasPayloadArgs) {
			replaceArgsObject(rawPayloadArgs, next);
			payload.args = rawPayloadArgs;
			toolInput = rawPayloadArgs;
			return;
		}

		toolInput = next;
		out.args = next as UnknownRecord;
	};

	const rtkRewrittenInput = await maybeRewriteBashInput({
		toolName,
		toolInput,
		env: args.env,
	});
	if (rtkRewrittenInput) {
		applyArgsUpdate(rtkRewrittenInput);
	}

	if (sessionId && toolName) {
		const oneShotAllowed = consumeAskGateOneShotAllowance({
			sessionId,
			toolName,
			toolInput,
		});
		if (oneShotAllowed) {
			return;
		}
	}

	const result = await executePreToolUse(
		{
			sessionId,
			toolName,
			toolInput,
			cwd: args.cwd,
			toolUseId:
				getString(payload, "callID") ?? getString(payload, "callId"),
		},
		args.config,
		undefined,
		args.env,
	);

	if (result.modifiedInput) {
		applyArgsUpdate(result.modifiedInput);
	}

	if (result.decision === "deny") {
		throw new Error(result.reason ?? "Blocked by PreToolUse hook");
	}

	if (result.decision === "ask") {
		const entry = createAskGateEntry({
			sessionId,
			toolName,
			toolInput,
			reason: result.reason,
			hookName: result.hookName,
			resolvedToolName: result.toolName,
			inputLines: result.inputLines,
		});

		throw new Error(
			formatAskGateBlockedMessage({
				confirmId: entry.confirmId,
				reason: result.reason,
				hookName: result.hookName,
				resolvedToolName: result.toolName,
				fallbackToolName: toolName,
				inputLines: result.inputLines,
			}),
		);
	}
}
