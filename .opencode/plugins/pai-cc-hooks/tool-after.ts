import {
	executePostToolUseHooks,
	type PostToolUseResult,
} from "./claude/post-tool-use";
import type { ClaudeHooksConfig } from "./claude/types";
import { asRecord, getRecord, getString } from "./session-helpers";
import { decodeForegroundTaskParityEnvelope } from "./tools/task-foreground-parity-envelope";
import {
	findBackgroundTaskByChildSessionId as findBackgroundTaskByChildSessionIdDefault,
	recordBackgroundTaskProgressHeartbeat as recordBackgroundTaskProgressHeartbeatDefault,
} from "./tools/background-task-state";

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

type FindBackgroundTaskByChildSessionIdFn = (args: {
	childSessionId: string;
}) => Promise<{ task_id: string } | null>;

type RecordBackgroundTaskProgressHeartbeatFn = (args: {
	taskId: string;
	status?: "running" | "idle";
	counterIncrements?: {
		tools?: number;
		artifacts?: number;
		checkpoints?: number;
	};
	productive?: boolean;
}) => Promise<unknown>;

function maybeRestoreForegroundTaskParityOutput(args: {
	payload: Record<string, unknown>;
	output: Record<string, unknown>;
}): void {
	const toolName = getString(args.payload, "tool") ?? "";
	if (toolName !== "task") {
		return;
	}

	const rawOutput = getString(args.output, "output");
	if (!rawOutput) {
		return;
	}

	const decoded = decodeForegroundTaskParityEnvelope(rawOutput);
	if (!decoded) {
		return;
	}

	const existingMetadata = getRecord(args.output, "metadata") ?? {};
	args.output.title = decoded.title;
	args.output.output = decoded.output;
	args.output.metadata = {
		...existingMetadata,
		...decoded.metadata,
	};
}

async function maybeRecordBackgroundChildToolHeartbeat(args: {
	sessionId: string;
	toolName: string;
	findBackgroundTaskByChildSessionId: FindBackgroundTaskByChildSessionIdFn;
	recordBackgroundTaskProgressHeartbeat: RecordBackgroundTaskProgressHeartbeatFn;
}): Promise<void> {
	const sessionId = args.sessionId.trim();
	if (!sessionId) {
		return;
	}

	const toolName = args.toolName.trim();
	if (!toolName) {
		return;
	}
	if (toolName === "task") {
		return;
	}

	const backgroundTask = await args.findBackgroundTaskByChildSessionId({
		childSessionId: sessionId,
	});
	if (!backgroundTask?.task_id) {
		return;
	}

	await args.recordBackgroundTaskProgressHeartbeat({
		taskId: backgroundTask.task_id,
		status: "running",
		counterIncrements: {
			tools: 1,
		},
		productive: true,
	});
}

export async function handleToolExecuteAfter(args: {
	input: unknown;
	output: unknown;
	config: ClaudeHooksConfig | null;
	env?: Record<string, string>;
	cwd: string;
	deps?: {
		executePostToolUseHooks?: ExecutePostToolUseHooksFn;
		findBackgroundTaskByChildSessionId?: FindBackgroundTaskByChildSessionIdFn;
		recordBackgroundTaskProgressHeartbeat?: RecordBackgroundTaskProgressHeartbeatFn;
	};
}): Promise<void> {
	const payload = asRecord(args.input);
	const out = asRecord(args.output);
	const executePostToolUse =
		args.deps?.executePostToolUseHooks ?? executePostToolUseHooks;
	const findBackgroundTaskByChildSessionId =
		args.deps?.findBackgroundTaskByChildSessionId ??
		findBackgroundTaskByChildSessionIdDefault;
	const recordBackgroundTaskProgressHeartbeat =
		args.deps?.recordBackgroundTaskProgressHeartbeat ??
		recordBackgroundTaskProgressHeartbeatDefault;

	const toolName = getString(payload, "tool") ?? "";
	const toolInput = getRecord(payload, "args") ?? {};
	const toolOutput = asRecord(args.output);
	const sessionId =
		getString(payload, "sessionID") ?? getString(payload, "sessionId") ?? "";

	maybeRestoreForegroundTaskParityOutput({
		payload,
		output: out,
	});

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

	try {
		await maybeRecordBackgroundChildToolHeartbeat({
			sessionId,
			toolName,
			findBackgroundTaskByChildSessionId,
			recordBackgroundTaskProgressHeartbeat,
		});
	} catch {
		// Best effort by design. Tool execution must remain non-blocking.
	}

	if (result.additionalContext) {
		out.additionalContext = result.additionalContext;
	}
}
