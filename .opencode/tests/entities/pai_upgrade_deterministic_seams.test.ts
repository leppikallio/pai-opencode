import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { runMonitor } from "../../skills/utilities/pai-upgrade/Tools/MonitorSources";

describe("pai-upgrade deterministic seams", () => {
	test("runMonitor honors injected fetch, clock, and path seams", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "pai-upgrade-seams-"));

		try {
			const sourcesPath = path.join(root, "fixtures", "sources.v2.json");
			const stateFilePath = path.join(
				root,
				"runtime",
				"state",
				"last-check.json",
			);
			const runHistoryPath = path.join(
				root,
				"runtime",
				"logs",
				"run-history.jsonl",
			);
			const recommendationHistoryPath = path.join(
				root,
				"runtime",
				"history",
				"recommendation-history.jsonl",
			);
			const ratingsPath = path.join(
				root,
				"runtime",
				"learning",
				"ratings.jsonl",
			);
			const failuresRoot = path.join(root, "runtime", "learning", "FAILURES");

			await mkdir(path.dirname(sourcesPath), { recursive: true });
			await mkdir(path.dirname(stateFilePath), { recursive: true });
			await mkdir(path.dirname(runHistoryPath), { recursive: true });
			await mkdir(path.dirname(recommendationHistoryPath), { recursive: true });
			await mkdir(path.dirname(ratingsPath), { recursive: true });
			await mkdir(failuresRoot, { recursive: true });

			await writeFile(
				sourcesPath,
				`${JSON.stringify({
					schema_version: 2,
					sources: [
						{
							id: "blog-pai-upgrade-intelligence",
							provider: "test",
							category: "blog",
							name: "PAI Upgrade Intelligence Blog",
							url: "https://example.test/pai-upgrade/blog",
							priority: "HIGH",
							type: "blog",
						},
					],
				})}\n`,
				"utf-8",
			);

			await writeFile(
				ratingsPath,
				`${JSON.stringify({
					timestamp: "2020-01-05T11:00:00.000Z",
					rating: 4,
					source: "explicit",
					sentiment_summary:
						"Need deterministic seams for upgrade monitoring and reflection mining",
				})}\n`,
				"utf-8",
			);

			const fixedNow = new Date("2020-01-10T04:05:06.000Z");
			const fetchCalls: string[] = [];

			const result = await runMonitor({
				days: 14,
				force: true,
				provider: "test",
				dryRun: false,
				format: "json",
				persistHistory: true,
				runtime: {
					fetch: (async (input) => {
						fetchCalls.push(String(input));
						return new Response(
							"<html><h1>Upgrade Monitor</h1><title>Deterministic Seams</title></html>",
							{ status: 200 },
						);
					}) as typeof fetch,
					now: () => new Date(fixedNow),
					sourcesV2ConfigPath: sourcesPath,
					stateFilePath,
					runHistoryPath,
					recommendationHistoryPath,
					learningContext: {
						ratingsPath,
						failuresRoot,
					},
				},
			});

			expect(result.generatedAt).toBe(fixedNow.toISOString());
			expect(result.learning_context.generated_at).toBe(fixedNow.toISOString());
			expect(result.learning_context.total_ratings).toBe(1);
			expect(fetchCalls).toContain("https://example.test/pai-upgrade/blog");

			expect(existsSync(stateFilePath)).toBe(true);
			expect(existsSync(runHistoryPath)).toBe(true);
			expect(existsSync(recommendationHistoryPath)).toBe(true);

			const state = JSON.parse(readFileSync(stateFilePath, "utf-8")) as {
				last_check_timestamp: string;
			};
			expect(state.last_check_timestamp).toBe(fixedNow.toISOString());

			expect(result.summary.ranking.historyPath).toBe(
				path.resolve(recommendationHistoryPath),
			);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
