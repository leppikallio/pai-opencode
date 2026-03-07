import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const repoRoot =
	path.basename(process.cwd()) === ".opencode"
		? path.resolve(process.cwd(), "..")
		: process.cwd();

const manifestPath = path.join(repoRoot, ".opencode", "commands", "wq.md");

describe("/wq command manifest", () => {
	test("exists with required /wq metadata", () => {
		expect(existsSync(manifestPath)).toBe(true);

		const md = readFileSync(manifestPath, "utf8");
		expect(md).toContain("description:");
		expect(md).toContain("/wq");
		expect(md.toLowerCase()).toContain("close current session and exit");
	});
});
