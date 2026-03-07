import {
	executePostToolUseHooks,
	type PostToolUseResult,
} from "./claude/post-tool-use";
import type { ClaudeHooksConfig } from "./claude/types";
import { asRecord, getRecord, getString } from "./session-helpers";

type ExecutePostToolUseHooksFn = (
	ctx: {
		sessionId: string;
		toolName: string;
		toolInput: Record<string, unknown>;
		toolOutput: Record<string, unknown>;
		cwd: string;
		toolUseId?: string;
	},
	config: ClaudeHooksConfig | null,
	extendedConfig?: unknown,
	settingsEnv?: Record<string, string>,
) => Promise<PostToolUseResult>;

export async function handleToolExecuteAfter(args: {
	input: unknown;
	output: unknown;
	config: ClaudeHooksConfig | null;
	env?: Record<string, string>;
	cwd: string;
	deps?: {
		executePostToolUseHooks?: ExecutePostToolUseHooksFn;
	};
}): Promise<void> {
	const payload = asRecord(args.input);
	const out = asRecord(args.output);
	const executePostToolUse =
		args.deps?.executePostToolUseHooks ?? executePostToolUseHooks;

	const toolName = getString(payload, "tool") ?? "";
	const toolInput = getRecord(payload, "args") ?? {};
	const toolOutput = asRecord(args.output);
	const sessionId =
		getString(payload, "sessionID") ?? getString(payload, "sessionId") ?? "";

	const result = await executePostToolUse(
		{
			sessionId,
			toolName,
			toolInput,
			toolOutput,
			cwd: args.cwd,
			toolUseId:
				getString(payload, "callID") ?? getString(payload, "callId"),
		},
		args.config,
		undefined,
		args.env,
	);

	if (result.block) {
		throw new Error(result.reason ?? "Blocked by PostToolUse hook");
	}

	if (result.additionalContext) {
		out.additionalContext = result.additionalContext;
	}
}
