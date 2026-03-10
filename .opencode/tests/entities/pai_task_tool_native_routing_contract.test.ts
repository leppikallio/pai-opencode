import { describe, expect, test } from "bun:test";

import { createPaiTaskTool } from "../../plugins/pai-cc-hooks/tools/task";
import { handleToolExecuteAfter } from "../../plugins/pai-cc-hooks/tool-after";

type ForegroundCase = {
	label: string;
	runInBackground?: boolean;
};

const FOREGROUND_CASES: ForegroundCase[] = [
	{ label: "run_in_background omitted" },
	{ label: "run_in_background false", runInBackground: false },
];

type ToolSeamOutput = {
	title: string;
	output: string;
	metadata: Record<string, unknown>;
};

async function runTaskThroughPluginSeam(args: {
	taskTool: ReturnType<typeof createPaiTaskTool>;
	taskArgs: {
		description: string;
		prompt: string;
		subagent_type: string;
		run_in_background?: boolean;
	};
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

describe("PAI task tool native-safe foreground routing contract (Task 1 RED)", () => {
	test("explicit @agent path preserves bypassAgentCheck semantics", async () => {
		let askCalls = 0;

		const taskTool = createPaiTaskTool({
			client: {
				session: {
					create: async () => ({ data: { id: "child-session-123" } }),
					prompt: async () => ({
						data: { parts: [{ type: "text", text: "assistant reply" }] },
					}),
				},
			},
			$: (() => Promise.resolve(null)) as unknown,
		});

		await taskTool.execute(
			{
				description: "Explicit mention delegation",
				prompt: "Continue with @general",
				subagent_type: "general",
			},
			{
				sessionID: "parent-session-456",
				directory: "/tmp/workspace",
				extra: { bypassAgentCheck: true },
				ask: async () => {
					askCalls += 1;
					return { decision: "allow" };
				},
			} as any,
		);

		expect(askCalls).toBe(0);
	});

	test("explicit @general mention bypasses ask through plugin task seam", async () => {
		let askCalls = 0;

		const taskTool = createPaiTaskTool({
			client: {
				session: {
					create: async () => ({ data: { id: "child-session-123" } }),
					prompt: async () => ({
						metadata: {
							model: { providerID: "openai", modelID: "gpt-5" },
						},
						data: { parts: [{ type: "text", text: "assistant reply" }] },
					}),
				},
			},
			$: (() => Promise.resolve(null)) as unknown,
		});

		const result = await runTaskThroughPluginSeam({
			taskTool,
			taskArgs: {
				description: "Explicit mention seam delegation",
				prompt: "Timing: STANDARD but user said @general continue this.",
				subagent_type: "Engineer",
			},
			ctx: {
				sessionID: "parent-session-456",
				directory: "/tmp/workspace",
				ask: async () => {
					askCalls += 1;
					return { decision: "allow" };
				},
			},
		});

		expect(askCalls).toBe(0);
		expect(result.title).toBe("Explicit mention seam delegation");
		expect((result.metadata as any).sessionId).toBe("child-session-123");
		expect(result.output).toContain("task_id: child-session-123");
	});

	test("foreground task returns stock-compatible metadata envelope", async () => {
		const expectedModel = {
			providerID: "openai",
			modelID: "gpt-5",
		};

		const taskTool = createPaiTaskTool({
			client: {
				session: {
					create: async () => ({ data: { id: "child-session-123" } }),
					prompt: async () => ({
						metadata: { model: expectedModel },
						data: { parts: [{ type: "text", text: "assistant reply" }] },
					}),
				},
			},
			$: (() => Promise.resolve(null)) as unknown,
		});

		const result = await runTaskThroughPluginSeam({
			taskTool,
			taskArgs: {
				description: "Run subagent",
				prompt: "Do the thing",
				subagent_type: "Engineer",
			},
			ctx: {
				sessionID: "parent-session-456",
				directory: "/tmp/workspace",
				ask: async () => ({ decision: "allow" }),
			},
		});

		expect(result.title).toBe("Run subagent");
		expect((result.metadata as any).sessionId).toBe("child-session-123");
		expect((result.metadata as any).model).toEqual(expectedModel);
		expect(typeof result.output).toBe("string");
		expect(result.output).toContain("task_id: child-session-123");
	});

	test("foreground launch preserves nested prompt-part resolution expectations", async () => {
		let promptPayload: unknown;

		const taskTool = createPaiTaskTool({
			client: {
				session: {
					create: async () => ({ data: { id: "child-session-123" } }),
					prompt: async (payload: unknown) => {
						promptPayload = payload;
						return { data: { parts: [{ type: "text", text: "assistant reply" }] } };
					},
				},
			},
			$: (() => Promise.resolve(null)) as unknown,
		});

		await taskTool.execute(
			{
				description: "Run nested references",
				prompt: "Use @general and inspect @README.md before responding",
				subagent_type: "Engineer",
			},
			{
				sessionID: "parent-session-456",
				directory: "/tmp/workspace",
				ask: async () => ({ decision: "allow" }),
			} as any,
		);

		const parts = (promptPayload as { body?: { parts?: Array<{ type?: string }> } })
			.body?.parts;
		expect(Array.isArray(parts)).toBe(true);
		expect((parts ?? []).some((part) => part.type === "agent")).toBe(true);
		expect((parts ?? []).some((part) => part.type === "file")).toBe(true);
	});

	test("background extension does not alter foreground defaults", async () => {
		for (const foregroundCase of FOREGROUND_CASES) {
			const launchRecords: unknown[] = [];

			const taskTool = createPaiTaskTool({
				client: {
					session: {
						create: async () => ({ data: { id: "child-session-123" } }),
						prompt: async () => ({
							metadata: {
								model: { providerID: "openai", modelID: "gpt-5-mini" },
							},
							data: { parts: [{ type: "text", text: "assistant reply" }] },
						}),
					},
				},
				$: (() => Promise.resolve(null)) as unknown,
				recordBackgroundTaskLaunch: async (args) => {
					launchRecords.push(args);
				},
			});

			const args: {
				description: string;
				prompt: string;
				subagent_type: string;
				run_in_background?: boolean;
			} = {
				description: `Foreground contract (${foregroundCase.label})`,
				prompt: "Do the thing",
				subagent_type: "Engineer",
			};

			if (foregroundCase.runInBackground !== undefined) {
				args.run_in_background = foregroundCase.runInBackground;
			}

			const result = await runTaskThroughPluginSeam({
				taskTool,
				taskArgs: args,
				ctx: {
					sessionID: "parent-session-456",
					directory: "/tmp/workspace",
					ask: async () => ({ decision: "allow" }),
				},
			});

			expect(launchRecords).toHaveLength(0);
			expect(typeof result).toBe("object");
			expect((result.metadata as any).model).toEqual({
				providerID: "openai",
				modelID: "gpt-5-mini",
			});
			expect(result.output).toContain("task_id: child-session-123");
		}
	});
});
