import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
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

async function writeSourcesConfig(filePath: string): Promise<void> {
  await writeFile(
    filePath,
    `${JSON.stringify({
      schema_version: 2,
      sources: [
        {
          id: "community-noop",
          provider: "test",
          category: "community",
          name: "Internal Signals",
          priority: "LOW",
        },
      ],
    }, null, 2)}\n`,
    "utf-8",
  );
}

async function writeYoutubeChannelsConfig(filePath: string): Promise<void> {
  await writeFile(
    filePath,
    `${JSON.stringify({
      schema_version: 1,
      channels: [
        {
          channel_id: "UCxExampleDeterministicFixture",
          provider: "test",
          priority: "HIGH",
          name: "PAI Upgrade Signals",
        },
      ],
    }, null, 2)}\n`,
    "utf-8",
  );
}

async function writeFeedUrlOnlyYoutubeChannelsConfig(filePath: string): Promise<void> {
  await writeFile(
    filePath,
    `${JSON.stringify({
      schema_version: 1,
      channels: [
        {
          feed_url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCxExampleDeterministicFixture",
          provider: "test",
          priority: "HIGH",
          name: "Feed URL Only Channel",
        },
      ],
    }, null, 2)}\n`,
    "utf-8",
  );
}

async function writeYoutubeChannelsWithCustomEntries(
  filePath: string,
  channels: Array<Record<string, unknown>>,
): Promise<void> {
  await writeFile(
    filePath,
    `${JSON.stringify({
      schema_version: 1,
      channels,
    }, null, 2)}\n`,
    "utf-8",
  );
}

