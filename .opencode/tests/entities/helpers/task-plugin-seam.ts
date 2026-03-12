import { expect } from "bun:test";

import type { createPaiTaskTool } from "../../../plugins/pai-cc-hooks/tools/task";
import { handleToolExecuteAfter } from "../../../plugins/pai-cc-hooks/tool-after";

type TaskToolArgs = {
	description: string;
	prompt: string;
	subagent_type: string;
	task_id?: string;
	run_in_background?: boolean;
};

export type ToolSeamOutput = {
	title: string;
	output: string;
	metadata: Record<string, unknown>;
};

export async function runTaskThroughPluginSeam(args: {
	taskTool: ReturnType<typeof createPaiTaskTool>;
	taskArgs: TaskToolArgs;
	ctx: Record<string, unknown>;
}): Promise<ToolSeamOutput> {
	const seamResult = await args.taskTool.execute(args.taskArgs, args.ctx as any);
	expect(typeof seamResult).toBe("string");

	const seamOutput: ToolSeamOutput = {
		title: "",
		output: seamResult,
		metadata: {
			truncated: false,
			outputPath: undefined,
		},
	};

	await handleToolExecuteAfter({
		input: {
			tool: "task",
			sessionID:
				typeof args.ctx.sessionID === "string"
					? args.ctx.sessionID
					: typeof args.ctx.sessionId === "string"
						? args.ctx.sessionId
						: "",
			callID: "call-task",
			args: args.taskArgs,
		},
		output: seamOutput,
		config: null,
		cwd: process.cwd(),
	});

	return seamOutput;
}
