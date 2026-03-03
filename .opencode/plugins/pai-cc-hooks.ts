import type { Plugin } from "@opencode-ai/plugin";

const PaiCcHooksPlugin: Plugin = async (ctx) => {
	if (process.env.PAI_CC_HOOKS_DISABLED === "1") {
		return {};
	}

	const [
		{ createPaiClaudeHooks },
		{ recordBackgroundTaskLaunch },
		task,
		voice,
		output,
		cancel,
	] = await Promise.all([
		import("./pai-cc-hooks/hook"),
		import("./pai-cc-hooks/tools/background-task-state"),
		import("./pai-cc-hooks/tools/task"),
		import("./pai-cc-hooks/tools/voice-notify"),
		import("./pai-cc-hooks/tools/background-output"),
		import("./pai-cc-hooks/tools/background-cancel"),
	]);

	const hooks = createPaiClaudeHooks({ ctx });

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
		event: hooks.event,
		"chat.message": hooks["chat.message"],
		"tool.execute.before": hooks["tool.execute.before"],
		"tool.execute.after": hooks["tool.execute.after"],
	};
};

export default PaiCcHooksPlugin;
