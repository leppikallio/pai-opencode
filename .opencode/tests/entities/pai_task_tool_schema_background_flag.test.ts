import { beforeEach, describe, expect, test } from "bun:test";

import { createPaiTaskTool } from "../../plugins/pai-cc-hooks/tools/task";
import type { RecordBackgroundTaskLaunchArgs } from "../../plugins/pai-cc-hooks/tools/background-task-state";
import { PAI_ORCHESTRATION_FEATURE_FLAG_ENV_KEYS } from "../../plugins/pai-cc-hooks/feature-flags";
import { handleToolExecuteAfter } from "../../plugins/pai-cc-hooks/tool-after";
import {
	__resetSessionRootRegistryForTests,
	getSessionRootId,
	setSessionRootId,
} from "../../plugins/pai-cc-hooks/shared/session-root";

function restoreEnv(key: string, previousValue: string | undefined): void {
	if (previousValue === undefined) {
		delete process.env[key];
		return;
	}

	process.env[key] = previousValue;
}

function expectFinitePositiveNumber(value: unknown): number {
	expect(typeof value).toBe("number");
	expect(Number.isFinite(value)).toBe(true);
	expect((value as number) > 0).toBe(true);
	return value as number;
}

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
		task_id?: string;
		run_in_background?: boolean;
		task_kind?: "review" | "generic";
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