function buildAtomFeed(entries: Array<{
  videoId: string;
  title: string;
  publishedAt: string;
  updatedAt?: string;
}>): string {
  const renderedEntries = entries.map((entry) => {
    const updatedAt = entry.updatedAt || entry.publishedAt;
    return `<entry>\n  <id>yt:video:${entry.videoId}</id>\n  <yt:videoId>${entry.videoId}</yt:videoId>\n  <title>${entry.title}</title>\n  <link rel="alternate" href="https://www.youtube.com/watch?v=${entry.videoId}"/>\n  <published>${entry.publishedAt}</published>\n  <updated>${updatedAt}</updated>\n</entry>`;
  });

  return `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:yt="http://www.youtube.com/xml/schemas/2015">${renderedEntries.join("\n")}\n</feed>`;
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
      sentiment_summary: "YouTube seams and parser contracts",
    })}\n`,
    "utf-8",
  );
  return { ratingsPath, failuresRoot };
}

describe("pai-upgrade youtube parser/runtime seams contract", () => {
  test("accepts feed_url-only channels and discovers updates", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pai-upgrade-youtube-feed-url-only-"));

    try {
      const sourcesV2Path = path.join(root, "sources.v2.json");
      const youtubeChannelsConfigPath = path.join(root, "youtube-channels.json");

      await mkdir(path.dirname(sourcesV2Path), { recursive: true });
      await mkdir(path.dirname(youtubeChannelsConfigPath), { recursive: true });

      await writeSourcesConfig(sourcesV2Path);
      await writeFeedUrlOnlyYoutubeChannelsConfig(youtubeChannelsConfigPath);

      const { ratingsPath, failuresRoot } = await writeRatingsAndFailures(root);
      const atomFixture = await readFile(fixturePath("youtube-feed.sample.xml"), "utf-8");

      const result = await runMonitor({
        days: 30,
        force: true,
        provider: "test",
        dryRun: true,
        format: "json",
        persistHistory: false,
        runtime: {
          fetch: (async (input: string | URL | Request) => {
            const url = String(input);
            if (url.includes("youtube.com/feeds/videos.xml")) {
              return new Response(atomFixture, { status: 200, headers: { "content-type": "application/atom+xml" } });
            }
            throw new Error(`Unexpected fetch URL: ${url}`);
          }) as typeof fetch,
          now: () => new Date("2026-03-05T09:30:00.000Z"),
          sourcesV2ConfigPath: sourcesV2Path,
          youtubeChannelsConfigPath,
          learningContext: {
            ratingsPath,
            failuresRoot,
          },
        },
      });

      const youtubeDiscoveries = result.report.discoveries.filter((entry) => entry.source_id === "youtube-UCxExampleDeterministicFixture");
      expect(youtubeDiscoveries).toHaveLength(2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("rejects legacy id-only youtube channels and skips discovery", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pai-upgrade-youtube-legacy-id-only-"));

    const originalWarn = console.warn;
    const warnings: string[] = [];
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(" "));
    };

    try {
      const sourcesV2Path = path.join(root, "sources.v2.json");
      const youtubeChannelsConfigPath = path.join(root, "youtube-channels.json");

      await mkdir(path.dirname(sourcesV2Path), { recursive: true });
      await mkdir(path.dirname(youtubeChannelsConfigPath), { recursive: true });

      await writeSourcesConfig(sourcesV2Path);
      await writeFile(
        youtubeChannelsConfigPath,
        `${JSON.stringify({
          schema_version: 1,
          channels: [
            {
              id: "UCxLegacyIdOnly",
              provider: "test",
              name: "Legacy ID only",
            },
          ],
        }, null, 2)}\n`,
        "utf-8",
      );

      const { ratingsPath, failuresRoot } = await writeRatingsAndFailures(root);
      let youtubeFetchCalls = 0;

      const result = await runMonitor({
        days: 30,
        force: true,
        provider: "test",
        dryRun: true,
        format: "json",
        persistHistory: false,
        runtime: {
          fetch: (async (input: string | URL | Request) => {
            const url = String(input);
            if (url.includes("youtube.com/feeds/videos.xml")) {
              youtubeFetchCalls += 1;
              return new Response("<feed></feed>", { status: 200, headers: { "content-type": "application/atom+xml" } });
            }
            throw new Error(`Unexpected fetch URL: ${url}`);
          }) as typeof fetch,
          now: () => new Date("2026-03-05T10:30:00.000Z"),
          sourcesV2ConfigPath: sourcesV2Path,
          youtubeChannelsConfigPath,
          learningContext: {
            ratingsPath,
            failuresRoot,
          },
        },
      });

      expect(result.summary.sourcesChecked).toBe(1);
      expect(youtubeFetchCalls).toBe(0);
      expect(result.report.discoveries.filter((entry) => entry.source_id.startsWith("youtube-"))).toHaveLength(0);
      expect(warnings.some((message) => (
        message.includes("requires at least one of channel_id or feed_url")
        && message.includes("Skipping YouTube discovery")
      ))).toBe(true);
    } finally {
      console.warn = originalWarn;
      await rm(root, { recursive: true, force: true });
    }
  });

  test("invalid youtube config warns + skips youtube while continuing catalog-backed monitoring", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pai-upgrade-youtube-invalid-config-"));

    const originalWarn = console.warn;
    const warnings: string[] = [];
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(" "));
    };

    try {
      const sourcesV2Path = path.join(root, "sources.v2.json");
      const youtubeChannelsConfigPath = path.join(root, "youtube-channels.json");

      await mkdir(path.dirname(sourcesV2Path), { recursive: true });
      await mkdir(path.dirname(youtubeChannelsConfigPath), { recursive: true });

      await writeFile(
        sourcesV2Path,
        `${JSON.stringify({
          schema_version: 2,
          sources: [
            {
              id: "blog-test",
              provider: "test",
              category: "blog",
              name: "Catalog Blog Source",
              priority: "MEDIUM",
              url: "https://example.com/blog",
            },
          ],
        }, null, 2)}\n`,
        "utf-8",
      );

      await writeFile(
        youtubeChannelsConfigPath,
        `${JSON.stringify({
          schema_version: 1,
          channels: [
            {
              name: "Missing both channel_id and feed_url",
              provider: "test",
            },
            {
              channel_id: "UCxInvalidFeedConfig",
              feed_url: "not-a-valid-url",
              provider: "test",
            },
          ],
        }, null, 2)}\n`,
        "utf-8",
      );

      const { ratingsPath, failuresRoot } = await writeRatingsAndFailures(root);
      let youtubeFetchCalls = 0;
      let blogFetchCalls = 0;

      const result = await runMonitor({
        days: 30,
        force: true,
        provider: "test",
        dryRun: true,
        format: "json",
        persistHistory: false,
        runtime: {
          fetch: (async (input: string | URL | Request) => {
            const url = String(input);
            if (url.includes("youtube.com/feeds/videos.xml")) {
              youtubeFetchCalls += 1;
              return new Response("<feed></feed>", { status: 200, headers: { "content-type": "application/atom+xml" } });
            }
            if (url === "https://example.com/blog") {
              blogFetchCalls += 1;
              return new Response("<html><head><title>Catalog Blog Source Update</title></head><body>ok</body></html>", { status: 200 });
            }
            throw new Error(`Unexpected fetch URL: ${url}`);
          }) as typeof fetch,
          now: () => new Date("2026-03-05T11:00:00.000Z"),
          sourcesV2ConfigPath: sourcesV2Path,
          youtubeChannelsConfigPath,
          learningContext: {
            ratingsPath,
            failuresRoot,
          },
        },
      });

      expect(blogFetchCalls).toBeGreaterThanOrEqual(1);
      expect(youtubeFetchCalls).toBe(0);
      expect(result.summary.sourcesChecked).toBe(1);
      expect(result.report.discoveries.filter((entry) => entry.source_id.startsWith("youtube-"))).toHaveLength(0);
      expect(warnings.some((message) => message.includes("youtube-channels.json") && message.includes("Skipping YouTube discovery"))).toBe(true);
    } finally {
      console.warn = originalWarn;
      await rm(root, { recursive: true, force: true });
    }
  });

  test("malformed youtube JSON is recoverable and skips YouTube discovery for the run", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pai-upgrade-youtube-malformed-json-"));

    const originalWarn = console.warn;
    const warnings: string[] = [];
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(" "));
    };

    try {
      const sourcesV2Path = path.join(root, "sources.v2.json");
      const youtubeChannelsConfigPath = path.join(root, "youtube-channels.json");

      await mkdir(path.dirname(sourcesV2Path), { recursive: true });
      await mkdir(path.dirname(youtubeChannelsConfigPath), { recursive: true });
      await writeSourcesConfig(sourcesV2Path);
      await writeFile(youtubeChannelsConfigPath, "{\n  \"schema_version\": 1,\n  \"channels\": [\n", "utf-8");

      const { ratingsPath, failuresRoot } = await writeRatingsAndFailures(root);
      let youtubeFetchCalls = 0;

      const result = await runMonitor({
        days: 30,
        force: true,
        provider: "test",
        dryRun: true,
        format: "json",
        persistHistory: false,
        runtime: {
          fetch: (async (input: string | URL | Request) => {
            const url = String(input);
            if (url.includes("youtube.com/feeds/videos.xml")) {
              youtubeFetchCalls += 1;
            }
            return new Response("<html><head><title>No-op</title></head><body></body></html>", { status: 200 });
          }) as typeof fetch,
          now: () => new Date("2026-03-05T12:00:00.000Z"),
          sourcesV2ConfigPath: sourcesV2Path,
          youtubeChannelsConfigPath,
          learningContext: {
            ratingsPath,
            failuresRoot,
          },
        },
      });

      expect(result.summary.sourcesChecked).toBe(1);
      expect(youtubeFetchCalls).toBe(0);
      expect(result.report.discoveries.filter((entry) => entry.source_id.startsWith("youtube-"))).toHaveLength(0);
      expect(warnings.some((message) => message.includes("youtube-channels.json") && message.includes("Skipping YouTube discovery"))).toBe(true);
    } finally {
      console.warn = originalWarn;
      await rm(root, { recursive: true, force: true });
    }
  });

  test("parses realistic Atom fixture and enforces dry-run + --days behavior", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pai-upgrade-youtube-dry-run-"));

    try {
      const sourcesV2Path = path.join(root, "sources.v2.json");
      const youtubeChannelsConfigPath = path.join(root, "youtube-channels.json");
      const youtubeStateFilePath = path.join(root, "runtime", "State", "youtube-videos.json");
      const youtubeTranscriptDir = path.join(root, "runtime", "State", "transcripts", "youtube");

      await mkdir(path.dirname(sourcesV2Path), { recursive: true });
      await mkdir(path.dirname(youtubeChannelsConfigPath), { recursive: true });

      await writeSourcesConfig(sourcesV2Path);
      await writeYoutubeChannelsConfig(youtubeChannelsConfigPath);

      const { ratingsPath, failuresRoot } = await writeRatingsAndFailures(root);
      expect(existsSync(fixturePath("youtube-feed.sample.xml"))).toBe(true);
      expect(existsSync(fixturePath("youtube-transcript.sample.txt"))).toBe(true);
      const atomFixture = await readFile(fixturePath("youtube-feed.sample.xml"), "utf-8");
      const transcriptFixture = await readFile(fixturePath("youtube-transcript.sample.txt"), "utf-8");

      const transcriptCalls: string[] = [];
      const deterministicFetch = (async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("youtube.com/feeds/videos.xml")) {
          return new Response(atomFixture, { status: 200, headers: { "content-type": "application/atom+xml" } });
        }
        throw new Error(`Unexpected fetch URL: ${url}`);
      }) as typeof fetch;

      const runtime = {
        fetch: deterministicFetch,
        now: () => new Date("2026-03-05T09:30:00.000Z"),
        sourcesV2ConfigPath: sourcesV2Path,
        youtubeChannelsConfigPath,
        youtubeStateFilePath,
        youtubeTranscriptDir,
        getTranscript: async (videoId: string) => {
          transcriptCalls.push(videoId);
          return transcriptFixture;
        },
        learningContext: {
          ratingsPath,
          failuresRoot,
        },
      };

      const dryRunResult = await runMonitor({
        days: 30,
        force: true,
        provider: "test",
        dryRun: true,
        format: "json",
        persistHistory: false,
        runtime,
      });

      const dryYoutube = dryRunResult.report.discoveries.filter((entry) => entry.source_id === "youtube-UCxExampleDeterministicFixture");
      expect(dryYoutube).toHaveLength(2);
      expect(dryYoutube.every((entry) => entry.provider === "ecosystem")).toBe(true);
      expect(dryYoutube.map((entry) => entry.id).sort()).toEqual([
        "youtube:a1B2c3D4e5F",
        "youtube:dQw4w9WgXcQ",
      ]);
      expect(dryYoutube.map((entry) => entry.title)).toContain("Release Intelligence Loop: Weekly Upgrade Review");
      expect(dryYoutube.map((entry) => entry.title)).toContain("How We Score Breaking Changes in 20 Minutes");

      const transcriptPathByTitle = new Map<string, unknown>(
        dryYoutube.map((entry) => [entry.title, (entry as unknown as Record<string, unknown>).transcript_path]),
      );
      expect(transcriptPathByTitle.get("Release Intelligence Loop: Weekly Upgrade Review")).toBe("State/transcripts/youtube/dQw4w9WgXcQ.txt");
      expect(transcriptPathByTitle.get("How We Score Breaking Changes in 20 Minutes")).toBe("State/transcripts/youtube/a1B2c3D4e5F.txt");

      const transcriptStatusByTitle = new Map<string, unknown>(
        dryYoutube.map((entry) => [entry.title, (entry as unknown as Record<string, unknown>).transcript_status]),
      );
      expect(transcriptStatusByTitle.get("Release Intelligence Loop: Weekly Upgrade Review")).toBe("not_attempted");
      expect(transcriptStatusByTitle.get("How We Score Breaking Changes in 20 Minutes")).toBe("not_attempted");

      expect(transcriptCalls).toHaveLength(0);
      expect(existsSync(youtubeStateFilePath)).toBe(false);
      expect(existsSync(youtubeTranscriptDir)).toBe(false);

      const sevenDayResult = await runMonitor({
        days: 7,
        force: true,
        provider: "test",
        dryRun: true,
        format: "json",
        persistHistory: false,
        runtime,
      });

      const sevenDayYoutube = sevenDayResult.report.discoveries.filter((entry) => entry.source_id === "youtube-UCxExampleDeterministicFixture");
      expect(sevenDayYoutube).toHaveLength(1);
      expect(sevenDayYoutube[0]?.title).toBe("Release Intelligence Loop: Weekly Upgrade Review");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("non-dry-run writes youtube state + transcript files with structured metadata", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pai-upgrade-youtube-persist-"));

    try {
      const sourcesV2Path = path.join(root, "sources.v2.json");
      const youtubeChannelsConfigPath = path.join(root, "youtube-channels.json");
      const youtubeStateFilePath = path.join(root, "runtime", "State", "youtube-videos.json");
      const youtubeTranscriptDir = path.join(root, "runtime", "State", "transcripts", "youtube");

      await mkdir(path.dirname(sourcesV2Path), { recursive: true });
      await mkdir(path.dirname(youtubeChannelsConfigPath), { recursive: true });

      await writeSourcesConfig(sourcesV2Path);
      await writeYoutubeChannelsConfig(youtubeChannelsConfigPath);

      const { ratingsPath, failuresRoot } = await writeRatingsAndFailures(root);
      expect(existsSync(fixturePath("youtube-feed.sample.xml"))).toBe(true);
      expect(existsSync(fixturePath("youtube-transcript.sample.txt"))).toBe(true);
      const atomFixture = await readFile(fixturePath("youtube-feed.sample.xml"), "utf-8");
      const transcriptFixture = await readFile(fixturePath("youtube-transcript.sample.txt"), "utf-8");
      const expectedCharCount = transcriptFixture.length;
      const expectedLineCount = transcriptFixture.split(/\r?\n/).length;
      const transcriptCalls: string[] = [];

      const deterministicFetch = (async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("youtube.com/feeds/videos.xml")) {
          return new Response(atomFixture, { status: 200, headers: { "content-type": "application/atom+xml" } });
        }
        throw new Error(`Unexpected fetch URL: ${url}`);
      }) as typeof fetch;

      const result = await runMonitor({
        days: 30,
        force: true,
        provider: "test",
        dryRun: false,
        format: "json",
        persistHistory: false,
        runtime: {
          fetch: deterministicFetch,
          now: () => new Date("2026-03-05T10:00:00.000Z"),
          sourcesV2ConfigPath: sourcesV2Path,
          youtubeChannelsConfigPath,
          youtubeStateFilePath,
          youtubeTranscriptDir,
          getTranscript: async (videoId: string) => {
            transcriptCalls.push(videoId);
            return transcriptFixture;
          },
          learningContext: {
            ratingsPath,
            failuresRoot,
          },
        },
      });

      expect(existsSync(youtubeStateFilePath)).toBe(true);
      expect(existsSync(path.join(youtubeTranscriptDir, "dQw4w9WgXcQ.txt"))).toBe(true);
      expect(existsSync(path.join(youtubeTranscriptDir, "a1B2c3D4e5F.txt"))).toBe(true);
      expect(transcriptCalls.sort()).toEqual(["a1B2c3D4e5F", "dQw4w9WgXcQ"]);

      const state = JSON.parse(readFileSync(youtubeStateFilePath, "utf-8")) as {
        channels: Record<string, {
          seen_videos?: string[];
          transcripts?: Record<string, {
            status?: string;
            retries?: number;
            path?: string;
          }>;
        }>;
      };
      expect(state.channels.UCxExampleDeterministicFixture?.seen_videos?.sort()).toEqual([
        "a1B2c3D4e5F",
        "dQw4w9WgXcQ",
      ]);
      expect(state.channels.UCxExampleDeterministicFixture?.transcripts?.dQw4w9WgXcQ?.status).toBe("extracted");
      expect(state.channels.UCxExampleDeterministicFixture?.transcripts?.a1B2c3D4e5F?.status).toBe("extracted");
      expect(state.channels.UCxExampleDeterministicFixture?.transcripts?.dQw4w9WgXcQ?.retries).toBe(1);

      const persistedYoutube = result.report.discoveries.filter((entry) => entry.source_id === "youtube-UCxExampleDeterministicFixture");
      expect(persistedYoutube).toHaveLength(2);
      expect(persistedYoutube.every((entry) => entry.provider === "ecosystem")).toBe(true);
      expect(persistedYoutube.map((entry) => entry.id).sort()).toEqual([
        "youtube:a1B2c3D4e5F",
        "youtube:dQw4w9WgXcQ",
      ]);

      const byTitle = new Map(persistedYoutube.map((entry) => [entry.title, entry]));
      const first = byTitle.get("Release Intelligence Loop: Weekly Upgrade Review") as Record<string, unknown> | undefined;
      const second = byTitle.get("How We Score Breaking Changes in 20 Minutes") as Record<string, unknown> | undefined;
      expect(first?.transcript_path).toBe("State/transcripts/youtube/dQw4w9WgXcQ.txt");
      expect(second?.transcript_path).toBe("State/transcripts/youtube/a1B2c3D4e5F.txt");
      expect(first?.transcript_status).toBe("extracted");
      expect(second?.transcript_status).toBe("extracted");
      expect(typeof first?.transcript_excerpt).toBe("string");
      expect(typeof second?.transcript_excerpt).toBe("string");
      expect((first?.transcript_excerpt as string).length).toBeGreaterThan(0);
      expect((second?.transcript_excerpt as string).length).toBeGreaterThan(0);
      expect((first?.transcript_excerpt as string).length).toBeLessThanOrEqual(240);
      expect((second?.transcript_excerpt as string).length).toBeLessThanOrEqual(240);
      expect(first?.transcript_char_count).toBe(expectedCharCount);
      expect(second?.transcript_char_count).toBe(expectedCharCount);
      expect(first?.transcript_line_count).toBe(expectedLineCount);
      expect(second?.transcript_line_count).toBe(expectedLineCount);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("malformed youtube videos state is recoverable without aborting discovery", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pai-upgrade-youtube-malformed-state-"));

    try {
      const sourcesV2Path = path.join(root, "sources.v2.json");
      const youtubeChannelsConfigPath = path.join(root, "youtube-channels.json");
      const youtubeStateFilePath = path.join(root, "runtime", "State", "youtube-videos.json");
      const youtubeTranscriptDir = path.join(root, "runtime", "State", "transcripts", "youtube");

      await mkdir(path.dirname(sourcesV2Path), { recursive: true });
      await mkdir(path.dirname(youtubeChannelsConfigPath), { recursive: true });
      await mkdir(path.dirname(youtubeStateFilePath), { recursive: true });

      await writeSourcesConfig(sourcesV2Path);
      await writeYoutubeChannelsConfig(youtubeChannelsConfigPath);
      await writeFile(youtubeStateFilePath, "{\n  \"schema_version\": 1,\n  \"channels\": ", "utf-8");

      const { ratingsPath, failuresRoot } = await writeRatingsAndFailures(root);
      const atomFixture = await readFile(fixturePath("youtube-feed.sample.xml"), "utf-8");
      const transcriptFixture = await readFile(fixturePath("youtube-transcript.sample.txt"), "utf-8");

      const result = await runMonitor({
        days: 30,
        force: true,
        provider: "test",
        dryRun: false,
        format: "json",
        persistHistory: false,
        runtime: {
          fetch: (async (input: string | URL | Request) => {
            const url = String(input);
            if (url.includes("youtube.com/feeds/videos.xml")) {
              return new Response(atomFixture, { status: 200, headers: { "content-type": "application/atom+xml" } });
            }
            throw new Error(`Unexpected fetch URL: ${url}`);
          }) as typeof fetch,
          now: () => new Date("2026-03-06T08:00:00.000Z"),
          sourcesV2ConfigPath: sourcesV2Path,
          youtubeChannelsConfigPath,
          youtubeStateFilePath,
          youtubeTranscriptDir,
          getTranscript: async () => transcriptFixture,
          learningContext: {
            ratingsPath,
            failuresRoot,
          },
        },
      });

      expect(result.report.discoveries.filter((entry) => entry.source_id === "youtube-UCxExampleDeterministicFixture")).toHaveLength(2);
      const recoveredState = JSON.parse(readFileSync(youtubeStateFilePath, "utf-8")) as {
        channels?: Record<string, { seen_videos?: string[] }>;
      };
      expect(Array.isArray(recoveredState.channels?.UCxExampleDeterministicFixture?.seen_videos)).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("non-dry-run dedupes across runs and only emits newly added videos", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pai-upgrade-youtube-multi-run-dedupe-"));

    try {
      const sourcesV2Path = path.join(root, "sources.v2.json");
      const youtubeChannelsConfigPath = path.join(root, "youtube-channels.json");
      const youtubeStateFilePath = path.join(root, "runtime", "State", "youtube-videos.json");

      await mkdir(path.dirname(sourcesV2Path), { recursive: true });
      await mkdir(path.dirname(youtubeChannelsConfigPath), { recursive: true });

      await writeSourcesConfig(sourcesV2Path);
      await writeYoutubeChannelsConfig(youtubeChannelsConfigPath);

      const { ratingsPath, failuresRoot } = await writeRatingsAndFailures(root);

      const run1Feed = buildAtomFeed([
        {
          videoId: "video-run1-a",
          title: "Run 1 A",
          publishedAt: "2026-03-06T10:00:00.000Z",
        },
        {
          videoId: "video-run1-b",
          title: "Run 1 B",
          publishedAt: "2026-03-06T09:00:00.000Z",
        },
      ]);

      const run3Feed = buildAtomFeed([
        {
          videoId: "video-run3-new",
          title: "Run 3 New",
          publishedAt: "2026-03-06T11:00:00.000Z",
        },
        {
          videoId: "video-run1-a",
          title: "Run 1 A",
          publishedAt: "2026-03-06T10:00:00.000Z",
        },
        {
          videoId: "video-run1-b",
          title: "Run 1 B",
          publishedAt: "2026-03-06T09:00:00.000Z",
        },
      ]);

      let runIndex = 0;
      const feeds = [run1Feed, run1Feed, run3Feed];

      const runtime = {
        fetch: (async (input: string | URL | Request) => {
          const url = String(input);
          if (!url.includes("youtube.com/feeds/videos.xml")) {
            throw new Error(`Unexpected fetch URL: ${url}`);
          }
          const feed = feeds[Math.min(runIndex, feeds.length - 1)] || run1Feed;
          runIndex += 1;
          return new Response(feed, { status: 200, headers: { "content-type": "application/atom+xml" } });
        }) as typeof fetch,
        now: () => new Date("2026-03-06T12:00:00.000Z"),
        sourcesV2ConfigPath: sourcesV2Path,
        youtubeChannelsConfigPath,
        youtubeStateFilePath,
        getTranscript: async () => null,
        learningContext: {
          ratingsPath,
          failuresRoot,
        },
      };

      const run1 = await runMonitor({
        days: 30,
        force: false,
        provider: "test",
        dryRun: false,
        format: "json",
        persistHistory: false,
        runtime,
      });
      expect(run1.report.discoveries.filter((entry) => entry.source_id === "youtube-UCxExampleDeterministicFixture")).toHaveLength(2);
      expect(existsSync(youtubeStateFilePath)).toBe(true);

      const run2 = await runMonitor({
        days: 30,
        force: false,
        provider: "test",
        dryRun: false,
        format: "json",
        persistHistory: false,
        runtime,
      });
      expect(run2.report.discoveries.filter((entry) => entry.source_id === "youtube-UCxExampleDeterministicFixture")).toHaveLength(0);

      const run3 = await runMonitor({
        days: 30,
        force: false,
        provider: "test",
        dryRun: false,
        format: "json",
        persistHistory: false,
        runtime,
      });
      const run3Youtube = run3.report.discoveries.filter((entry) => entry.source_id === "youtube-UCxExampleDeterministicFixture");
      expect(run3Youtube).toHaveLength(1);
      expect(run3Youtube[0]?.id).toBe("youtube:video-run3-new");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("fetch 500 and malformed feed XML stay recoverable", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pai-upgrade-youtube-feed-errors-"));

    try {
      const sourcesV2Path = path.join(root, "sources.v2.json");
      const youtubeChannelsConfigPath = path.join(root, "youtube-channels.json");

      await mkdir(path.dirname(sourcesV2Path), { recursive: true });
      await mkdir(path.dirname(youtubeChannelsConfigPath), { recursive: true });

      await writeSourcesConfig(sourcesV2Path);
      await writeYoutubeChannelsConfig(youtubeChannelsConfigPath);

      const { ratingsPath, failuresRoot } = await writeRatingsAndFailures(root);

      const failingRun = await runMonitor({
        days: 30,
        force: true,
        provider: "test",
        dryRun: true,
        format: "json",
        persistHistory: false,
        runtime: {
          fetch: (async () => new Response("feed failed", { status: 500 })) as unknown as typeof fetch,
          now: () => new Date("2026-03-06T12:30:00.000Z"),
          sourcesV2ConfigPath: sourcesV2Path,
          youtubeChannelsConfigPath,
          learningContext: {
            ratingsPath,
            failuresRoot,
          },
        },
      });
      expect(failingRun.report.discoveries.filter((entry) => entry.source_id.startsWith("youtube-"))).toHaveLength(0);

      const malformedXmlRun = await runMonitor({
        days: 30,
        force: true,
        provider: "test",
        dryRun: true,
        format: "json",
        persistHistory: false,
        runtime: {
          fetch: (async () => new Response("<feed><entry><title>broken</title>", {
            status: 200,
            headers: { "content-type": "application/atom+xml" },
          })) as unknown as typeof fetch,
          now: () => new Date("2026-03-06T12:31:00.000Z"),
          sourcesV2ConfigPath: sourcesV2Path,
          youtubeChannelsConfigPath,
          learningContext: {
            ratingsPath,
            failuresRoot,
          },
        },
      });

      expect(malformedXmlRun.report.discoveries.filter((entry) => entry.source_id.startsWith("youtube-"))).toHaveLength(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("one channel failure does not block another successful channel", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pai-upgrade-youtube-partial-channel-failure-"));

    try {
      const sourcesV2Path = path.join(root, "sources.v2.json");
      const youtubeChannelsConfigPath = path.join(root, "youtube-channels.json");

      await mkdir(path.dirname(sourcesV2Path), { recursive: true });
      await mkdir(path.dirname(youtubeChannelsConfigPath), { recursive: true });

      await writeSourcesConfig(sourcesV2Path);
      await writeYoutubeChannelsWithCustomEntries(youtubeChannelsConfigPath, [
        {
          channel_id: "UCchannelFails",
          provider: "test",
          priority: "HIGH",
          name: "Fails",
        },
        {
          channel_id: "UCchannelSucceeds",
          provider: "test",
          priority: "HIGH",
          name: "Succeeds",
        },
      ]);

      const { ratingsPath, failuresRoot } = await writeRatingsAndFailures(root);
      const successFeed = buildAtomFeed([
        {
          videoId: "channel-success-video",
          title: "Successful Channel Upload",
          publishedAt: "2026-03-06T10:00:00.000Z",
        },
      ]);

      const result = await runMonitor({
        days: 30,
        force: true,
        provider: "test",
        dryRun: true,
        format: "json",
        persistHistory: false,
        runtime: {
          fetch: (async (input: string | URL | Request) => {
            const url = String(input);
            if (url.includes("UCchannelFails")) {
              return new Response("fail", { status: 500 });
            }
            if (url.includes("UCchannelSucceeds")) {
              return new Response(successFeed, { status: 200, headers: { "content-type": "application/atom+xml" } });
            }
            throw new Error(`Unexpected fetch URL: ${url}`);
          }) as typeof fetch,
          now: () => new Date("2026-03-06T13:00:00.000Z"),
          sourcesV2ConfigPath: sourcesV2Path,
          youtubeChannelsConfigPath,
          learningContext: {
            ratingsPath,
            failuresRoot,
          },
        },
      });

      expect(result.report.discoveries.filter((entry) => entry.source_id === "youtube-UCchannelFails")).toHaveLength(0);
      expect(result.report.discoveries.filter((entry) => entry.source_id === "youtube-UCchannelSucceeds")).toHaveLength(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("derives feed URL from channel_id when feed_url is omitted", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pai-upgrade-youtube-channel-id-feed-url-"));

    try {
      const sourcesV2Path = path.join(root, "sources.v2.json");
      const youtubeChannelsConfigPath = path.join(root, "youtube-channels.json");

      await mkdir(path.dirname(sourcesV2Path), { recursive: true });
      await mkdir(path.dirname(youtubeChannelsConfigPath), { recursive: true });

      await writeSourcesConfig(sourcesV2Path);
      await writeYoutubeChannelsWithCustomEntries(youtubeChannelsConfigPath, [
        {
          channel_id: "UCderiveFeedFromChannelId",
          provider: "test",
          priority: "HIGH",
          name: "Derived Feed URL",
        },
      ]);

      const { ratingsPath, failuresRoot } = await writeRatingsAndFailures(root);
      const fetchedUrls: string[] = [];

      await runMonitor({
        days: 30,
        force: true,
        provider: "test",
        dryRun: true,
        format: "json",
        persistHistory: false,
        runtime: {
          fetch: (async (input: string | URL | Request) => {
            fetchedUrls.push(String(input));
            return new Response("<feed></feed>", { status: 200, headers: { "content-type": "application/atom+xml" } });
          }) as typeof fetch,
          now: () => new Date("2026-03-06T13:10:00.000Z"),
          sourcesV2ConfigPath: sourcesV2Path,
          youtubeChannelsConfigPath,
          learningContext: {
            ratingsPath,
            failuresRoot,
          },
        },
      });

      expect(fetchedUrls).toContain("https://www.youtube.com/feeds/videos.xml?channel_id=UCderiveFeedFromChannelId");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("transcript retries persist pending_retry then unavailable without infinite novelty churn", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pai-upgrade-youtube-transcript-retries-"));

    try {
      const sourcesV2Path = path.join(root, "sources.v2.json");
      const youtubeChannelsConfigPath = path.join(root, "youtube-channels.json");
      const youtubeStateFilePath = path.join(root, "runtime", "State", "youtube-videos.json");

      await mkdir(path.dirname(sourcesV2Path), { recursive: true });
      await mkdir(path.dirname(youtubeChannelsConfigPath), { recursive: true });

      await writeSourcesConfig(sourcesV2Path);
      await writeYoutubeChannelsConfig(youtubeChannelsConfigPath);

      const { ratingsPath, failuresRoot } = await writeRatingsAndFailures(root);
      const feed = buildAtomFeed([
        {
          videoId: "retry-video",
          title: "Retry Video",
          publishedAt: "2026-03-06T10:00:00.000Z",
        },
      ]);
      let transcriptCalls = 0;

      const runtime = {
        fetch: (async () => new Response(feed, {
          status: 200,
          headers: { "content-type": "application/atom+xml" },
        })) as unknown as typeof fetch,
        now: () => new Date("2026-03-06T13:30:00.000Z"),
        sourcesV2ConfigPath: sourcesV2Path,
        youtubeChannelsConfigPath,
        youtubeStateFilePath,
        getTranscript: async () => {
          transcriptCalls += 1;
          throw new Error("Command timed out after 30000ms");
        },
        learningContext: {
          ratingsPath,
          failuresRoot,
        },
      };

      const run1 = await runMonitor({
        days: 30,
        force: true,
        provider: "test",
        dryRun: false,
        format: "json",
        persistHistory: false,
        runtime,
      });
      const run1Youtube = run1.report.discoveries.filter((entry) => entry.source_id === "youtube-UCxExampleDeterministicFixture");
      expect(run1Youtube).toHaveLength(1);
      expect((run1Youtube[0] as unknown as Record<string, unknown> | undefined)?.transcript_status).toBe("pending_retry");

      const run2 = await runMonitor({
        days: 30,
        force: true,
        provider: "test",
        dryRun: false,
        format: "json",
        persistHistory: false,
        runtime,
      });
      const run2Youtube = run2.report.discoveries.filter((entry) => entry.source_id === "youtube-UCxExampleDeterministicFixture");
      expect(run2Youtube).toHaveLength(1);
      expect((run2Youtube[0] as unknown as Record<string, unknown> | undefined)?.transcript_status).toBe("unavailable");

      const stateAfterRun2 = JSON.parse(readFileSync(youtubeStateFilePath, "utf-8")) as {
        channels?: Record<string, {
          transcripts?: Record<string, {
            status?: string;
            retries?: number;
            error_classification?: string;
          }>;
        }>;
      };
      const retryState = stateAfterRun2.channels?.UCxExampleDeterministicFixture?.transcripts?.["retry-video"];
      expect(retryState?.status).toBe("unavailable");
      expect(retryState?.retries).toBe(2);
      expect(retryState?.error_classification).toBe("timeout");

      const run3 = await runMonitor({
        days: 30,
        force: true,
        provider: "test",
        dryRun: false,
        format: "json",
        persistHistory: false,
        runtime,
      });
      const run3Youtube = run3.report.discoveries.filter((entry) => entry.source_id === "youtube-UCxExampleDeterministicFixture");
      expect(run3Youtube).toHaveLength(0);
      expect(transcriptCalls).toBe(2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("transcript throw and empty transcript stay classified and bounded", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pai-upgrade-youtube-transcript-error-paths-"));

    try {
      const sourcesV2Path = path.join(root, "sources.v2.json");
      const youtubeChannelsConfigPath = path.join(root, "youtube-channels.json");

      await mkdir(path.dirname(sourcesV2Path), { recursive: true });
      await mkdir(path.dirname(youtubeChannelsConfigPath), { recursive: true });

      await writeSourcesConfig(sourcesV2Path);
      await writeYoutubeChannelsConfig(youtubeChannelsConfigPath);

      const { ratingsPath, failuresRoot } = await writeRatingsAndFailures(root);
      const feed = buildAtomFeed([
        {
          videoId: "throw-video",
          title: "Throw Video",
          publishedAt: "2026-03-06T10:00:00.000Z",
        },
        {
          videoId: "empty-video",
          title: "Empty Video",
          publishedAt: "2026-03-06T09:00:00.000Z",
        },
      ]);

      const result = await runMonitor({
        days: 30,
        force: true,
        provider: "test",
        dryRun: false,
        format: "json",
        persistHistory: false,
        runtime: {
          fetch: (async () => new Response(feed, {
            status: 200,
            headers: { "content-type": "application/atom+xml" },
          })) as unknown as typeof fetch,
          now: () => new Date("2026-03-06T13:40:00.000Z"),
          sourcesV2ConfigPath: sourcesV2Path,
          youtubeChannelsConfigPath,
          getTranscript: async (videoId: string) => {
            if (videoId === "throw-video") {
              throw new Error(`yt-dlp exited with code 1 ${"x".repeat(800)}`);
            }
            return "\n\n   \n";
          },
          learningContext: {
            ratingsPath,
            failuresRoot,
          },
        },
      });

      const byId = new Map(result.report.discoveries.map((entry) => [entry.id, entry as unknown as Record<string, unknown>]));
      const throwVideo = byId.get("youtube:throw-video");
      const emptyVideo = byId.get("youtube:empty-video");

      expect(throwVideo?.transcript_status).toBe("pending_retry");
      expect((throwVideo?.transcript as Record<string, unknown> | undefined)?.error_classification).toBe("non_zero_exit");
      expect(typeof (throwVideo?.transcript as Record<string, unknown> | undefined)?.error).toBe("string");
      expect(((throwVideo?.transcript as Record<string, unknown> | undefined)?.error as string).length).toBeLessThanOrEqual(240);

      expect(emptyVideo?.transcript_status).toBe("empty");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("retains a bounded seen_videos set in youtube-videos state", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pai-upgrade-youtube-seen-videos-cap-"));

    try {
      const sourcesV2Path = path.join(root, "sources.v2.json");
      const youtubeChannelsConfigPath = path.join(root, "youtube-channels.json");
      const youtubeStateFilePath = path.join(root, "runtime", "State", "youtube-videos.json");

      await mkdir(path.dirname(sourcesV2Path), { recursive: true });
      await mkdir(path.dirname(youtubeChannelsConfigPath), { recursive: true });

      await writeSourcesConfig(sourcesV2Path);
      await writeYoutubeChannelsConfig(youtubeChannelsConfigPath);

      const { ratingsPath, failuresRoot } = await writeRatingsAndFailures(root);
      const entries: string[] = [];
      for (let i = 0; i < 140; i += 1) {
        const id = `video-${String(i).padStart(3, "0")}`;
        const publishedAt = new Date(Date.UTC(2026, 2, 6, 12, 0, 0) - i * 60_000).toISOString();
        entries.push(`\n<entry>\n  <id>yt:video:${id}</id>\n  <yt:videoId>${id}</yt:videoId>\n  <title>Video ${i}</title>\n  <link rel="alternate" href="https://www.youtube.com/watch?v=${id}"/>\n  <published>${publishedAt}</published>\n  <updated>${publishedAt}</updated>\n</entry>`);
      }
      const atomFixture = `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:yt="http://www.youtube.com/xml/schemas/2015">${entries.join("\n")}\n</feed>`;

      await runMonitor({
        days: 365,
        force: true,
        provider: "test",
        dryRun: false,
        format: "json",
        persistHistory: false,
        runtime: {
          fetch: (async (input: string | URL | Request) => {
            const url = String(input);
            if (url.includes("youtube.com/feeds/videos.xml")) {
              return new Response(atomFixture, { status: 200, headers: { "content-type": "application/atom+xml" } });
            }
            throw new Error(`Unexpected fetch URL: ${url}`);
          }) as typeof fetch,
          now: () => new Date("2026-03-06T12:00:00.000Z"),
          sourcesV2ConfigPath: sourcesV2Path,
          youtubeChannelsConfigPath,
          youtubeStateFilePath,
          getTranscript: async () => null,
          learningContext: {
            ratingsPath,
            failuresRoot,
          },
        },
      });

      const state = JSON.parse(readFileSync(youtubeStateFilePath, "utf-8")) as {
        channels?: Record<string, { seen_videos?: string[] }>;
      };
      expect(state.channels?.UCxExampleDeterministicFixture?.seen_videos).toHaveLength(100);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
