import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

type ReviewLauncherRegistryEntry = {
	launcherId: string;
	sourceFile: string;
	launchCallSnippet: string;
};

type ReviewLauncherRegistryModule = {
	REVIEW_LAUNCHER_REGISTRY: ReviewLauncherRegistryEntry[];
};

const EXPECTED_INITIAL_REVIEW_LAUNCHERS: ReviewLauncherRegistryEntry[] = [
	{
		launcherId: "task_background_review_launch_initial",
		sourceFile: ".opencode/plugins/pai-cc-hooks/tools/task.ts",
		launchCallSnippet: 'status: concurrencyEnabled ? "queued" : "running"',
	},
	{
		launcherId: "task_background_review_launch_after_concurrency_acquire",
		sourceFile: ".opencode/plugins/pai-cc-hooks/tools/task.ts",
		launchCallSnippet: 'status: "running",',
	},
];

const WORKTREE_ROOT = path.resolve(import.meta.dir, "..", "..", "..");
const REVIEW_LAUNCHER_REGISTRY_PATH = path.join(
	WORKTREE_ROOT,
	".opencode",
	"plugins",
	"pai-cc-hooks",
	"background",
	"review-launcher-registry.ts",
);

async function loadReviewLauncherRegistry(): Promise<ReviewLauncherRegistryModule> {
	const moduleUrl = pathToFileURL(REVIEW_LAUNCHER_REGISTRY_PATH).href;
	const loaded = (await import(moduleUrl)) as Partial<ReviewLauncherRegistryModule>;
	return {
		REVIEW_LAUNCHER_REGISTRY: Array.isArray(loaded.REVIEW_LAUNCHER_REGISTRY)
			? loaded.REVIEW_LAUNCHER_REGISTRY
			: [],
	};
}

function normalizeEntry(
	entry: ReviewLauncherRegistryEntry,
): ReviewLauncherRegistryEntry {
	return {
		launcherId: entry.launcherId.trim(),
		sourceFile: entry.sourceFile.trim(),
		launchCallSnippet: entry.launchCallSnippet.trim(),
	};
}

function sortEntries(
	entries: ReviewLauncherRegistryEntry[],
): ReviewLauncherRegistryEntry[] {
	return [...entries]
		.map((entry) => normalizeEntry(entry))
		.sort((left, right) => left.launcherId.localeCompare(right.launcherId));
}

function extractCallsiteWindow(
	source: string,
	launchCallSnippet: string,
	radius = 3_000,
): string {
	const snippetIndex = source.indexOf(launchCallSnippet);
	expect(snippetIndex).toBeGreaterThanOrEqual(0);
	const windowStart = Math.max(0, snippetIndex - radius);
	const windowEnd = Math.min(
		source.length,
		snippetIndex + launchCallSnippet.length + radius,
	);
	return source.slice(windowStart, windowEnd);
}

describe("background review launcher inventory contract (Task 1 RED)", () => {
	test("canonical review launcher registry artifact exists and locks expected initial inventory", async () => {
		expect(fs.existsSync(REVIEW_LAUNCHER_REGISTRY_PATH)).toBe(true);

		const registryModule = await loadReviewLauncherRegistry();
		expect(Array.isArray(registryModule.REVIEW_LAUNCHER_REGISTRY)).toBe(true);
		expect(sortEntries(registryModule.REVIEW_LAUNCHER_REGISTRY)).toEqual(
			sortEntries(EXPECTED_INITIAL_REVIEW_LAUNCHERS),
		);
	});

	test("all registered review launchers bind task_kind review at launch callsite", async () => {
		expect(fs.existsSync(REVIEW_LAUNCHER_REGISTRY_PATH)).toBe(true);

		const { REVIEW_LAUNCHER_REGISTRY } = await loadReviewLauncherRegistry();
		const launcherIds = REVIEW_LAUNCHER_REGISTRY.map((entry) => entry.launcherId);
		expect(new Set(launcherIds).size).toBe(launcherIds.length);

		for (const entry of REVIEW_LAUNCHER_REGISTRY) {
			expect(entry.launcherId.trim().length > 0).toBe(true);
			expect(entry.sourceFile.trim().length > 0).toBe(true);
			expect(entry.launchCallSnippet.trim().length > 0).toBe(true);

			const sourcePath = path.resolve(WORKTREE_ROOT, entry.sourceFile);
			expect(fs.existsSync(sourcePath)).toBe(true);

			const source = fs.readFileSync(sourcePath, "utf-8");
			expect(source.includes(entry.launchCallSnippet)).toBe(true);

			const callsiteWindow = extractCallsiteWindow(
				source,
				entry.launchCallSnippet,
			);
			expect(callsiteWindow).toMatch(/run_in_background\s*:\s*true/);
			expect(callsiteWindow).toMatch(/task_kind\s*:\s*["']review["']/);
		}
	});
});
