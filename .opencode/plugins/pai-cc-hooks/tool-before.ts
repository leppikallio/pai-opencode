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

	const rawOutputArgs = getRecord(out, "args");
	const normalizedOutputArgs = rawOutputArgs
		? (normalizeArgs(rawOutputArgs) as UnknownRecord)
		: undefined;
	if (normalizedOutputArgs) {
		out.args = normalizedOutputArgs;
	}

	const rawPayloadArgs = getRecord(payload, "args");
	const normalizedPayloadArgs = rawPayloadArgs
		? (normalizeArgs(rawPayloadArgs) as UnknownRecord)
		: undefined;
	if (!normalizedOutputArgs && normalizedPayloadArgs) {
		payload.args = normalizedPayloadArgs;
	}

	const toolName = getString(payload, "tool") ?? "";
	let toolInput = (normalizedOutputArgs ?? normalizedPayloadArgs ?? {}) as Record<
		string,
		unknown
	>;
	const sessionId =
		getString(payload, "sessionID") ?? getString(payload, "sessionId") ?? "";

	const rtkRewrittenInput = await maybeRewriteBashInput({
		toolName,
		toolInput,
		env: args.env,
	});
	if (rtkRewrittenInput) {
		toolInput = rtkRewrittenInput;
		out.args = rtkRewrittenInput as UnknownRecord;
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
		out.args = result.modifiedInput;
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
