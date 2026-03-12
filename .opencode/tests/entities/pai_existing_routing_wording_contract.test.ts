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

describe("PAI existing routing wording contract (Task 3)", () => {
	test("authoritative delegation docs keep specialist-first routing with general fallback", () => {
		const agentSystem = readDoc(
			".opencode",
			"skills",
			"PAI",
			"SYSTEM",
			"PAIAGENTSYSTEM.md",
		);
		const delegationSystem = readDoc(
			".opencode",
			"skills",
			"PAI",
			"SYSTEM",
			"THEDELEGATIONSYSTEM.md",
		);
		const delegationWorkflow = readDoc(
			".opencode",
			"skills",
			"PAI",
			"Workflows",
			"Delegation.md",
		);

		expect(agentSystem).toContain("THREE AGENT SYSTEMS");
		expect(agentSystem).toContain("`general`");
		expect(agentSystem).toContain("catch-all runtime subagent");
		expect(agentSystem).toContain("broad parallel grunt work");
		expect(agentSystem).toContain("advisory, not imperative");

		expect(delegationSystem).toContain("Routing Decision Tree");
		expect(delegationSystem).toContain("Specialist first");
		expect(delegationSystem).toContain("Then `general`");
		expect(delegationSystem).toContain("Reserve `Intern`");
		expect(delegationSystem).toContain("explicit/bounded");
		expect(delegationSystem).toContain("advisory, not imperative");

		expect(delegationWorkflow).toContain("Delegation Decision Tree");
		expect(delegationWorkflow).toContain("Specialist first");
		expect(delegationWorkflow).toContain("Then `general`");
		expect(delegationWorkflow).toContain("Reserve `Intern`");
		expect(delegationWorkflow).toContain("expert in X");
	});

	test("background delegation docs reflect explicit async extension", () => {
		const backgroundWorkflow = readDoc(
			".opencode",
			"skills",
			"PAI",
			"Workflows",
			"BackgroundDelegation.md",
		);

		expect(backgroundWorkflow).toContain('subagent_type: "general"');
		expect(backgroundWorkflow).toContain("run_in_background: true");
		expect(backgroundWorkflow).toContain("background_output");
		expect(backgroundWorkflow).not.toContain(
			"does not expose a background execution flag",
		);
		expect(backgroundWorkflow).not.toContain("(no background flag)");
	});
});
