#!/usr/bin/env bun

/**
 * Spawn Agent With Profile
 *
 * Execution adapter utilities for Task launches with pre-loaded profile context.
 *
 * This module is intentionally NOT a routing brain:
 * - Callers choose `subagent_type` for profiled launches
 * - The v1 composed-agent helper pins native `general` explicitly
 */

import AgentProfileLoader from "./AgentProfileLoader";
import type { AdvisoryDepth, AdvisoryEffort } from "./LoadAgentContext";

export interface SpawnAgentOptions {
	agentType: string;
	taskDescription: string;
	projectPath?: string;
	runInBackground?: boolean;
	description?: string;
}

export interface AgentPrompt {
	prompt: string;
	description: string;
	advisoryDepth: AdvisoryDepth;
	advisoryEffort: AdvisoryEffort;
}

export interface ProfiledAgentLaunchSpec {
	description: string;
	prompt: string;
	subagent_type: string;
	advisoryDepth: AdvisoryDepth;
	advisoryEffort: AdvisoryEffort;
	run_in_background?: boolean;
}

export interface ComposedAgentLaunchSpecV1 {
	description: string;
	prompt: string;
	subagent_type: "general";
	run_in_background?: boolean;
}

function buildDescription(
	agentType: string,
	taskDescription: string,
	description?: string,
): string {
	if (description) {
		return description;
	}

	if (taskDescription.length <= 50) {
		return `${agentType}: ${taskDescription}`;
	}

	return `${agentType}: ${taskDescription.substring(0, 50)}...`;
}

/**
 * Generate enriched prompt for spawning an agent with profile.
 * Metadata returned here is advisory only (depth/effort).
 */
export async function generateAgentPrompt(
	options: SpawnAgentOptions,
): Promise<AgentPrompt> {
	const loader = new AgentProfileLoader();

	// Load the profile
	const loaded = await loader.loadProfile(
		options.agentType,
		options.taskDescription,
		options.projectPath,
	);

	const description = buildDescription(
		options.agentType,
		options.taskDescription,
		options.description,
	);

	return {
		prompt: loaded.fullPrompt,
		description,
		advisoryDepth: loaded.profile.advisoryDepth,
		advisoryEffort: loaded.profile.advisoryEffort,
	};
}

/**
 * Build a Task launch spec for a profiled specialist.
 * The caller-provided `agentType` is used directly as `subagent_type`.
 */
export async function buildProfiledAgentLaunchSpec(
	options: SpawnAgentOptions,
): Promise<ProfiledAgentLaunchSpec> {
	const generated = await generateAgentPrompt(options);

	const launchSpec: ProfiledAgentLaunchSpec = {
		description: generated.description,
		prompt: generated.prompt,
		subagent_type: options.agentType,
		advisoryDepth: generated.advisoryDepth,
		advisoryEffort: generated.advisoryEffort,
	};

	if (typeof options.runInBackground === "boolean") {
		launchSpec.run_in_background = options.runInBackground;
	}

	return launchSpec;
}

/**
 * v1 compatibility lane for dynamically composed AgentFactory prompts.
 * Explicitly pins the native `general` execution substrate.
 */
export function buildComposedAgentLaunchSpecV1(options: {
	description: string;
	prompt: string;
	runInBackground?: boolean;
}): ComposedAgentLaunchSpecV1 {
	const launchSpec: ComposedAgentLaunchSpecV1 = {
		description: options.description,
		prompt: options.prompt,
		subagent_type: "general",
	};

	if (typeof options.runInBackground === "boolean") {
		launchSpec.run_in_background = options.runInBackground;
	}

	return launchSpec;
}

// CLI usage
if (import.meta.main) {
	const args = process.argv.slice(2);

	if (args.length < 2) {
		console.log(
			"Usage: SpawnAgentWithProfile.ts <agentType> <taskDescription> [projectPath]",
		);
		console.log("\nExample:");
		console.log(
			'  bun run SpawnAgentWithProfile.ts Architect "Design REST API" ~/Projects/MyApp',
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
		const launchSpec = await buildProfiledAgentLaunchSpec({
			agentType,
			taskDescription,
			projectPath,
		});

		console.log("\n=== Agent Launch Configuration ===\n");
		console.log(`Agent Type: ${agentType}`);
		console.log(`Task subagent_type: ${launchSpec.subagent_type}`);
		console.log(`Advisory depth: ${launchSpec.advisoryDepth}`);
		console.log(`Advisory effort: ${launchSpec.advisoryEffort}`);
		console.log(`Description: ${launchSpec.description}`);
		console.log("\n=== Enriched Prompt (ready for Task tool) ===\n");
		console.log(launchSpec.prompt);
	} catch (error) {
		console.error(`Error generating prompt: ${error}`);
		process.exit(1);
	}
}

export default {
	generateAgentPrompt,
	buildProfiledAgentLaunchSpec,
	buildComposedAgentLaunchSpecV1,
};
