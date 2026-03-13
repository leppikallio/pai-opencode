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

describe("PAI lightweight question routing wording contract", () => {
	test("format mode selection keeps algorithm invariant and single routing contract", () => {
		const formatModeSelection = readDoc(
			".opencode",
			"skills",
			"PAI",
			"Components",
			"15-format-mode-selection.md",
		);

		expect(formatModeSelection).toContain("Nothing escapes the Algorithm");
		expect(formatModeSelection).toContain(
			"Every prompt enters one routing contract",
		);
		expect(formatModeSelection).toContain("bounded read-only quick questions");
		expect(formatModeSelection).toContain("FULL triggers");
	});

	test("workflow routing allows bounded local inspection and enumerates FULL triggers", () => {
		const workflowRouting = readDoc(
			".opencode",
			"skills",
			"PAI",
			"Components",
			"30-workflow-routing.md",
		);

		expect(workflowRouting).toContain("bounded read-only local inspection");
		expect(workflowRouting).toContain("specific file path");
		expect(workflowRouting).toContain("repo-wide discovery");
		expect(workflowRouting).toContain("multi-file investigation");
		expect(workflowRouting).toContain("edits");
		expect(workflowRouting).toContain("command execution");
		expect(workflowRouting).toContain("external/web state");
		expect(workflowRouting).toContain("destructive/security-sensitive");
		expect(workflowRouting).toContain("material ambiguity");
		expect(workflowRouting).toContain("stronger verification needs");
	});
});
