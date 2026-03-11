import { describe, expect, test } from "bun:test";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

const repoRoot = path.basename(process.cwd()) === ".opencode"
	? path.resolve(process.cwd(), "..")
	: process.cwd();
const hookCommandPath = path.join(
	repoRoot,
	".opencode/hooks/AgentExecutionGuard.hook.ts",
);

const EXPLICIT_NAMED_ROUTING_CUES = [
	"@Remy",
	"@Ava",
	"@engineer-fast",
	"@GrokResearcher",
	"@Johannes",
	"@Remington",
];

const NON_ROUTABLE_OR_FILE_REFERENCE_CUES = [
	"@Architect.md",
	"@fast",
	"@reviewer",
	"@research",
];

type HookPayload = {
	tool_name?: string;
	tool_input?: Record<string, unknown>;
};

async function runHook(payload: HookPayload): Promise<{
	exitCode: number;
	stderr: string;
	stdout: string;
}> {
	const proc = Bun.spawn({
		cmd: ["bun", ".opencode/hooks/AgentExecutionGuard.hook.ts"],
		cwd: repoRoot,
		stdin: "pipe",
		stdout: "pipe",
		stderr: "pipe",
	});

	proc.stdin.write(JSON.stringify(payload));
	proc.stdin.end();

	const stdout = await new Response(proc.stdout).text();
	const stderr = await new Response(proc.stderr).text();
	const exitCode = await proc.exited;

	return { exitCode, stderr, stdout };
}

async function runHookAsDirectCommand(payload: HookPayload): Promise<{
	exitCode: number;
	stderr: string;
	stdout: string;
}> {
	const proc = Bun.spawn({
		cmd: [hookCommandPath],
		cwd: repoRoot,
		stdin: "pipe",
		stdout: "pipe",
		stderr: "pipe",
	});

	proc.stdin.write(JSON.stringify(payload));
	proc.stdin.end();

	const stdout = await new Response(proc.stdout).text();
	const stderr = await new Response(proc.stderr).text();
	const exitCode = await proc.exited;

	return { exitCode, stderr, stdout };
}

describe("AgentExecutionGuard hook port", () => {
	test("settings direct-command contract keeps hook executable", async () => {
		if (process.platform === "win32") {
			return;
		}

		const settingsJson = readFileSync(
			path.join(repoRoot, ".opencode/settings.json"),
			"utf-8",
		);
		expect(settingsJson).toContain(
			'"command": "${PAI_DIR}/hooks/AgentExecutionGuard.hook.ts"',
		);

		const mode = statSync(hookCommandPath).mode;
		expect((mode & 0o111) !== 0).toBe(true);

		const result = await runHookAsDirectCommand({
			tool_name: "Task",
			tool_input: {
				run_in_background: false,
				subagent_type: "Engineer",
				prompt: "Please provide a concise summary.",
			},
		});

		expect(result.exitCode).toBe(0);
		expect(result.stderr).toBe("");
		expect(result.stdout).toBe("");
	});

	test("generic foreground Engineer task no longer gets blanket warning", async () => {
		const result = await runHook({
			tool_name: "Task",
			tool_input: {
				run_in_background: false,
				subagent_type: "Engineer",
				description: "implementation task",
				prompt: "Please review this small routing patch and summarize.",
			},
		});

		expect(result.exitCode).toBe(0);
		expect(result.stderr).toBe("");
		expect(result.stdout).toBe("");
	});

	test("advertised and rostered named-agent cues bypass hook reminder", async () => {
		for (const cue of EXPLICIT_NAMED_ROUTING_CUES) {
			const result = await runHook({
				tool_name: "Task",
				tool_input: {
					run_in_background: false,
					subagent_type: "Engineer",
					description: `named cue ${cue}`,
					prompt: `Long-running sweep, but explicit user route is ${cue}.`,
				},
			});

			expect(result.exitCode).toBe(0);
			expect(result.stderr).toBe("");
			expect(result.stdout).toBe("");
		}
	});

	test("explicit long-running task still gets background recommendation", async () => {
		const result = await runHook({
			tool_name: "Task",
			tool_input: {
				run_in_background: false,
				subagent_type: "Engineer",
				description: "long-running migration",
				prompt:
					"This is a long-running migration task and should run in the background.",
			},
		});

		expect(result.exitCode).toBe(0);
		expect(result.stderr).toBe("");
		expect(result.stdout).toContain("<system-reminder>");
		expect(result.stdout).toContain("run_in_background");
	});

	test("explicit fan-out task still gets background recommendation", async () => {
		const result = await runHook({
			tool_name: "Task",
			tool_input: {
				run_in_background: false,
				subagent_type: "Engineer",
				description: "fan-out implementation",
				prompt: "Fan-out this work: launch 5 parallel subagents for implementation.",
			},
		});

		expect(result.exitCode).toBe(0);
		expect(result.stderr).toBe("");
		expect(result.stdout).toContain("<system-reminder>");
		expect(result.stdout).toContain("run_in_background");
	});

	test("explicit named-agent routing cue still wins over advisory hints", async () => {
		const result = await runHook({
			tool_name: "Task",
			tool_input: {
				run_in_background: false,
				subagent_type: "Engineer",
				description: "architect handoff",
				prompt:
					"Long-running architecture research request, but explicit user route is @Architect.",
			},
		});

		expect(result.exitCode).toBe(0);
		expect(result.stderr).toBe("");
		expect(result.stdout).toBe("");
	});

	test("explicit @Artist routing cue bypasses hook reminder", async () => {
		const result = await runHook({
			tool_name: "Task",
			tool_input: {
				run_in_background: false,
				subagent_type: "Engineer",
				description: "artist handoff",
				prompt: "Long-running art exploration, but explicit user route is @Artist.",
			},
		});

		expect(result.exitCode).toBe(0);
		expect(result.stderr).toBe("");
		expect(result.stdout).toBe("");
	});

	test("non-routable and dotted-file cues do not bypass hook reminder", async () => {
		for (const cue of NON_ROUTABLE_OR_FILE_REFERENCE_CUES) {
			const result = await runHook({
				tool_name: "Task",
				tool_input: {
					run_in_background: false,
					subagent_type: "Engineer",
					description: `non-routable cue ${cue}`,
					prompt: `Long-running migration task and should run in the background, explicit route is ${cue}.`,
				},
			});

			expect(result.exitCode).toBe(0);
			expect(result.stderr).toBe("");
			expect(result.stdout).toContain("<system-reminder>");
			expect(result.stdout).toContain("run_in_background");
		}
	});

	test("stays silent when run_in_background is true", async () => {
		const result = await runHook({
			tool_name: "Task",
			tool_input: {
				run_in_background: true,
				subagent_type: "Engineer",
				prompt: "Fan-out this work: launch 5 parallel subagents.",
			},
		});

		expect(result.exitCode).toBe(0);
		expect(result.stderr).toBe("");
		expect(result.stdout).toBe("");
	});

	test("stays silent when payload is missing tool_name", async () => {
		const result = await runHook({
			tool_input: {
				run_in_background: false,
				subagent_type: "Engineer",
				prompt: "Fan-out this work: launch 5 parallel subagents.",
			},
		});

		expect(result.exitCode).toBe(0);
		expect(result.stderr).toBe("");
		expect(result.stdout).toBe("");
	});
});
