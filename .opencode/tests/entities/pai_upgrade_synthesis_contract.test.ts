import { describe, expect, test } from "bun:test";
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

describe("pai-upgrade synthesis contract", () => {
  test("internal reflection themes and external discoveries share one ranked pipeline", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pai-upgrade-synthesis-contract-"));

    try {
      const sourcesV2Path = path.join(root, "sources.v2.json");
      const ratingsPath = path.join(root, "learning", "ratings.jsonl");
      const failuresRoot = path.join(root, "learning", "FAILURES");
      const reflectionsPath = path.join(root, "learning", "REFLECTIONS", "algorithm-reflections.jsonl");

      await mkdir(path.dirname(ratingsPath), { recursive: true });
      await mkdir(path.dirname(reflectionsPath), { recursive: true });
      await mkdir(failuresRoot, { recursive: true });

      await writeFile(
        sourcesV2Path,
        `${JSON.stringify({
          schema_version: 2,
          sources: [
            {
              id: "external-docs",
              provider: "test",
              category: "docs",
              name: "External Runtime Docs",
              url: "https://example.test/external/docs",
              priority: "LOW",
              type: "docs",
            },
          ],
        }, null, 2)}\n`,
        "utf-8",
      );

      await writeFile(
        ratingsPath,
        `${JSON.stringify({
          timestamp: "2026-03-08T11:00:00.000Z",
          rating: 7,
          source: "explicit",
          sentiment_summary: "Monitor pipeline is stable",
        })}\n`,
        "utf-8",
      );

      await writeFile(reflectionsPath, await readFile(fixturePath("internal-reflections.jsonl"), "utf-8"), "utf-8");

      const deterministicFetch = (async () => new Response("<html><h1>Routine docs update</h1><title>Routine docs update</title></html>", { status: 200 })) as unknown as typeof fetch;

      const result = await runMonitor({
        days: 14,
        force: true,
        provider: "test",
        dryRun: true,
        format: "json",
        persistHistory: false,
        runtime: {
          fetch: deterministicFetch,
          now: () => new Date("2026-03-08T12:00:00.000Z"),
          sourcesV2ConfigPath: sourcesV2Path,
          learningContext: {
            ratingsPath,
            failuresRoot,
            reflectionsPath,
          },
        },
      });

      const internal = result.updates.filter((entry) => entry.origin === "internal");
      const external = result.updates.filter((entry) => entry.origin === "external");

      expect(internal.length).toBeGreaterThan(0);
      expect(external.length).toBeGreaterThan(0);
      expect(result.updates[0]?.origin).toBe("internal");
      expect((result.updates[0]?.adjusted_score ?? Number.NEGATIVE_INFINITY)).toBeGreaterThan(
        external[0]?.adjusted_score ?? Number.NEGATIVE_INFINITY,
      );
      expect(internal.some((entry) => entry.source_id.startsWith("internal-reflection-"))).toBe(true);

      expect(result.report.discoveries.length).toBe(result.updates.length);
      expect(result.report.recommendations.length).toBe(result.updates.length);
      expect(result.report.implementation_targets.length).toBeGreaterThan(0);

      const discoveryIds = new Set(result.report.discoveries.map((discovery) => discovery.id));
      for (const recommendation of result.report.recommendations) {
        expect(["critical", "high", "medium", "low"].includes(recommendation.priority)).toBe(true);
        expect(recommendation.discovery_ids.length).toBeGreaterThan(0);
        for (const discoveryId of recommendation.discovery_ids) {
          expect(discoveryIds.has(discoveryId)).toBe(true);
        }
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
