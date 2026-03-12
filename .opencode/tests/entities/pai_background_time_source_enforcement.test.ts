import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const repoRoot =
	path.basename(process.cwd()) === ".opencode"
		? path.resolve(process.cwd(), "..")
		: process.cwd();

type GuardedModule = {
	relativePath: string;
	includeOnlyIfTimingLogic: boolean;
};

const GUARDED_MODULES: GuardedModule[] = [
	{
		relativePath: ".opencode/plugins/pai-cc-hooks/background/poller.ts",
		includeOnlyIfTimingLogic: false,
	},
	{
		relativePath: ".opencode/plugins/pai-cc-hooks/background/cancellation-policy.ts",
		includeOnlyIfTimingLogic: false,
	},
	{
		relativePath: ".opencode/plugins/pai-cc-hooks/background/terminalize.ts",
		includeOnlyIfTimingLogic: false,
	},
	{
		relativePath: ".opencode/plugins/pai-cc-hooks/tools/background-cancel.ts",
		includeOnlyIfTimingLogic: false,
	},
	{
		relativePath: ".opencode/plugins/pai-cc-hooks/tools/background-output.ts",
		includeOnlyIfTimingLogic: true,
	},
];

function hasTimingLogic(sourceText: string): boolean {
	return /nowMs|timeout|setTimeout|waitForCompletion|quiet|stale|tenancy|deadline/.test(
		sourceText,
	);
}

describe("background tenacity injected-clock enforcement (Task 0 RED)", () => {
	test("enforcement module set exactly matches the tenacity plan", () => {
		for (const moduleInfo of GUARDED_MODULES) {
			const absolutePath = path.join(repoRoot, moduleInfo.relativePath);
			expect(existsSync(absolutePath)).toBe(true);
		}
	});

	test("guarded timing modules forbid direct Date.now()", () => {
		for (const moduleInfo of GUARDED_MODULES) {
			const absolutePath = path.join(repoRoot, moduleInfo.relativePath);
			if (!existsSync(absolutePath)) {
				continue;
			}

			const sourceText = readFileSync(absolutePath, "utf8");
			if (
				moduleInfo.includeOnlyIfTimingLogic &&
				!hasTimingLogic(sourceText)
			) {
				continue;
			}

			expect(sourceText.includes("Date.now(")).toBe(false);
		}
	});
});
