import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { runMonitor } from "../../skills/utilities/pai-upgrade/Tools/MonitorSources";

const repoRoot = path.basename(process.cwd()) === ".opencode"
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

const opencodeRoot = path.join(repoRoot, ".opencode");
const fixturesDir = path.join(opencodeRoot, "tests", "fixtures", "pai-upgrade");

function fixturePath(name: string): string {
  return path.join(fixturesDir, name);
}

async function writeAugmentedV2Config(destinationPath: string): Promise<void> {
  const validV2 = JSON.parse(await readFile(fixturePath("sources-v2.valid.json"), "utf-8")) as {
    schema_version: number;
    sources: Array<Record<string, unknown>>;
  };

  validV2.sources.push({
    id: "openai-blog",
    provider: "openai",
    category: "blog",
    name: "OpenAI Blog",
    url: "https://example.test/openai/blog",
    priority: "LOW",
    type: "blog",
  });

  await writeFile(destinationPath, `${JSON.stringify(validV2, null, 2)}\n`, "utf-8");
}

async function writeYouTubeChannelsConfig(destinationPath: string): Promise<void> {
  await writeFile(
    destinationPath,
    `${JSON.stringify({
      schema_version: 1,
      channels: [
        {
          channel_id: "UCxExampleDeterministicFixture",
          provider: "openai",
          name: "PAI Upgrade Signals",
          priority: "HIGH",
          feed_url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCxExampleDeterministicFixture",
        },
      ],
    }, null, 2)}\n`,
    "utf-8",
  );
}

async function writeRatingsAndFailures(root: string): Promise<{ ratingsPath: string; failuresRoot: string }> {
  const ratingsPath = path.join(root, "learning", "ratings.jsonl");
  const failuresRoot = path.join(root, "learning", "FAILURES");
  await mkdir(path.dirname(ratingsPath), { recursive: true });
  await mkdir(failuresRoot, { recursive: true });
  await writeFile(
    ratingsPath,
    `${JSON.stringify({
      timestamp: "2026-03-08T10:00:00.000Z",
      rating: 8,
      source: "explicit",
      sentiment_summary: "Strong monitor verification and deterministic seams",
    })}\n`,
    "utf-8",
  );
  return { ratingsPath, failuresRoot };
}

