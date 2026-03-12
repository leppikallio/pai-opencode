import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import { createPaiTaskTool } from "../../plugins/pai-cc-hooks/tools/task";
import { runTaskThroughPluginSeam } from "./helpers/task-plugin-seam";

const repoRoot = path.basename(process.cwd()) === ".opencode"
	? path.resolve(process.cwd(), "..")
	: process.cwd();

async function generateComposedPrompt(): Promise<{
	prompt: string;
	executionSubagentType: string;
}> {
	const proc = Bun.spawn({
		cmd: [
			"bun",
			".opencode/skills/agents/Tools/AgentFactory.ts",
			"--traits",
			"technical,analytical,systematic",
			"--task",
			"Review task-agent routing adaptation",
			"--output",
			"json",
		],
		cwd: repoRoot,
		stdout: "pipe",
		stderr: "pipe",
	});

	const stdout = await new Response(proc.stdout).text();
	const exitCode = await proc.exited;
	expect(exitCode).toBe(0);

	const payload = JSON.parse(stdout) as {
		fullPrompt?: string;
		prompt?: string;
		executionSubagentType?: string;
	};

	const prompt = payload.fullPrompt ?? payload.prompt;
	expect(typeof prompt).toBe("string");
	expect((prompt ?? "").length).toBeGreaterThan(0);
	expect(payload.executionSubagentType).toBe("general");

	return {
		prompt: prompt ?? "",
		executionSubagentType: payload.executionSubagentType ?? "",
	};
}

describe("dynamic composition execution contract", () => {
	test("composed prompts use AgentFactory-selected execution substrate", async () => {
		const composed = await generateComposedPrompt();

		const taskTool = createPaiTaskTool({
			client: {
				session: {
					create: async () => ({ data: { id: "child-general-composed" } }),
					prompt: async () => ({
						data: { parts: [{ type: "text", text: "composed ok" }] },
					}),
				},
			},
			$: (() => Promise.resolve(null)) as unknown,
		});

		const result = await runTaskThroughPluginSeam({
			taskTool,
			taskArgs: {
				description: "Composed expert",
				prompt: composed.prompt,
				subagent_type: composed.executionSubagentType,
			},
			ctx: {
				sessionID: "parent-session-composed",
				ask: async () => ({ decision: "allow" }),
			},
		});

		expect(result.output).toContain("task_id: child-general-composed");
	});

	test("AgentFactory custom-agent guidance uses general substrate", () => {
		const skillText = readFileSync(
			path.join(repoRoot, ".opencode/skills/agents/SKILL.md"),
			"utf-8",
		);
		const workflowText = readFileSync(
			path.join(repoRoot, ".opencode/skills/agents/Workflows/CreateCustomAgent.md"),
			"utf-8",
		);
		const personalitiesText = readFileSync(
			path.join(repoRoot, ".opencode/skills/agents/AgentPersonalities.md"),
			"utf-8",
		);

		expect(skillText).toContain(
			'Task({ prompt: <agent1_prompt>, subagent_type: "general" })',
		);
		expect(workflowText).toContain('"executionSubagentType": "general"');
		expect(personalitiesText).toContain(
			'Task(prompt=<AgentFactory output>, subagent_type="general")',
		);
		expect(skillText).toContain(
			"Do not pass `model` in `Task(...)`; it is unsupported.",
		);
		expect(workflowText).toContain(
			"Let runtime policy select the model for the delegated execution.",
		);
		expect(personalitiesText).toContain(
			"Do not pass `model` in `Task(...)`; runtime policy selects it.",
		);
	});
});