describe("PAI task tool override", () => {
	beforeEach(() => {
		__resetSessionRootRegistryForTests();
	});

	test("foreground parity feature flag ON path survives real plugin tool seam", async () => {
		const key =
			PAI_ORCHESTRATION_FEATURE_FLAG_ENV_KEYS.paiOrchestrationForegroundParityEnabled;
		const previous = process.env[key];

		try {
			process.env[key] = "1";

			const taskTool = createPaiTaskTool({
				client: {
					session: {
						create: async () => ({ data: { id: "child-session-flag-on" } }),
						prompt: async () => ({
							metadata: { model: { providerID: "openai", modelID: "gpt-5" } },
							data: { parts: [{ type: "text", text: "parity reply" }] },
						}),
					},
				},
				$: (() => Promise.resolve(null)) as unknown,
			});

			const result = await runTaskThroughPluginSeam({
				taskTool,
				taskArgs: {
					description: "Flag on behavior",
					prompt: "Continue",
					subagent_type: "Engineer",
				},
				ctx: {
					sessionID: "parent-session-456",
					ask: async () => ({ decision: "allow" }),
				},
			});

			expect(result.title).toBe("Flag on behavior");
			expect((result.metadata as any).sessionId).toBe("child-session-flag-on");
			expect((result.metadata as any).model).toEqual({
				providerID: "openai",
				modelID: "gpt-5",
			});
			expect(result.output).toContain("task_id: child-session-flag-on");
		} finally {
			restoreEnv(key, previous);
		}
	});

	 test("exposes run_in_background boolean zod schema", () => {
    const taskTool = createPaiTaskTool({
      client: {},
      $: (() => Promise.resolve(null)) as unknown,
    });

    expect(taskTool.args.run_in_background.safeParse(true).success).toBe(true);
    expect(taskTool.args.run_in_background.safeParse(false).success).toBe(true);
    expect(taskTool.args.run_in_background.safeParse("true").success).toBe(false);

		expect(taskTool.args).toHaveProperty("task_kind");
		expect((taskTool.args as any).task_kind.safeParse("review").success).toBe(
			true,
		);
		expect((taskTool.args as any).task_kind.safeParse("generic").success).toBe(
			true,
		);
		expect((taskTool.args as any).task_kind.safeParse("Review").success).toBe(
			false,
		);
		expect((taskTool.args as any).task_kind.safeParse(undefined).success).toBe(
			true,
		);

    expect(taskTool.args.command.safeParse("/check-file path/to/file").success).toBe(true);
    expect(taskTool.args.command.safeParse(undefined).success).toBe(true);
    expect(taskTool.args.command.safeParse(42).success).toBe(false);
  });

  test("background task returns string output (tool contract)", async () => {
    const taskTool = createPaiTaskTool({
      client: {
        session: {
          create: async () => ({ data: { id: "child-session-123" } }),
          prompt: async () => ({ data: { parts: [{ type: "text", text: "unused" }] } }),
          promptAsync: async () => ({ data: true }),
        },
      },
      $: (() => Promise.resolve(null)) as unknown,
      recordBackgroundTaskLaunch: async () => {},
    });

		const res = await taskTool.execute(
      {
        description: "Run subagent",
        prompt: "Do the thing",
        subagent_type: "Engineer",
        run_in_background: true,
				task_kind: "review",
			} as any,
      {
        sessionID: "parent-session-456",
        directory: "/tmp/workspace",
      } as any,
    );

    expect(typeof res).toBe("string");
    expect(res).toContain("Background task launched");
    expect(res).toContain("Task ID:");
    expect(res).toContain("Session ID:");
		expect(res).toContain("Task kind: review");
		expect(res).toContain("Expected quiet window:");
		expect(res).toContain("Minimum tenancy:");
		expect(res).toContain("Salvage on cancel: required");
  });

	 test("launches background task when run_in_background is true", async () => {
    const calls: Array<{ method: string; payload: unknown }> = [];
		const launchRecords: RecordBackgroundTaskLaunchArgs[] = [];

    const taskTool = createPaiTaskTool({
      client: {
        session: {
          create: async (payload: unknown) => {
            calls.push({ method: "create", payload });
            return { data: { id: "child-session-123" } };
          },
          prompt: async (payload: unknown) => {
            calls.push({ method: "prompt", payload });
            return { data: { parts: [{ type: "text", text: "unused" }] } };
          },
        },
      },
      $: (() => Promise.resolve(null)) as unknown,
      recordBackgroundTaskLaunch: async (args) => {
        launchRecords.push(args);
      },
    });

		setSessionRootId("parent-session-456", "root-session-999");
		const result = await taskTool.execute(
			{
				description: "Run subagent",
				prompt: "Do the thing",
				subagent_type: "Engineer",
				run_in_background: true,
				task_kind: "review",
			} as any,
			{
				sessionID: "parent-session-456",
				directory: "/tmp/workspace",
			} as any,
		);

    expect(typeof result).toBe("string");
    expect(result).toContain("Background task launched");
    expect(result).toContain("Task ID: bg_child-session-123");
    expect(result).toContain("Session ID: child-session-123");
    expect(calls.map((entry) => entry.method)).toEqual(["create", "prompt"]);
		expect(launchRecords).toHaveLength(1);
		expect(launchRecords[0]).toMatchObject({
			taskId: "bg_child-session-123",
			taskDescription: "Run subagent",
			childSessionId: "child-session-123",
			parentSessionId: "parent-session-456",
		});
		expect((launchRecords[0] as any)?.taskKind).toBe("review");
		expectFinitePositiveNumber((launchRecords[0] as any)?.expectedQuietWindowMs);
		expectFinitePositiveNumber((launchRecords[0] as any)?.minimumTenancyMs);
		expect((launchRecords[0] as any)?.cancelPolicy).toBe("salvage-first");
		expect((launchRecords[0] as any)?.salvageOnCancelRequired).toBe(true);
		expect(getSessionRootId("child-session-123")).toBe("root-session-999");
	 });

	test("foreground defaults stay stock-compatible when background flag is omitted or false (Task 1 RED)", async () => {
		const cases: Array<{ label: string; runInBackground?: boolean }> = [
			{ label: "omitted" },
			{ label: "false", runInBackground: false },
		];

		for (const testCase of cases) {
			const calls: Array<{ method: string; payload: unknown }> = [];
			const launchRecords: Array<unknown> = [];

			setSessionRootId("parent-session-456", "root-session-999");

			const taskTool = createPaiTaskTool({
				client: {
					session: {
						create: async (payload: unknown) => {
							calls.push({ method: "create", payload });
							return { data: { id: "child-session-123" } };
						},
						prompt: async (payload: unknown) => {
							calls.push({ method: "prompt", payload });
							return { data: { parts: [{ type: "text", text: "assistant reply" }] } };
						},
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
				description: `Run subagent (${testCase.label})`,
				prompt: "Do the thing",
				subagent_type: "Engineer",
			};

			if (testCase.runInBackground !== undefined) {
				args.run_in_background = testCase.runInBackground;
			}

			const result = await runTaskThroughPluginSeam({
				taskTool,
				taskArgs: args,
				ctx: {
					ask: async (payload: unknown) => {
						calls.push({ method: "ask", payload });
						return { decision: "allow" };
					},
					sessionID: "parent-session-456",
				},
			});

			expect(launchRecords).toHaveLength(0);
			expect(typeof result).toBe("object");
			expect(result.title).toBe(`Run subagent (${testCase.label})`);
			expect((result.metadata as any).sessionId).toBe("child-session-123");
			expect(result.output).toContain("task_id: child-session-123");

			expect(calls.map((entry) => entry.method)).toEqual(["ask", "create", "prompt"]);
			expect(getSessionRootId("child-session-123")).toBe("root-session-999");
		}
	});

	test("resumes task_id via session.get and skips create", async () => {
		const calls: Array<{ method: string; payload: unknown }> = [];

		const taskTool = createPaiTaskTool({
      client: {
        session: {
          get: async (payload: unknown) => {
            calls.push({ method: "get", payload });
            return { data: { id: "existing-child-456" } };
          },
          create: async (payload: unknown) => {
            calls.push({ method: "create", payload });
            return { data: { id: "new-child-should-not-be-used" } };
          },
          prompt: async (payload: unknown) => {
            calls.push({ method: "prompt", payload });
            return { data: { parts: [{ type: "text", text: "resumed reply" }] } };
          },
        },
      },
      $: (() => Promise.resolve(null)) as unknown,
    });

		const result = await runTaskThroughPluginSeam({
			taskTool,
			taskArgs: {
				description: "Resume subagent",
				prompt: "Continue",
				subagent_type: "Engineer",
				task_id: "requested-task-id",
			},
			ctx: {
				ask: async (payload: unknown) => {
					calls.push({ method: "ask", payload });
					return { decision: "allow" };
				},
			},
		});

		expect(typeof result).toBe("object");
		expect((result.metadata as any).sessionId).toBe("existing-child-456");
		expect(result.output).toContain("task_id: existing-child-456");
		expect(result.output).toContain(
			"<task_result>resumed reply</task_result>",
		);
		expect(calls.map((entry) => entry.method)).toEqual(["ask", "get", "prompt"]);
	});

	test("foreground parity rollback flag OFF returns legacy foreground string envelope", async () => {
		const key =
			PAI_ORCHESTRATION_FEATURE_FLAG_ENV_KEYS.paiOrchestrationForegroundParityEnabled;
		const previous = process.env[key];

		try {
			process.env[key] = "0";

			const taskTool = createPaiTaskTool({
				client: {
					session: {
						create: async () => ({ data: { id: "child-session-rollback" } }),
						prompt: async () => ({
							data: { parts: [{ type: "text", text: "legacy reply" }] },
						}),
					},
				},
				$: (() => Promise.resolve(null)) as unknown,
			});

			const result = await runTaskThroughPluginSeam({
				taskTool,
				taskArgs: {
					description: "Rollback behavior",
					prompt: "Continue",
					subagent_type: "Engineer",
				},
				ctx: {
					sessionID: "parent-session-456",
					ask: async () => ({ decision: "allow" }),
				},
			});

			expect(result.title).toBe("");
			expect((result.metadata as any).sessionId).toBeUndefined();
			expect((result.metadata as any).model).toBeUndefined();
			expect(result.output).toContain("task_id: child-session-rollback");
		} finally {
			restoreEnv(key, previous);
		}
	});
});
