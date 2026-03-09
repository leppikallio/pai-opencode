import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.basename(process.cwd()) === ".opencode"
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

const opencodeRoot = path.join(repoRoot, ".opencode");
const fixturesDir = path.join(opencodeRoot, "tests", "fixtures", "pai-upgrade");

const requiredFixtureFiles = [
  "sources-v2.valid.json",
  "sources-v2.empty.json",
  "sources-v2.malformed.json",
  "sources-v1.legacy.json",
  "monitor-response-anthropic.json",
  "monitor-response-ecosystem.json",
  "internal-reflections.jsonl",
  "youtube-feed.sample.xml",
  "youtube-transcript.sample.txt",
] as const;

function fixturePath(name: (typeof requiredFixtureFiles)[number]): string {
  return path.join(fixturesDir, name);
}

function readFixture(name: (typeof requiredFixtureFiles)[number]): string {
  return readFileSync(fixturePath(name), "utf8");
}

describe("pai-upgrade fixture contract", () => {
  test("required fixture files exist", () => {
    for (const fixture of requiredFixtureFiles) {
      expect(existsSync(fixturePath(fixture))).toBe(true);
    }
  });

  test("valid source fixtures parse with expected schema anchors", () => {
    const validV2 = JSON.parse(readFixture("sources-v2.valid.json")) as {
      schema_version: number;
      sources: Array<{ id: string; provider: string; category: string; name: string; priority: string }>;
    };
    expect(validV2.schema_version).toBe(2);
    expect(Array.isArray(validV2.sources)).toBe(true);
    expect(validV2.sources.length).toBeGreaterThan(0);
    expect(validV2.sources.some((source) => source.provider === "anthropic")).toBe(true);
    expect(validV2.sources.some((source) => source.provider === "ecosystem")).toBe(true);

    const emptyV2 = JSON.parse(readFixture("sources-v2.empty.json")) as { schema_version: number; sources: unknown[] };
    expect(emptyV2.schema_version).toBe(2);
    expect(Array.isArray(emptyV2.sources)).toBe(true);
    expect(emptyV2.sources).toHaveLength(0);

    const legacyV1 = JSON.parse(readFixture("sources-v1.legacy.json")) as {
      blogs?: unknown[];
      github_repos?: unknown[];
      changelogs?: unknown[];
      documentation?: unknown[];
      community?: unknown[];
    };
    expect(Array.isArray(legacyV1.blogs)).toBe(true);
    expect(Array.isArray(legacyV1.github_repos)).toBe(true);
    expect(Array.isArray(legacyV1.documentation)).toBe(true);
  });

  test("malformed v2 fixture is intentionally invalid JSON", () => {
    const malformedRaw = readFixture("sources-v2.malformed.json");
    expect(() => JSON.parse(malformedRaw)).toThrow();
  });

  test("monitor response fixtures parse and satisfy report/runtime anchors", () => {
    const anthropic = JSON.parse(readFixture("monitor-response-anthropic.json")) as {
      generatedAt: string;
      options: { provider: string; dryRun: boolean };
      report: { discoveries: unknown[]; recommendations: Array<{ implementation_target_ids: string[] }>; implementation_targets: Array<{ id: string }> };
      learning_context: { total_ratings: number; top_failure_patterns: string[] };
      summary: { ranking: { enabled: boolean; persisted: boolean; historyPath: string } };
    };
    const ecosystem = JSON.parse(readFixture("monitor-response-ecosystem.json")) as typeof anthropic;

    for (const fixture of [anthropic, ecosystem]) {
      expect(typeof fixture.generatedAt).toBe("string");
      expect(Array.isArray(fixture.report.discoveries)).toBe(true);
      expect(Array.isArray(fixture.report.recommendations)).toBe(true);
      expect(Array.isArray(fixture.report.implementation_targets)).toBe(true);
      expect(typeof fixture.summary.ranking.historyPath).toBe("string");
      expect(Array.isArray(fixture.learning_context.top_failure_patterns)).toBe(true);

      const targetIds = new Set(fixture.report.implementation_targets.map((target) => target.id));
      for (const recommendation of fixture.report.recommendations) {
        for (const targetId of recommendation.implementation_target_ids) {
          expect(targetIds.has(targetId)).toBe(true);
        }
      }
    }

    expect(anthropic.options.provider).toBe("anthropic");
    expect(ecosystem.options.provider).toBe("ecosystem");
  });

  test("fixture set is sufficient for v1 fallback, dry-run, and integrity contracts", () => {
    const validV2 = JSON.parse(readFixture("sources-v2.valid.json")) as { sources: Array<{ category: string }> };
    const legacyV1 = JSON.parse(readFixture("sources-v1.legacy.json")) as {
      blogs?: unknown[];
      github_repos?: unknown[];
      documentation?: unknown[];
    };

    expect(validV2.sources.some((source) => source.category === "github")).toBe(true);
    expect(validV2.sources.some((source) => source.category === "docs")).toBe(true);
    expect((legacyV1.blogs || []).length).toBeGreaterThan(0);
    expect((legacyV1.github_repos || []).length).toBeGreaterThan(0);
    expect((legacyV1.documentation || []).length).toBeGreaterThan(0);

    const reflections = readFixture("internal-reflections.jsonl")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { rating?: number; criteria_count?: number; criteria_failed?: number; implied_sentiment?: number });

    expect(reflections.length).toBeGreaterThan(1);
    expect(reflections.some((entry) => (entry.implied_sentiment || 0) <= 4)).toBe(true);
    expect(reflections.some((entry) => (entry.implied_sentiment || 0) >= 8)).toBe(true);
    for (const entry of reflections) {
      expect(typeof entry.criteria_count).toBe("number");
      expect(typeof entry.criteria_failed).toBe("number");
    }
  });

  test("youtube feed fixture is realistic atom with multiple entries", () => {
    const feed = readFixture("youtube-feed.sample.xml");

    expect(feed).toContain("<feed");
    expect(feed).toContain("xmlns=\"http://www.w3.org/2005/Atom\"");
    expect(feed).toContain("xmlns:yt=\"http://www.youtube.com/xml/schemas/2015\"");
    expect(feed).not.toContain("<rss");

    const entries = feed.match(/<entry>[\s\S]*?<\/entry>/g) || [];
    expect(entries.length).toBeGreaterThanOrEqual(2);

    for (const entry of entries) {
      expect(entry).toMatch(/<yt:videoId>[A-Za-z0-9_-]{6,}<\/yt:videoId>/);
      expect(entry).toMatch(/<title>[^<]+<\/title>/);
      expect(entry).toMatch(/<published>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z<\/published>/);
      expect(entry).toMatch(/https:\/\/www\.youtube\.com\/watch\?v=[A-Za-z0-9_-]{6,}/);
    }

    expect(feed).toMatch(/\n\s*<entry>/);
    expect(feed).toMatch(/\n\s*<link rel="alternate" href="https:\/\/www\.youtube\.com\/watch\?v=/);
  });

  test("youtube transcript fixture contains realistic and actionable guidance", () => {
    const transcript = readFixture("youtube-transcript.sample.txt");

    expect(transcript.length).toBeGreaterThan(160);
    expect(transcript).toMatch(/\b(actionable technique|technique:)\b/i);
    expect(transcript).toMatch(/\b(run|measure|track|write|review)\b/i);
    expect(transcript).toContain("postmortem");
  });
});
