import type { Plugin } from "@opencode-ai/plugin";

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
	return typeof value === "object" && value !== null ? (value as UnknownRecord) : {};
}

function getRecord(obj: UnknownRecord, key: string): UnknownRecord {
	return asRecord(obj[key]);
}

function getString(obj: UnknownRecord, key: string): string {
	const value = obj[key];
	return typeof value === "string" ? value : "";
}

function getSessionIdFromEventInput(input: unknown): string {
	const payload = asRecord(input);
	const event = getRecord(payload, "event");

	const extract = (eventPayload: UnknownRecord): string => {
		if (getString(eventPayload, "type") !== "session.deleted") {
			return "";
		}

		const properties = getRecord(eventPayload, "properties");
		const info = getRecord(properties, "info");

		return (
			getString(properties, "sessionID") ||
			getString(properties, "sessionId") ||
			getString(info, "sessionID") ||
			getString(info, "sessionId") ||
			getString(info, "id") ||
			getString(eventPayload, "sessionID") ||
			getString(eventPayload, "sessionId")
		);
	};

	return extract(event) || extract(payload);
}

const PaiCcHooksPlugin: Plugin = async (ctx) => {
	if (process.env.PAI_CC_HOOKS_DISABLED === "1") {
		return {};
	}

	const [
		{ createPaiClaudeHooks },
		{ createPromptControl },
		{ recordBackgroundTaskLaunch },
		task,
		voice,
		output,
		cancel,
	] = await Promise.all([
		import("./pai-cc-hooks/hook"),
		import("./pai-cc-hooks/prompt-control"),
		import("./pai-cc-hooks/tools/background-task-state"),
		import("./pai-cc-hooks/tools/task"),
		import("./pai-cc-hooks/tools/voice-notify"),
		import("./pai-cc-hooks/tools/background-output"),
		import("./pai-cc-hooks/tools/background-cancel"),
	]);

	const hooks = createPaiClaudeHooks({ ctx });
	const ctxDir = getString(asRecord(ctx), "directory");
	const projectDir = process.env.OPENCODE_DIRECTORY ?? (ctxDir || process.cwd());
	const promptControl = createPromptControl({ projectDir });

	const event: typeof hooks.event = async (input) => {
		try {
			promptControl.pruneStale();
		} catch {
			// Fail-open by design.
		}

		try {
			const sessionID = getSessionIdFromEventInput(input);
			if (sessionID) {
				promptControl.onSessionDeleted(sessionID);
			}
		} catch {
			// Fail-open by design.
		}

		await hooks.event(input);
	};

	return {
		tool: {
			task: task.createPaiTaskTool({
				client: ctx.client,
				$: ctx.$,
				recordBackgroundTaskLaunch,
			}),
			voice_notify: voice.createPaiVoiceNotifyTool({
				client: ctx.client,
			}),
			background_output: output.createPaiBackgroundOutputTool({
				client: ctx.client,
			}),
			background_cancel: cancel.createPaiBackgroundCancelTool({
				client: ctx.client,
			}),
		},
		event,
		"chat.message": hooks["chat.message"],
		"chat.params": promptControl.chatParams,
		"experimental.chat.system.transform": promptControl.systemTransform,
		"tool.execute.before": hooks["tool.execute.before"],
		"tool.execute.after": hooks["tool.execute.after"],
	};
};

export default PaiCcHooksPlugin;
