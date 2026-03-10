import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { runMonitor } from "../../skills/utilities/pai-upgrade/Tools/MonitorSources";

describe("pai-upgrade deterministic seams", () => {
	test("runMonitor defaults to MEMORY-backed config/state paths", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "pai-upgrade-memory-defaults-"));
		const originalHome = process.env.HOME;
		const originalUserProfile = process.env.USERPROFILE;

		try {
			const home = path.join(root, "home");
			process.env.HOME = home;
			process.env.USERPROFILE = home;

			const memoryRoot = path.join(home, ".config", "opencode", "MEMORY", "STATE", "pai-upgrade");
			const configDir = path.join(memoryRoot, "config");
			const stateDir = path.join(memoryRoot, "state");
			const transcriptDir = path.join(stateDir, "transcripts", "youtube");

			const sourcesPath = path.join(configDir, "sources.v2.json");
			const youtubeChannelsPath = path.join(configDir, "youtube-channels.json");
			const ratingsPath = path.join(root, "runtime", "learning", "ratings.jsonl");
			const failuresRoot = path.join(root, "runtime", "learning", "FAILURES");

			await mkdir(configDir, { recursive: true });
			await mkdir(path.dirname(ratingsPath), { recursive: true });
			await mkdir(failuresRoot, { recursive: true });

			await writeFile(
				sourcesPath,
				`${JSON.stringify({
					schema_version: 2,
					sources: [
						{
							id: "blog-test-memory-default",
							provider: "test",
							category: "blog",
							name: "Memory Default Source",
							url: "https://example.test/pai-upgrade/memory-defaults",
							priority: "HIGH",
							type: "blog",
						},
					],
				})}\n`,
				"utf-8",
			);

			await writeFile(
				youtubeChannelsPath,
				`${JSON.stringify({
					schema_version: 1,
					channels: [
						{
							channel_id: "UCmemoryDefaults",
							provider: "test",
							name: "Memory Defaults YouTube",
							priority: "HIGH",
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
					sentiment_summary: "Need local MEMORY defaults",
				})}\n`,
				"utf-8",
			);

			const result = await runMonitor({
				days: 14,
				force: true,
				provider: "test",
				dryRun: false,
				format: "json",
				persistHistory: true,
				runtime: {
					fetch: (async (input) => {
						const url = String(input);
						if (url.includes("youtube.com/feeds/videos.xml")) {
							return new Response(
								"<?xml version=\"1.0\" encoding=\"UTF-8\"?><feed xmlns=\"http://www.w3.org/2005/Atom\" xmlns:yt=\"http://www.youtube.com/xml/schemas/2015\"><entry><id>yt:video:video-memory-default</id><yt:videoId>video-memory-default</yt:videoId><title>Memory Defaults Video</title><link rel=\"alternate\" href=\"https://www.youtube.com/watch?v=video-memory-default\"/><published>2020-01-10T00:00:00.000Z</published><updated>2020-01-10T00:00:00.000Z</updated></entry></feed>",
								{ status: 200, headers: { "content-type": "application/atom+xml" } },
							);
						}

						return new Response(
							"<html><h1>Upgrade Monitor</h1><title>Memory Defaults</title></html>",
							{ status: 200 },
						);
					}) as typeof fetch,
					now: () => new Date("2020-01-10T04:05:06.000Z"),
					getTranscript: async () => "Transcript from memory defaults contract",
					learningContext: {
						ratingsPath,
						failuresRoot,
					},
				},
			});

			const expectedStateFile = path.join(stateDir, "last-check.json");
			const expectedRunHistory = path.join(stateDir, "run-history.jsonl");
			const expectedRecommendationHistory = path.join(stateDir, "recommendation-history.jsonl");
			const expectedYoutubeStateFile = path.join(stateDir, "youtube-videos.json");
			const expectedTranscriptFile = path.join(transcriptDir, "video-memory-default.txt");

			expect(existsSync(expectedStateFile)).toBe(true);
			expect(existsSync(expectedRunHistory)).toBe(true);
			expect(existsSync(expectedRecommendationHistory)).toBe(true);
			expect(existsSync(expectedYoutubeStateFile)).toBe(true);
			expect(existsSync(expectedTranscriptFile)).toBe(true);

			expect(result.summary.ranking.historyPath).toBe(path.resolve(expectedRecommendationHistory));
		} finally {
			if (originalHome === undefined) {
				delete process.env.HOME;
			} else {
				process.env.HOME = originalHome;
			}

			if (originalUserProfile === undefined) {
				delete process.env.USERPROFILE;
			} else {
				process.env.USERPROFILE = originalUserProfile;
			}

			await rm(root, { recursive: true, force: true });
		}
	});

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
