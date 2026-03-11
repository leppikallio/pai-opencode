import { describe, expect, test } from "bun:test";
import path from "node:path";

import { shouldAskForForegroundTask } from "../../plugins/pai-cc-hooks/claude/agent-execution-guard";
import { executePreToolUseHooks } from "../../plugins/pai-cc-hooks/claude/pre-tool-use";
import type { ClaudeHooksConfig } from "../../plugins/pai-cc-hooks/claude/types";

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
	expect(payload.executionSubagentType).toBe("general");

	return {
		prompt: prompt ?? "",
		executionSubagentType: payload.executionSubagentType ?? "",
	};
}

const EXPLICIT_NAMED_ROUTING_PROMPTS: Array<{ cue: string; prompt: string }> = [
	{
		cue: "@Architect",
		prompt:
			"Long-running architecture + research sweep, but user explicitly routed to @Architect.",
	},
	{
		cue: "@Artist",
		prompt:
			"Background-worthy art exploration, but user explicitly routed to @Artist.",
	},
	{
		cue: "@Writer",
		prompt: "Long-running writing sweep, but user explicitly routed to @Writer.",
	},
	{
		cue: "@Remy",
		prompt:
			"Long-running research sweep, but user explicitly routed to @Remy.",
	},
	{
		cue: "@Ava",
		prompt: "Long-running analysis, but user explicitly routed to @Ava.",
	},
	{
		cue: "@engineer-fast",
		prompt:
			"Long-running implementation request, but user explicitly routed to @engineer-fast.",
	},
	{
		cue: "@GrokResearcher",
		prompt:
			"Long-running social signal scan, but user explicitly routed to @GrokResearcher.",
	},
	{
		cue: "@Johannes",
		prompt:
			"Long-running social signal scan, but user explicitly routed to @Johannes.",
	},
	{
		cue: "@Remington",
		prompt:
			"Long-running technical research sweep, but user explicitly routed to @Remington.",
	},
];

const NON_ROUTABLE_OR_FILE_REFERENCE_CUES = [
	"@Architect.md",
	"@fast",
	"@reviewer",
	"@research",
];

describe("AgentExecutionGuard thresholds", () => {
	test("allows explore without ask", () => {
		expect(
			shouldAskForForegroundTask({
				subagent_type: "explore",
				prompt: "Timing: STANDARD",
			}),
		).toBe(false);
	});

	test("ordinary interactive Engineer prompt no longer auto-asks", () => {
		expect(
			shouldAskForForegroundTask({
				subagent_type: "Engineer",
				prompt: "Please draft a concise status update for this bugfix.",
			}),
		).toBe(false);
	});

	test("explicit long-running prompts ask", () => {
		expect(
			shouldAskForForegroundTask({
				subagent_type: "Engineer",
				prompt:
					"This is a long-running migration task and should run in the background.",
			}),
		).toBe(true);
	});

	test("explicit fan-out prompts ask", () => {
		expect(
			shouldAskForForegroundTask({
				subagent_type: "Engineer",
				prompt: "Fan-out this work: spawn 6 parallel subagents for codebase audit.",
			}),
		).toBe(true);
	});

	test("explicit @general and @agent mentions bypass foreground ask path", () => {
		expect(
			shouldAskForForegroundTask({
				subagent_type: "Engineer",
				prompt: "Timing: STANDARD but route this via @general.",
			}),
		).toBe(false);

		expect(
			shouldAskForForegroundTask({
				subagent_type: "Engineer",
				prompt: "Strong recommendation aside, explicit user cue says @agent.",
			}),
		).toBe(false);
	});

	test("explicit named-agent cues bypass even when advisory hints are strong", () => {
		for (const testCase of EXPLICIT_NAMED_ROUTING_PROMPTS) {
			expect(
				shouldAskForForegroundTask({
					subagent_type: "Engineer",
					prompt: testCase.prompt,
				}),
			).toBe(false);
		}
	});

	test("unknown @cue does not bypass explicit long-running ask", () => {
		expect(
			shouldAskForForegroundTask({
				subagent_type: "Engineer",
				prompt:
					"Long-running migration task and should run in the background, explicit route is @Webb.",
			}),
		).toBe(true);
	});

	test("@me does not bypass explicit long-running ask", () => {
		expect(
			shouldAskForForegroundTask({
				subagent_type: "Engineer",
				prompt:
					"Long-running migration task and should run in the background, explicit route is @me.",
			}),
		).toBe(true);
	});

	test("non-routable cue matching subagent_type does not bypass", () => {
		expect(
			shouldAskForForegroundTask({
				subagent_type: "webb",
				prompt:
					"Long-running migration task and should run in the background, explicit route is @webb.",
			}),
		).toBe(true);
	});

	test("dotted file references and non-routable base aliases do not bypass", () => {
		for (const cue of NON_ROUTABLE_OR_FILE_REFERENCE_CUES) {
			expect(
				shouldAskForForegroundTask({
					subagent_type: "Engineer",
					prompt: `Long-running migration task and should run in the background, explicit route is ${cue}.`,
				}),
			).toBe(true);
		}
	});

	test("generic background task wording alone does not trigger advisory ask", () => {
		expect(
			shouldAskForForegroundTask({
				subagent_type: "Engineer",
				prompt:
					"Please keep this as a background task while we continue discussing the foreground patch.",
			}),
		).toBe(false);
	});

	test("planner-designated background intent still triggers advisory ask", () => {
		expect(
			shouldAskForForegroundTask({
				subagent_type: "Engineer",
				prompt:
					"Planner-designated for background because this rollout runs overnight.",
			}),
		).toBe(true);
	});

	test("dynamic-composition prompts routed to native general are not mislabeled", async () => {
		const composed = await generateComposedPrompt();

		expect(
			shouldAskForForegroundTask({
				subagent_type: composed.executionSubagentType,
				prompt: composed.prompt,
			}),
		).toBe(false);
	});
});

