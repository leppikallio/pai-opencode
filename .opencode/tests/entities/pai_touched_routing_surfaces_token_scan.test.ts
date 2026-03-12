import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
	task5RoutingForbiddenTokenPolicy,
	task5TouchedRoutingSurfaceAllowlist,
} from "./pai_task5_routing_token_policy";

const repoRoot =
	path.basename(process.cwd()) === ".opencode"
		? path.resolve(process.cwd(), "..")
		: process.cwd();

function readRepoFile(...segments: string[]): string {
	return readFileSync(path.join(repoRoot, ...segments), "utf8");
}

describe("PAI touched routing surfaces token scan (Task 5)", () => {
	test("forbidden routing tokens are absent from touched runtime-facing surfaces", () => {
		const forbiddenPatterns = [
			...task5RoutingForbiddenTokenPolicy.basePatterns,
			task5RoutingForbiddenTokenPolicy.markdownTablePattern,
		];

		for (const segments of task5TouchedRoutingSurfaceAllowlist) {
			const content = readRepoFile(...segments);

			for (const literal of task5RoutingForbiddenTokenPolicy.literals) {
				expect(content.includes(literal)).toBe(false);
			}

			for (const pattern of forbiddenPatterns) {
				expect(pattern.test(content)).toBe(false);
			}
		}
	});
});