function createDeterministicFetch() {
  return async (input: string | URL | Request) => {
    const url = String(input);

    if (url.includes("/commits")) {
      return new Response(
        JSON.stringify([
          {
            sha: "abc123",
            html_url: "https://example.test/ecosystem/commit/abc123",
            commit: {
              message: "feat: deterministic monitor source contract",
              author: { date: "2026-03-08T10:00:00.000Z", name: "CI" },
            },
          },
        ]),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    if (url.includes("/releases")) {
      return new Response(
        JSON.stringify([
          {
            tag_name: "v3.7.0",
            name: "Deterministic Contracts",
            html_url: "https://example.test/ecosystem/release/v3.7.0",
            published_at: "2026-03-08T10:05:00.000Z",
            body: "Release notes",
          },
        ]),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    return new Response("<html><h1>Provider Update</h1><title>Provider Update</title></html>", { status: 200 });
  };
}

describe("pai-upgrade monitor source contracts", () => {
  test("provider filtering supports anthropic/ecosystem/openai/all", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pai-upgrade-provider-contract-"));

    try {
      const sourcesV2Path = path.join(root, "sources.v2.json");
      const youtubeChannelsPath = path.join(root, "youtube-channels.json");
      await writeAugmentedV2Config(sourcesV2Path);
      await writeYouTubeChannelsConfig(youtubeChannelsPath);
      const { ratingsPath, failuresRoot } = await writeRatingsAndFailures(root);
      const youtubeFeed = await readFile(fixturePath("youtube-feed.sample.xml"), "utf-8");
      const baseFetch = createDeterministicFetch();

      const runtime = {
        fetch: (async (input: string | URL | Request) => {
          const url = String(input);
          if (url.includes("youtube.com/feeds/videos.xml")) {
            return new Response(youtubeFeed, { status: 200, headers: { "content-type": "application/atom+xml" } });
          }
          return baseFetch(input);
        }) as typeof fetch,
        now: () => new Date("2026-03-08T10:10:00.000Z"),
        sourcesV2ConfigPath: sourcesV2Path,
        youtubeChannelsConfigPath: youtubeChannelsPath,
        learningContext: { ratingsPath, failuresRoot },
      };

      const anthropic = await runMonitor({
        days: 14,
        force: true,
        provider: "anthropic",
        dryRun: true,
        format: "json",
        persistHistory: false,
        runtime,
      });

      const ecosystem = await runMonitor({
        days: 14,
        force: true,
        provider: "ecosystem",
        dryRun: true,
        format: "json",
        persistHistory: false,
        runtime,
      });

      const openai = await runMonitor({
        days: 14,
        force: true,
        provider: "openai",
        dryRun: true,
        format: "json",
        persistHistory: false,
        runtime,
      });

      const all = await runMonitor({
        days: 14,
        force: true,
        provider: "all",
        dryRun: true,
        format: "json",
        persistHistory: false,
        runtime,
      });

      const anthropicSummary = anthropic.summary as Record<string, unknown>;
      expect(anthropic.summary.sourcesChecked).toBe(2);
      expect(anthropicSummary.catalogSourcesChecked).toBe(1);
      expect(anthropicSummary.youtubeChannelsChecked).toBe(1);
      expect(String(anthropicSummary.sourcesCheckedNote || "")).toContain("auxiliary");
      expect(String(anthropicSummary.sourcesCheckedNote || "")).toContain("YouTube");
      expect(anthropic.updates.some((entry) => entry.provider === "anthropic")).toBe(true);
      expect(anthropic.updates.some((entry) => entry.source_id === "ecosystem-github")).toBe(false);
      const anthropicYoutubeDiscoveries = anthropic.updates.filter((entry) => entry.source_id.startsWith("youtube-"));
      expect(anthropicYoutubeDiscoveries.length).toBeGreaterThan(0);
      expect(anthropicYoutubeDiscoveries.every((entry) => entry.provider === "ecosystem")).toBe(true);
      expect(anthropic.updates.some((entry) => entry.provider === "ecosystem")).toBe(true);

      expect(ecosystem.summary.sourcesChecked).toBe(2);
      expect(ecosystem.updates.every((entry) => entry.provider === "ecosystem")).toBe(true);

      expect(openai.summary.sourcesChecked).toBe(2);
      expect(openai.updates.some((entry) => entry.provider === "openai")).toBe(true);
      expect(openai.updates.some((entry) => entry.provider === "ecosystem")).toBe(true);

      expect(all.summary.sourcesChecked).toBe(4);
      expect(all.updates.some((entry) => entry.provider === "anthropic")).toBe(true);
      expect(all.updates.some((entry) => entry.provider === "ecosystem")).toBe(true);
      expect(all.updates.some((entry) => entry.provider === "openai")).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("uses v2 as primary and falls back to v1 when v2 is missing/empty", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pai-upgrade-v2-v1-fallback-"));

    try {
      const validV2Path = path.join(root, "sources.v2.valid.json");
      const emptyV2Path = path.join(root, "sources.v2.empty.json");
      const missingV2Path = path.join(root, "sources.v2.missing.json");
      const v1Path = path.join(root, "sources.v1.legacy.json");
      const isolatedYoutubeConfigPath = path.join(root, "youtube-channels.missing.json");

      await writeFile(validV2Path, await readFile(fixturePath("sources-v2.valid.json"), "utf-8"), "utf-8");
      await writeFile(emptyV2Path, await readFile(fixturePath("sources-v2.empty.json"), "utf-8"), "utf-8");
      await writeFile(v1Path, await readFile(fixturePath("sources-v1.legacy.json"), "utf-8"), "utf-8");

      const { ratingsPath, failuresRoot } = await writeRatingsAndFailures(root);

      const runtimeBase = {
        fetch: createDeterministicFetch() as typeof fetch,
        now: () => new Date("2026-03-08T10:15:00.000Z"),
        sourcesV1ConfigPath: v1Path,
        youtubeChannelsConfigPath: isolatedYoutubeConfigPath,
        learningContext: { ratingsPath, failuresRoot },
      };

      const fromV2 = await runMonitor({
        days: 14,
        force: true,
        provider: "anthropic",
        dryRun: true,
        format: "json",
        persistHistory: false,
        runtime: {
          ...runtimeBase,
          sourcesV2ConfigPath: validV2Path,
        },
      });

      const fromMissingV2 = await runMonitor({
        days: 14,
        force: true,
        provider: "anthropic",
        dryRun: true,
        format: "json",
        persistHistory: false,
        runtime: {
          ...runtimeBase,
          sourcesV2ConfigPath: missingV2Path,
        },
      });

      const fromEmptyV2 = await runMonitor({
        days: 14,
        force: true,
        provider: "anthropic",
        dryRun: true,
        format: "json",
        persistHistory: false,
        runtime: {
          ...runtimeBase,
          sourcesV2ConfigPath: emptyV2Path,
        },
      });

      expect(fromV2.summary.sourcesChecked).toBe(1);
      expect(fromV2.updates.some((entry) => entry.source_id === "anthropic-docs")).toBe(true);

      expect(fromMissingV2.summary.sourcesChecked).toBeGreaterThan(1);
      expect(fromMissingV2.updates.some((entry) => entry.source_id === "blog-anthropic-blog")).toBe(true);
      expect(fromMissingV2.updates.every((entry) => entry.provider === "anthropic")).toBe(true);

      const fromMissingV2All = await runMonitor({
        days: 14,
        force: true,
        provider: "all",
        dryRun: true,
        format: "json",
        persistHistory: false,
        runtime: {
          ...runtimeBase,
          sourcesV2ConfigPath: missingV2Path,
        },
      });

      expect(fromMissingV2All.summary.sourcesChecked).toBe(fromMissingV2.summary.sourcesChecked);
      expect(fromMissingV2All.updates.every((entry) => entry.provider === "anthropic")).toBe(true);

      await expect(runMonitor({
        days: 14,
        force: true,
        provider: "openai",
        dryRun: true,
        format: "json",
        persistHistory: false,
        runtime: {
          ...runtimeBase,
          sourcesV2ConfigPath: missingV2Path,
        },
      })).rejects.toThrow("Legacy fallback sources.json only supports providers 'anthropic' and 'all'");

      await expect(runMonitor({
        days: 14,
        force: true,
        provider: "ecosystem",
        dryRun: true,
        format: "json",
        persistHistory: false,
        runtime: {
          ...runtimeBase,
          sourcesV2ConfigPath: emptyV2Path,
        },
      })).rejects.toThrow("Legacy fallback sources.json only supports providers 'anthropic' and 'all'");

      expect(fromEmptyV2.summary.sourcesChecked).toBeGreaterThan(1);
      expect(fromEmptyV2.updates.some((entry) => entry.source_id === "blog-anthropic-blog")).toBe(true);
      expect(fromEmptyV2.updates.every((entry) => entry.provider === "anthropic")).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("malformed v2 falls back to v1 instead of aborting monitor run", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pai-upgrade-malformed-v2-"));

    try {
      const malformedV2Path = path.join(root, "sources.v2.malformed.json");
      const v1Path = path.join(root, "sources.v1.legacy.json");

      await writeFile(malformedV2Path, await readFile(fixturePath("sources-v2.malformed.json"), "utf-8"), "utf-8");
      await writeFile(v1Path, await readFile(fixturePath("sources-v1.legacy.json"), "utf-8"), "utf-8");

      const { ratingsPath, failuresRoot } = await writeRatingsAndFailures(root);

      const result = await runMonitor({
        days: 14,
        force: true,
        provider: "anthropic",
        dryRun: true,
        format: "json",
        persistHistory: false,
        runtime: {
          fetch: createDeterministicFetch() as typeof fetch,
          now: () => new Date("2026-03-08T10:20:00.000Z"),
          sourcesV2ConfigPath: malformedV2Path,
          sourcesV1ConfigPath: v1Path,
          learningContext: { ratingsPath, failuresRoot },
        },
      });

      expect(result.summary.sourcesChecked).toBeGreaterThan(1);
      expect(result.updates.some((entry) => entry.source_id === "blog-anthropic-blog")).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("dry-run keeps state, log, and recommendation history immutable", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pai-upgrade-dry-run-immutability-"));

    try {
      const sourcesV2Path = path.join(root, "sources.v2.json");
      const stateFilePath = path.join(root, "runtime", "state", "last-check.json");
      const runHistoryPath = path.join(root, "runtime", "logs", "run-history.jsonl");
      const recommendationHistoryPath = path.join(root, "runtime", "history", "recommendation-history.jsonl");

      await mkdir(path.dirname(stateFilePath), { recursive: true });
      await mkdir(path.dirname(runHistoryPath), { recursive: true });
      await mkdir(path.dirname(recommendationHistoryPath), { recursive: true });

      await writeFile(sourcesV2Path, await readFile(fixturePath("sources-v2.valid.json"), "utf-8"), "utf-8");

      const stateSeed = `${JSON.stringify({
        schema_version: 2,
        last_check_timestamp: "2026-03-01T00:00:00.000Z",
        sources: {},
      }, null, 2)}\n`;
      const logSeed = `${JSON.stringify({ timestamp: "2026-03-01T00:00:00.000Z", dry_run: false })}\n`;
      const historySeed = `${JSON.stringify({
        schema: "pai-upgrade.recommendation-history.v2",
        type: "seed",
        timestamp: "2026-01-01T00:00:00.000Z",
        note: "seed",
      })}\n`;

      await writeFile(stateFilePath, stateSeed, "utf-8");
      await writeFile(runHistoryPath, logSeed, "utf-8");
      await writeFile(recommendationHistoryPath, historySeed, "utf-8");

      const { ratingsPath, failuresRoot } = await writeRatingsAndFailures(root);

      await runMonitor({
        days: 14,
        force: true,
        provider: "anthropic",
        dryRun: true,
        format: "json",
        persistHistory: true,
        runtime: {
          fetch: createDeterministicFetch() as typeof fetch,
          now: () => new Date("2026-03-08T10:25:00.000Z"),
          sourcesV2ConfigPath: sourcesV2Path,
          stateFilePath,
          runHistoryPath,
          recommendationHistoryPath,
          learningContext: { ratingsPath, failuresRoot },
        },
      });

      expect(existsSync(stateFilePath)).toBe(true);
      expect(existsSync(runHistoryPath)).toBe(true);
      expect(existsSync(recommendationHistoryPath)).toBe(true);

      expect(await readFile(stateFilePath, "utf-8")).toBe(stateSeed);
      expect(await readFile(runHistoryPath, "utf-8")).toBe(logSeed);
      expect(await readFile(recommendationHistoryPath, "utf-8")).toBe(historySeed);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("unknown and empty providers reject with contract error", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pai-upgrade-provider-errors-"));

    try {
      const sourcesV2Path = path.join(root, "sources.v2.json");
      const youtubeChannelsPath = path.join(root, "youtube-channels.json");
      await writeAugmentedV2Config(sourcesV2Path);
      await writeYouTubeChannelsConfig(youtubeChannelsPath);
      const { ratingsPath, failuresRoot } = await writeRatingsAndFailures(root);
      let fetchCalls = 0;
      let transcriptCalls = 0;
      const baseFetch = createDeterministicFetch();

      const runtime = {
        fetch: (async (input: string | URL | Request) => {
          fetchCalls += 1;
          return baseFetch(input);
        }) as typeof fetch,
        getTranscript: async () => {
          transcriptCalls += 1;
          return null;
        },
        now: () => new Date("2026-03-08T10:30:00.000Z"),
        sourcesV2ConfigPath: sourcesV2Path,
        youtubeChannelsConfigPath: youtubeChannelsPath,
        learningContext: { ratingsPath, failuresRoot },
      };

      await expect(runMonitor({
        days: 14,
        force: true,
        provider: "unknown",
        dryRun: true,
        format: "json",
        persistHistory: false,
        runtime,
      })).rejects.toThrow("No sources found for provider 'unknown'. Available: anthropic, ecosystem, openai");

      await expect(runMonitor({
        days: 14,
        force: true,
        provider: "",
        dryRun: true,
        format: "json",
        persistHistory: false,
        runtime,
      })).rejects.toThrow("No sources found for provider ''. Available: anthropic, ecosystem, openai");

      expect(fetchCalls).toBe(0);
      expect(transcriptCalls).toBe(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
