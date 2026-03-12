import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const repoRoot =
	path.basename(process.cwd()) === ".opencode"
		? path.resolve(process.cwd(), "..")
		: process.cwd();

const runtimeValidSubagentNames = new Set([
	"general",
	"Engineer",
	"Architect",
	"Designer",
	"QATester",
	"Pentester",
	"explore",
	"Intern",
]);

function readRepoFile(...segments: string[]): string {
	return readFileSync(path.join(repoRoot, ...segments), "utf8");
}

function extractSubagentTypeValues(content: string): string[] {
	const values = new Set<string>();
	const patterns = [
		/subagent_type\s*[:=]\s*"([^"]+)"/g,
		/subagent_type\s*[:=]\s*'([^']+)'/g,
	];

	for (const pattern of patterns) {
		for (const match of content.matchAll(pattern)) {
			const value = match[1]?.trim();
			if (value) {
				values.add(value);
			}
		}
	}

	return [...values];
}

describe("PAI touched Task docs subagent name validity (Task 5)", () => {
	test("touched docs with subagent_type examples use runtime-valid names", () => {
		const personalities = readRepoFile(
			".opencode",
			"skills",
			"agents",
			"AgentPersonalities.md",
		);

		const values = extractSubagentTypeValues(personalities);
		expect(values.length).toBeGreaterThan(0);

		for (const value of values) {
			expect(runtimeValidSubagentNames.has(value)).toBe(true);
		}
	});

	test("touched docs avoid legacy subagent aliases", () => {
		const personalities = readRepoFile(
			".opencode",
			"skills",
			"agents",
			"AgentPersonalities.md",
		);

		expect(personalities).not.toMatch(/subagent_type\s*[:=]\s*"general-purpose"/);
		expect(personalities).not.toMatch(/subagent_type\s*[:=]\s*"Explore"/);
		expect(personalities).not.toMatch(/subagent_type\s*[:=]\s*"Plan"/);
	});
});
