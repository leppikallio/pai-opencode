import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
	task5RoutingForbiddenTokenPolicy,
	task5TouchedRoutingDocAllowlist,
} from "./pai_task5_routing_token_policy";

const repoRoot =
	path.basename(process.cwd()) === ".opencode"
		? path.resolve(process.cwd(), "..")
		: process.cwd();

function readRepoFile(...segments: string[]): string {
	return readFileSync(path.join(repoRoot, ...segments), "utf8");
}

describe("PAI routing vocabulary reconciliation (Task 5)", () => {
	test("agent capture keeps archival subagent_type with unknown fallback", () => {
		const captureHandler = readRepoFile(
			".opencode",
			"plugins",
			"handlers",
			"agent-capture.ts",
		);

		expect(captureHandler).toContain('getStringProp(args, "subagent_type")');
		expect(captureHandler).toContain('return "unknown"');
		expect(captureHandler).not.toContain("general-purpose");
		expect(captureHandler).not.toMatch(/\(args\.subagent_type as string\)\s*\|\|/);
	});

	test("bounded triage docs avoid stale routing claims and invalid Task model examples", () => {
		const touchedDocs = task5TouchedRoutingDocAllowlist.map((segments) =>
			readRepoFile(...segments),
		);

		for (const doc of touchedDocs) {
			for (const literal of task5RoutingForbiddenTokenPolicy.literals) {
				expect(doc.includes(literal)).toBe(false);
			}

			for (const pattern of task5RoutingForbiddenTokenPolicy.basePatterns) {
				expect(pattern.test(doc)).toBe(false);
			}
		}
	});
});