describe("executePreToolUseHooks task foreground guard", () => {
	test("allows when run_in_background is true and no hooks match", async () => {
		const config: ClaudeHooksConfig = { PreToolUse: [] };

		const result = await executePreToolUseHooks(
			{
				sessionId: "s",
				toolName: "task",
				toolInput: {
					run_in_background: true,
					subagent_type: "Engineer",
					prompt: "Timing: STANDARD",
				},
				cwd: process.cwd(),
			},
			config,
			null,
			{},
		);

		expect(result.decision).toBe("allow");
	});

	test("ordinary interactive foreground task stays allow", async () => {
		const config: ClaudeHooksConfig = { PreToolUse: [] };

		const result = await executePreToolUseHooks(
			{
				sessionId: "s",
				toolName: "task",
				toolInput: {
					run_in_background: false,
					subagent_type: "Engineer",
					prompt: "Please provide a concise implementation summary.",
				},
				cwd: process.cwd(),
			},
			config,
			null,
			{},
		);

		expect(result.decision).toBe("allow");
	});

	test("asks for explicit fan-out foreground task", async () => {
		const config: ClaudeHooksConfig = { PreToolUse: [] };

		const result = await executePreToolUseHooks(
			{
				sessionId: "s",
				toolName: "task",
				toolInput: {
					run_in_background: false,
					subagent_type: "Engineer",
					prompt: "Fan-out this run and spawn 4 parallel subagents.",
				},
				cwd: process.cwd(),
			},
			config,
			null,
			{},
		);

		expect(result.decision).toBe("ask");
	});

	test("generic background task wording alone stays allow through PreToolUse seam", async () => {
		const config: ClaudeHooksConfig = { PreToolUse: [] };

		const result = await executePreToolUseHooks(
			{
				sessionId: "s",
				toolName: "task",
				toolInput: {
					run_in_background: false,
					subagent_type: "Engineer",
					prompt:
						"Please keep this as a background task while we continue discussing the foreground patch.",
				},
				cwd: process.cwd(),
			},
			config,
			null,
			{},
		);

		expect(result.decision).toBe("allow");
	});

	test("allows explicit @general mention through PreToolUse seam", async () => {
		const config: ClaudeHooksConfig = { PreToolUse: [] };

		const result = await executePreToolUseHooks(
			{
				sessionId: "s",
				toolName: "task",
				toolInput: {
					run_in_background: false,
					subagent_type: "Engineer",
					prompt: "Timing: STANDARD but route this via @general.",
				},
				cwd: process.cwd(),
			},
			config,
			null,
			{},
		);

		expect(result.decision).toBe("allow");
	});

	test("allows explicit named-agent cues even when prompts are background-worthy", async () => {
		const config: ClaudeHooksConfig = { PreToolUse: [] };

		for (const testCase of EXPLICIT_NAMED_ROUTING_PROMPTS) {
			const result = await executePreToolUseHooks(
				{
					sessionId: "s",
					toolName: "task",
					toolInput: {
						run_in_background: false,
						subagent_type: "Engineer",
						prompt: testCase.prompt,
					},
					cwd: process.cwd(),
				},
				config,
				null,
				{},
			);

			expect(result.decision).toBe("allow");
		}
	});

	test("asks when cue is dotted file reference or non-routable base alias", async () => {
		const config: ClaudeHooksConfig = { PreToolUse: [] };

		for (const cue of NON_ROUTABLE_OR_FILE_REFERENCE_CUES) {
			const result = await executePreToolUseHooks(
				{
					sessionId: "s",
					toolName: "task",
					toolInput: {
						run_in_background: false,
						subagent_type: "Engineer",
						prompt: `Long-running migration task and should run in the background, explicit route is ${cue}.`,
					},
					cwd: process.cwd(),
				},
				config,
				null,
				{},
			);

			expect(result.decision).toBe("ask");
		}
	});
});
