import { describe, expect, test } from "bun:test";
import { createPaiTaskTool } from "../../plugins/pai-cc-hooks/tools/task";
import {
	buildComposedAgentLaunchSpecV1,
	buildProfiledAgentLaunchSpec,
} from "../../skills/agents/Tools/SpawnAgentWithProfile";
import { runTaskThroughPluginSeam } from "./helpers/task-plugin-seam";

describe("dynamic composition helper lane contract (Task 4)", () => {
	test("v1 composed-agent launch helper pins native general substrate", () => {
		const launch = buildComposedAgentLaunchSpecV1({
			description: "Composed legal expert",
			prompt: "You are an expert in contract law. Analyze this agreement.",
		});

		expect(launch.subagent_type).toBe("general");
		expect(launch.description).toBe("Composed legal expert");
		expect(
			(launch as unknown as Record<string, unknown>).model,
		).toBeUndefined();
	});

	test("v1 composed-agent launch spec is executable through Task seam", async () => {
		const launch = buildComposedAgentLaunchSpecV1({
			description: "Composed security expert",
			prompt:
				"You are an expert in security architecture. Produce a threat model.",
			runInBackground: true,
		});

		const taskTool = createPaiTaskTool({
			client: {
				session: {
					create: async () => ({ data: { id: "child-general-v1-composed" } }),
					prompt: async () => ({
						data: { parts: [{ type: "text", text: "composed helper ok" }] },
					}),
				},
			},
			$: (() => Promise.resolve(null)) as unknown,
		});

		const result = await runTaskThroughPluginSeam({
			taskTool,
			taskArgs: launch,
			ctx: {
				sessionID: "parent-session-v1-composed",
				ask: async () => ({ decision: "allow" }),
			},
		});

		expect(result.output).toContain("child-general-v1-composed");
		expect(result.output).toContain("Agent: general");
	});

	test("profiled launch helper stays execution adapter with caller-selected subagent", async () => {
		const launch = await buildProfiledAgentLaunchSpec({
			agentType: "Engineer",
			taskDescription: "Implement deterministic advisory helper lane",
			runInBackground: false,
		});

		expect(launch.subagent_type).toBe("Engineer");
		expect(launch.prompt).toContain("## Current Task");
		expect(["shallow", "standard", "deep"]).toContain(launch.advisoryDepth);
		expect(["low", "medium", "high"]).toContain(launch.advisoryEffort);
		expect(launch.run_in_background).toBe(false);
		expect(
			(launch as unknown as Record<string, unknown>).model,
		).toBeUndefined();
	});
});
