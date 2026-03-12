#!/usr/bin/env bun

/**
 * Load Agent Context
 *
 * Deterministic utility to load agent context files when spawning specialized agents.
 *
 * OpenCode contract:
 * - Context files provide role + workflow guidance
 * - Execution metadata is advisory depth/effort only
 * - Routing and model selection stay with runtime policy
 *
 * Usage: bun run LoadAgentContext.ts <agentType>
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export type AdvisoryDepth = "shallow" | "standard" | "deep";
export type AdvisoryEffort = "low" | "medium" | "high";

export interface AdvisoryExecutionProfile {
	depth: AdvisoryDepth;
	effort: AdvisoryEffort;
	source: "context-markers" | "legacy-model-marker" | "default";
}

export interface AgentContext {
	agentType: string;
	contextContent: string;
	advisoryExecution: AdvisoryExecutionProfile;
}

const ADVISORY_DEPTH_PATTERN =
	/\*\*Advisory Depth\*\*:\s*(shallow|standard|deep)/i;
const ADVISORY_EFFORT_PATTERN = /\*\*Advisory Effort\*\*:\s*(low|medium|high)/i;
const LEGACY_MODEL_PATTERN = /\*\*Model\*\*:\s*(opus|sonnet|haiku)/i;

function parseAdvisoryDepth(content: string): AdvisoryDepth | null {
	const match = content.match(ADVISORY_DEPTH_PATTERN);
	if (!match) {
		return null;
	}

	return match[1].toLowerCase() as AdvisoryDepth;
}

function parseAdvisoryEffort(content: string): AdvisoryEffort | null {
	const match = content.match(ADVISORY_EFFORT_PATTERN);
	if (!match) {
		return null;
	}

	return match[1].toLowerCase() as AdvisoryEffort;
}

function mapLegacyModelToAdvisoryExecution(
	model: "opus" | "sonnet" | "haiku",
): { depth: AdvisoryDepth; effort: AdvisoryEffort } {
	switch (model) {
		case "opus":
			return { depth: "deep", effort: "high" };
		case "haiku":
			return { depth: "shallow", effort: "low" };
		case "sonnet":
			return { depth: "standard", effort: "medium" };
	}
}

export class AgentContextLoader {
	private agentsDir: string;

	constructor() {
		// This tool lives at: <paiDir>/skills/agents/Tools/LoadAgentContext.ts
		// The agent context files live in the agents skill root:
		//   <paiDir>/skills/agents/*Context.md
		this.agentsDir = resolve(join(import.meta.dir, ".."));
	}

	/**
	 * Load context for a specific agent type
	 */
	loadContext(agentType: string): AgentContext {
		const contextPath = join(this.agentsDir, `${agentType}Context.md`);

		if (!existsSync(contextPath)) {
			throw new Error(
				`Context file not found for agent type: ${agentType}\nExpected at: ${contextPath}`,
			);
		}

		const contextContent = readFileSync(contextPath, "utf-8");

		const advisoryDepth = parseAdvisoryDepth(contextContent);
		const advisoryEffort = parseAdvisoryEffort(contextContent);

		if (advisoryDepth && advisoryEffort) {
			return {
				agentType,
				contextContent,
				advisoryExecution: {
					depth: advisoryDepth,
					effort: advisoryEffort,
					source: "context-markers",
				},
			};
		}

		const modelMatch = contextContent.match(LEGACY_MODEL_PATTERN);
		if (modelMatch) {
			const model = modelMatch[1].toLowerCase() as "opus" | "sonnet" | "haiku";
			const mapped = mapLegacyModelToAdvisoryExecution(model);

			return {
				agentType,
				contextContent,
				advisoryExecution: {
					...mapped,
					source: "legacy-model-marker",
				},
			};
		}

		return {
			agentType,
			contextContent,
			advisoryExecution: {
				depth: "standard",
				effort: "medium",
				source: "default",
			},
		};
	}

	/**
	 * Get list of available agent types
	 */
	getAvailableAgents(): string[] {
		if (!existsSync(this.agentsDir)) {
			return [];
		}

		const files = readdirSync(this.agentsDir);

		return files
			.filter((f) => f.endsWith("Context.md"))
			.map((f) => f.replace("Context.md", ""))
			.sort();
	}

	/**
	 * Generate enriched prompt for spawning agent with Task tool
	 */
	generateEnrichedPrompt(
		agentType: string,
		taskDescription: string,
	): {
		prompt: string;
		advisoryExecution: AdvisoryExecutionProfile;
	} {
		const context = this.loadContext(agentType);

		const enrichedPrompt = `${context.contextContent}

---

## Current Task

${taskDescription}`;

		return {
			prompt: enrichedPrompt,
			advisoryExecution: context.advisoryExecution,
		};
	}
}

// CLI usage
if (import.meta.main) {
	const args = process.argv.slice(2);

	if (args.length === 0) {
		console.log("Usage: LoadAgentContext.ts <agentType> [taskDescription]");
		console.log("\nAvailable agent types:");
		const loader = new AgentContextLoader();
		const agents = loader.getAvailableAgents();
		agents.forEach((a) => {
			console.log(`  - ${a}`);
		});
		process.exit(1);
	}

	const [agentType, ...taskParts] = args;
	const taskDescription = taskParts.join(" ");

	try {
		const loader = new AgentContextLoader();

		if (taskDescription) {
			// Generate enriched prompt for spawning
			const { prompt, advisoryExecution } = loader.generateEnrichedPrompt(
				agentType,
				taskDescription,
			);
			console.log(
				`\n=== Enriched Prompt for ${agentType} Agent (Depth: ${advisoryExecution.depth}, Effort: ${advisoryExecution.effort}) ===\n`,
			);
			console.log(prompt);
		} else {
			// Just load the context
			const context = loader.loadContext(agentType);
			console.log(
				`\n=== Context for ${context.agentType} Agent (Depth: ${context.advisoryExecution.depth}, Effort: ${context.advisoryExecution.effort}) ===\n`,
			);
			console.log(context.contextContent);
		}
	} catch (error) {
		console.error(`Error: ${error}`);
		process.exit(1);
	}
}

export default AgentContextLoader;
