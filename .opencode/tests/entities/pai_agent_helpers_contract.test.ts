import { describe, expect, test } from "bun:test";

import AgentProfileLoader from "../../skills/agents/Tools/AgentProfileLoader";
import { AgentContextLoader } from "../../skills/agents/Tools/LoadAgentContext";

const DEPTH_VALUES = ["shallow", "standard", "deep"];
const EFFORT_VALUES = ["low", "medium", "high"];
const SOURCE_VALUES = ["context-markers", "legacy-model-marker", "default"];

describe("agent helper contracts (Task 4)", () => {
	test("LoadAgentContext is deterministic and returns advisory execution metadata only", () => {
		const loader = new AgentContextLoader();
		const first = loader.loadContext("Engineer");
		const second = loader.loadContext("Engineer");

		expect(first.advisoryExecution).toEqual(second.advisoryExecution);
		expect(DEPTH_VALUES).toContain(first.advisoryExecution.depth);
		expect(EFFORT_VALUES).toContain(first.advisoryExecution.effort);
		expect(SOURCE_VALUES).toContain(first.advisoryExecution.source);
		expect((first as unknown as Record<string, unknown>).model).toBeUndefined();
	});

	test("available helper profile listings are deterministic", () => {
		const contextLoader = new AgentContextLoader();
		const profileLoader = new AgentProfileLoader();

		const availableAgents = contextLoader.getAvailableAgents();
		const availableProfiles = profileLoader.getAvailableProfiles();

		expect(availableAgents).toEqual([...availableAgents].sort());
		expect(availableProfiles).toEqual([...availableProfiles].sort());
		expect(availableProfiles).toEqual(availableAgents);
	});

	test("LoadAgentContext generates enriched prompts with advisory metadata", () => {
		const loader = new AgentContextLoader();
		const enriched = loader.generateEnrichedPrompt(
			"Architect",
			"Design an adapter that keeps routing deterministic",
		);

		expect(enriched.prompt).toContain("## Current Task");
		expect(enriched.prompt).toContain(
			"Design an adapter that keeps routing deterministic",
		);
		expect(DEPTH_VALUES).toContain(enriched.advisoryExecution.depth);
		expect(EFFORT_VALUES).toContain(enriched.advisoryExecution.effort);
		expect(
			(enriched as unknown as Record<string, unknown>).model,
		).toBeUndefined();
	});

	test("AgentProfileLoader remains active compatibility shim with OpenCode-correct fields", async () => {
		const loader = new AgentProfileLoader();

		expect(loader.hasProfile("Engineer")).toBe(true);
		expect(loader.getAvailableProfiles()).toContain("Engineer");

		const loaded = await loader.loadProfile(
			"Engineer",
			"Implement Task 4 helper contracts",
			"/tmp/task-4-project",
		);

		expect(loaded.profile.name).toBe("Engineer");
		expect(DEPTH_VALUES).toContain(loaded.profile.advisoryDepth);
		expect(EFFORT_VALUES).toContain(loaded.profile.advisoryEffort);
		expect(
			(loaded.profile as unknown as Record<string, unknown>).modelPreference,
		).toBeUndefined();
		expect(loaded.fullPrompt).toContain("## Current Task");
		expect(loaded.fullPrompt).toContain("Implement Task 4 helper contracts");
		expect(loaded.fullPrompt).toContain("## Project Context");
		expect(loaded.fullPrompt).toContain("/tmp/task-4-project");
	});
});
