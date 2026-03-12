#!/usr/bin/env bun

/**
 * Agent Profile Loader
 *
 * Active compatibility shim for profile-based helper calls.
 *
 * Wraps AgentContextLoader and normalizes profile metadata to OpenCode-correct
 * advisory execution semantics (depth/effort). This shim does not select
 * runtime models and does not decide routing policy.
 *
 * @see AgentProfileSystem.md
 */

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import {
	type AdvisoryDepth,
	type AdvisoryEffort,
	AgentContextLoader,
} from "./LoadAgentContext";

export interface AgentProfile {
	name: string;
	advisoryDepth: AdvisoryDepth;
	advisoryEffort: AdvisoryEffort;
	contextContent: string;
}

export interface LoadedProfile {
	profile: AgentProfile;
	fullPrompt: string;
}

export class AgentProfileLoader {
	private contextLoader: AgentContextLoader;
	private agentsDir: string;

	constructor() {
		this.contextLoader = new AgentContextLoader();
		this.agentsDir = resolve(join(import.meta.dir, ".."));
	}

	/**
	 * Load profile for an agent type with task context
	 * Adapts to the interface expected by SpawnAgentWithProfile.ts
	 */
	async loadProfile(
		agentType: string,
		taskDescription: string,
		projectPath?: string,
	): Promise<LoadedProfile> {
		// Load context once, then build the enriched prompt from the same payload.
		const context = this.contextLoader.loadContext(agentType);

		const prompt = `${context.contextContent}

---

## Current Task

${taskDescription}`;

		// If project path provided, append project context note
		let fullPrompt = prompt;
		if (projectPath) {
			fullPrompt += `\n\n---\n\n## Project Context\n\nWorking in: ${projectPath}`;
		}

		return {
			profile: {
				name: agentType,
				advisoryDepth: context.advisoryExecution.depth,
				advisoryEffort: context.advisoryExecution.effort,
				contextContent: context.contextContent,
			},
			fullPrompt,
		};
	}

	/**
	 * Get list of available agent profiles
	 * Maps to context files (*Context.md)
	 */
	getAvailableProfiles(): string[] {
		return this.contextLoader.getAvailableAgents().slice().sort();
	}

	/**
	 * Check if a profile exists for an agent type
	 */
	hasProfile(agentType: string): boolean {
		const contextPath = join(this.agentsDir, `${agentType}Context.md`);
		return existsSync(contextPath);
	}
}

// CLI usage for testing
if (import.meta.main) {
	const args = process.argv.slice(2);

	if (args.length === 0) {
		console.log(
			"Usage: AgentProfileLoader.ts <agentType> [taskDescription] [projectPath]",
		);
		console.log("\nAvailable profiles:");
		const loader = new AgentProfileLoader();
		const profiles = loader.getAvailableProfiles();
		profiles.forEach((p) => {
			console.log(`  - ${p}`);
		});
		process.exit(1);
	}

	const [agentType, taskDescription, projectPath] = args;

	try {
		const loader = new AgentProfileLoader();

		if (!loader.hasProfile(agentType)) {
			console.error(`No profile found for agent type: ${agentType}`);
			process.exit(1);
		}

		const loaded = await loader.loadProfile(
			agentType,
			taskDescription || "Test task",
			projectPath,
		);

		console.log("\n=== Agent Profile ===\n");
		console.log(`Name: ${loaded.profile.name}`);
		console.log(`Advisory depth: ${loaded.profile.advisoryDepth}`);
		console.log(`Advisory effort: ${loaded.profile.advisoryEffort}`);
		console.log("\n=== Full Prompt ===\n");
		console.log(loaded.fullPrompt);
	} catch (error) {
		console.error(`Error: ${error}`);
		process.exit(1);
	}
}

export default AgentProfileLoader;
