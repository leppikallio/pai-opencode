import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const repoRoot =
	path.basename(process.cwd()) === ".opencode"
		? path.resolve(process.cwd(), "..")
		: process.cwd();

function readDoc(...segments: string[]): string {
	return readFileSync(path.join(repoRoot, ...segments), "utf8");
}

describe("agents skill OpenCode tailoring contract (Task 4)", () => {
	test("agent docs preserve custom routing and native general fallback semantics", () => {
		const skillDoc = readDoc(".opencode", "skills", "agents", "SKILL.md");
		const createCustomWorkflow = readDoc(
			".opencode",
			"skills",
			"agents",
			"Workflows",
			"CreateCustomAgent.md",
		);
		const spawnParallelWorkflow = readDoc(
			".opencode",
			"skills",
			"agents",
			"Workflows",
			"SpawnParallelAgents.md",
		);
		const profileSystem = readDoc(
			".opencode",
			"skills",
			"agents",
			"AgentProfileSystem.md",
		);
		const personalities = readDoc(
			".opencode",
			"skills",
			"agents",
			"AgentPersonalities.md",
		);

		expect(skillDoc).toContain(
			'**CRITICAL: The word "custom" is the KEY trigger:**',
		);
		expect(skillDoc).toContain("Named Agents");
		expect(skillDoc).toContain("Dynamic (Custom) Agents");
		expect(skillDoc).toContain("expert in X");
		expect(skillDoc).toContain("native `general`");
		expect(skillDoc).toContain("never `general-purpose`");
		expect(skillDoc).toContain("specialist-first -> `general` fallback");
		expect(skillDoc).not.toContain(
			"Explicit Intern ask or broad parallel grunt work",
		);

		expect(createCustomWorkflow).toContain("KEY TRIGGER: `custom`");
		expect(createCustomWorkflow).toContain('explicit, bounded "expert in X"');
		expect(createCustomWorkflow).toContain('subagent_type: "general"');
		expect(createCustomWorkflow).toContain(
			"must not include unsupported `model` arguments",
		);
		expect(createCustomWorkflow).not.toContain("general-purpose");

		expect(spawnParallelWorkflow).toContain(
			"native `general` (never `general-purpose`)",
		);
		expect(spawnParallelWorkflow).toContain("Intern");
		expect(spawnParallelWorkflow).toContain("broad parallel grunt work");

		expect(profileSystem).toContain("**Status:** ✅ Active");
		expect(profileSystem).toContain("advisory depth/effort semantics");
		expect(profileSystem.toLowerCase()).not.toContain("legacy");

		expect(personalities).toContain("Task Tool Subagent (`general`)");
		expect(personalities).toContain("Dynamic (Custom) Agents");
		expect(personalities).toContain('explicit and bounded "expert in X"');
		expect(personalities).toContain(
			"Route to `Intern` only for those split-safe grunt batches",
		);
		expect(personalities).toContain(
			"If intern wording appears without grunt scope",
		);
		expect(personalities).not.toContain(
			"Route directly to `Intern` in the runtime subagent system.",
		);
	});

	test("subagent-driven-development templates use exact-subagent wording", () => {
		const implementerPrompt = readDoc(
			".opencode",
			"skills",
			"utilities",
			"subagent-driven-development",
			"implementer-prompt.md",
		);
		const reviewerPrompt = readDoc(
			".opencode",
			"skills",
			"utilities",
			"subagent-driven-development",
			"spec-reviewer-prompt.md",
		);

		expect(implementerPrompt).toContain(
			"Task tool (exact runtime subagent_type):",
		);
		expect(reviewerPrompt).toContain(
			"Task tool (exact runtime subagent_type):",
		);
		expect(implementerPrompt).not.toContain("Task tool (general-purpose):");
		expect(reviewerPrompt).not.toContain("Task tool (general-purpose):");
	});

	test("mapping docs preserve parity for Explore, Plan, and general-purpose", () => {
		const mappingDoc = readDoc(
			".opencode",
			"PAISYSTEM",
			"PAI-TO-OPENCODE-MAPPING.md",
		);

		expect(mappingDoc).toContain("| `Explore` | `explore` |");
		expect(mappingDoc).toContain("| `Plan` | `Architect` |");
		expect(mappingDoc).toContain(
			"| `general-purpose` | `general` (or specialist) |",
		);
		expect(mappingDoc).toContain("native `general` fallback");
	});
});
