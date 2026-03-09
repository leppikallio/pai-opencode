import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { runMonitor } from "../../skills/utilities/pai-upgrade/Tools/MonitorSources";

describe("pai-upgrade report contract", () => {
  test("runMonitor returns canonical report sections with recommendation-target mapping", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pai-upgrade-report-contract-"));

    try {
      const sourcesPath = path.join(root, "sources.v2.json");
      const ratingsPath = path.join(root, "learning", "ratings.jsonl");
      const failuresRoot = path.join(root, "learning", "FAILURES");

      await mkdir(path.dirname(ratingsPath), { recursive: true });
      await mkdir(failuresRoot, { recursive: true });

      await writeFile(
        sourcesPath,
        `${JSON.stringify({
          schema_version: 2,
          sources: [
            {
              id: "docs-pai-upgrade-intelligence",
              provider: "test",
              category: "docs",
              name: "PAI Upgrade Intelligence Docs",
              url: "https://example.test/pai-upgrade/docs",
              priority: "HIGH",
              type: "docs",
            },
          ],
        })}\n`,
        "utf-8",
      );

      await writeFile(
        ratingsPath,
        `${JSON.stringify({
          timestamp: "2026-03-01T10:00:00.000Z",
          rating: 9,
          source: "explicit",
          sentiment_summary: "Great verification discipline and clear upgrade recommendations",
        })}\n`,
        "utf-8",
      );

      const result = await runMonitor({
        days: 7,
        force: true,
        provider: "test",
        dryRun: true,
        format: "json",
        persistHistory: false,
        runtime: {
          fetch: (async () => new Response("<html><title>PAI Upgrade Intelligence Runtime Shift</title></html>", { status: 200 })) as unknown as typeof fetch,
          sourcesV2ConfigPath: sourcesPath,
          learningContext: {
            ratingsPath,
            failuresRoot,
          },
        },
      });

      expect(Array.isArray(result.report.discoveries)).toBe(true);
      expect(Array.isArray(result.report.recommendations)).toBe(true);
      expect(Array.isArray(result.report.implementation_targets)).toBe(true);

      expect(result.report.discoveries.length).toBeGreaterThan(0);
      expect(result.report.recommendations.length).toBeGreaterThan(0);
      expect(result.report.implementation_targets.length).toBeGreaterThan(0);

      for (const discovery of result.report.discoveries) {
        expect(discovery.id.length).toBeGreaterThan(0);
      }

      const targetIds = new Set(result.report.implementation_targets.map((target) => target.id));
      for (const recommendation of result.report.recommendations) {
        expect(["critical", "high", "medium", "low"].includes(recommendation.priority)).toBe(true);
        expect(recommendation.implementation_target_ids.length).toBeGreaterThan(0);
        for (const targetId of recommendation.implementation_target_ids) {
          expect(targetIds.has(targetId)).toBe(true);
        }
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("youtube discovery and ranking identity stay anchored to canonical video id across runs", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pai-upgrade-youtube-identity-contract-"));

    try {
      const sourcesPathFirst = path.join(root, "sources-first.v2.json");
      const sourcesPathSecond = path.join(root, "sources-second.v2.json");
      const youtubeChannelsPath = path.join(root, "youtube-channels.json");
      const ratingsPath = path.join(root, "learning", "ratings.jsonl");
      const failuresRoot = path.join(root, "learning", "FAILURES");

      await mkdir(path.dirname(ratingsPath), { recursive: true });
      await mkdir(failuresRoot, { recursive: true });

      await writeFile(
        sourcesPathFirst,
        `${JSON.stringify({
          schema_version: 2,
          sources: [
            {
              id: "docs-primary",
              provider: "test",
              category: "docs",
              name: "Primary Docs",
              url: "https://example.test/docs/primary",
              priority: "MEDIUM",
              type: "docs",
            },
          ],
        }, null, 2)}\n`,
        "utf-8",
      );

      await writeFile(
        sourcesPathSecond,
        `${JSON.stringify({
          schema_version: 2,
          sources: [
            {
              id: "docs-primary",
              provider: "test",
              category: "docs",
              name: "Primary Docs",
              url: "https://example.test/docs/primary",
              priority: "MEDIUM",
              type: "docs",
            },
            {
              id: "docs-secondary",
              provider: "test",
              category: "docs",
              name: "Secondary Docs",
              url: "https://example.test/docs/secondary",
              priority: "LOW",
              type: "docs",
            },
          ],
        }, null, 2)}\n`,
        "utf-8",
      );

      const channelId = "UCx1234567890";
      await writeFile(
        youtubeChannelsPath,
        `${JSON.stringify({
          schema_version: 1,
          channels: [
            {
              channel_id: channelId,
              provider: "test",
              name: "PAI Upgrade Channel",
              priority: "HIGH",
              feed_url: `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`,
            },
          ],
        }, null, 2)}\n`,
        "utf-8",
      );

      await writeFile(
        ratingsPath,
        `${JSON.stringify({
          timestamp: "2026-03-09T10:00:00.000Z",
          rating: 8,
          source: "explicit",
          sentiment_summary: "Recommendations should stay stable across monitor runs",
        })}\n`,
        "utf-8",
      );

      const videoId = "dQw4w9WgXcQ";
      const canonicalVideoId = `youtube:${videoId}`;
      const youtubeFeed = `<?xml version="1.0" encoding="UTF-8"?>
<feed>
  <entry>
    <yt:videoId>${videoId}</yt:videoId>
    <title>PAI Upgrade Intelligence Deep Dive</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=${videoId}" />
    <published>2026-03-08T08:00:00+00:00</published>
    <updated>2026-03-08T08:00:00+00:00</updated>
  </entry>
</feed>`;

      const deterministicFetch = (async (input: unknown) => {
        const requestUrl = typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : (input as { url?: string } | null)?.url || "";

        if (requestUrl.includes("/feeds/videos.xml")) {
          return new Response(youtubeFeed, { status: 200 });
        }

        return new Response("<html><title>Docs refresh</title></html>", { status: 200 });
      }) as unknown as typeof fetch;

      const runFirst = await runMonitor({
        days: 14,
        force: true,
        provider: "test",
        dryRun: true,
        format: "json",
        persistHistory: false,
        runtime: {
          fetch: deterministicFetch,
          now: () => new Date("2026-03-09T12:00:00.000Z"),
          sourcesV2ConfigPath: sourcesPathFirst,
          youtubeChannelsConfigPath: youtubeChannelsPath,
          learningContext: {
            ratingsPath,
            failuresRoot,
          },
        },
      });

      const runSecond = await runMonitor({
        days: 14,
        force: true,
        provider: "test",
        dryRun: true,
        format: "json",
        persistHistory: false,
        runtime: {
          fetch: deterministicFetch,
          now: () => new Date("2026-03-09T12:00:00.000Z"),
          sourcesV2ConfigPath: sourcesPathSecond,
          youtubeChannelsConfigPath: youtubeChannelsPath,
          learningContext: {
            ratingsPath,
            failuresRoot,
          },
        },
      });

      const firstYouTubeUpdate = runFirst.updates.find((update) => update.canonical_id === canonicalVideoId);
      const secondYouTubeUpdate = runSecond.updates.find((update) => update.canonical_id === canonicalVideoId);
      expect(firstYouTubeUpdate).toBeDefined();
      expect(secondYouTubeUpdate).toBeDefined();

      expect(firstYouTubeUpdate?.ranking_id).toBe(`ranking:${canonicalVideoId}`);
      expect(secondYouTubeUpdate?.ranking_id).toBe(`ranking:${canonicalVideoId}`);
      expect(firstYouTubeUpdate?.ranking_id).toBe(secondYouTubeUpdate?.ranking_id);

      const firstYouTubeDiscovery = runFirst.report.discoveries.find((discovery) => discovery.id === canonicalVideoId);
      const secondYouTubeDiscovery = runSecond.report.discoveries.find((discovery) => discovery.id === canonicalVideoId);
      expect(firstYouTubeDiscovery).toBeDefined();
      expect(secondYouTubeDiscovery).toBeDefined();

      const firstYouTubeRecommendation = runFirst.report.recommendations.find((recommendation) => recommendation.discovery_ids.includes(canonicalVideoId));
      const secondYouTubeRecommendation = runSecond.report.recommendations.find((recommendation) => recommendation.discovery_ids.includes(canonicalVideoId));

      expect(firstYouTubeRecommendation?.id).toBe(`recommendation:${canonicalVideoId}`);
      expect(secondYouTubeRecommendation?.id).toBe(`recommendation:${canonicalVideoId}`);
      expect(firstYouTubeRecommendation?.id).toBe(secondYouTubeRecommendation?.id);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
