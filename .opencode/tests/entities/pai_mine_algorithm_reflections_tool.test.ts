import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { mineAlgorithmReflections } from "../../skills/utilities/pai-upgrade/Tools/MineAlgorithmReflections";

const ZERO_NOTE = "No reflections found yet — reflections accumulate after Standard+ Algorithm runs";

function withEnv(overrides: Record<string, string | undefined>, run: () => void): void {
  const previous: Record<string, string | undefined> = {};

  for (const key of Object.keys(overrides)) {
    previous[key] = process.env[key];
  }

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

function withTempDir(prefix: string, run: (root: string) => void): void {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  try {
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("mineAlgorithmReflections", () => {
  test("returns deterministic zero-entry analysis when source file is missing", () => {
    withTempDir("pai-mine-algo-reflections-missing-", (root) => {
      const filePath = path.join(root, "missing.jsonl");

      const result = mineAlgorithmReflections({ filePath });

      expect(result.schema).toBe("pai-upgrade.algorithm-reflections.v1");
      expect(result.source_file).toBe(path.resolve(filePath));
      expect(result.entries_analyzed).toBe(0);
      expect(result.invalid_lines).toBe(0);
      expect(result.themes).toEqual([]);
      expect(result.execution_warnings).toEqual([]);
      expect(result.aspirational_insights).toEqual([]);
      expect(result.date_range).toBeNull();
      expect(result.note).toBe(ZERO_NOTE);
    });
  });

  test("returns deterministic zero-entry analysis when source file is empty", () => {
    withTempDir("pai-mine-algo-reflections-empty-", (root) => {
      const filePath = path.join(root, "algorithm-reflections.jsonl");
      writeFileSync(filePath, "", "utf8");

      const result = mineAlgorithmReflections({ filePath });

      expect(result.entries_analyzed).toBe(0);
      expect(result.invalid_lines).toBe(0);
      expect(result.themes).toEqual([]);
      expect(result.execution_warnings).toEqual([]);
      expect(result.aspirational_insights).toEqual([]);
      expect(result.date_range).toBeNull();
      expect(result.note).toBe(ZERO_NOTE);
    });
  });

  test("handles malformed lines, default runtime path, deterministic buckets, and ordering", () => {
    withTempDir("pai-mine-algo-reflections-runtime-", (runtimeRoot) => {
      const reflectionsDir = path.join(runtimeRoot, "MEMORY", "LEARNING", "REFLECTIONS");
      const reflectionsFile = path.join(reflectionsDir, "algorithm-reflections.jsonl");
      mkdirSync(reflectionsDir, { recursive: true });

      const lines = [
        JSON.stringify({
          timestamp: "2026-01-01T00:00:00.000Z",
          implied_sentiment: 5,
          criteria_failed: 1,
          within_budget: false,
          rework_count: 1,
          reflection_q1: "Need to read code before modifying files",
          reflection_q2: "ISC decomposition was weak and criteria were compound",
          reflection_q3: "Need better planning and prerequisites",
        }),
        JSON.stringify({
          timestamp: "2026-01-02T00:00:00.000Z",
          implied_sentiment: 6,
          criteria_failed: 1,
          within_budget: false,
          rework_count: 1,
          reflection_q1: "Should verify earlier before completion claims",
          reflection_q2: "Verification should happen earlier with stronger tests",
          reflection_q3: "Improve verification guardrails",
        }),
        JSON.stringify({
          timestamp: "2026-01-03T00:00:00.000Z",
          implied_sentiment: 7,
          criteria_failed: 1,
          within_budget: false,
          rework_count: 0,
          reflection_q1: "Need to ask clarifying questions earlier",
          reflection_q2: "Planning depth and prerequisites were missing",
          reflection_q3: "Need better tooling and automation",
        }),
        JSON.stringify({
          timestamp: "2026-01-04T00:00:00.000Z",
          implied_sentiment: 5,
          criteria_failed: 0,
          within_budget: true,
          rework_count: 0,
          reflection_q1: "Use capabilities earlier in build phase",
          reflection_q2: "Capability selection came too late",
          reflection_q3: "Parallelization would help for independent tasks",
        }),
        JSON.stringify({
          timestamp: "2026-01-05T00:00:00.000Z",
          implied_sentiment: 4,
          criteria_failed: 0,
          within_budget: true,
          rework_count: 0,
          reflection_q1: "Simplify approach and avoid over-engineering",
          reflection_q2: "Timing budget was blown and phase time discipline failed",
          reflection_q3: "Need better memory capture and retrieval",
        }),
        JSON.stringify({
          timestamp: "2026-01-06T00:00:00.000Z",
          implied_sentiment: 6,
          criteria_failed: 0,
          within_budget: true,
          rework_count: 0,
          reflection_q1: "No specific execution warning",
          reflection_q2: "Documentation context was incomplete in docs and readme",
          reflection_q3: "Need better tooling for documentation upkeep",
        }),
        JSON.stringify({
          timestamp: "2026-01-07T00:00:00.000Z",
          implied_sentiment: 7,
          criteria_failed: 0,
          within_budget: true,
          rework_count: 0,
          reflection_q1: "verify earlier with browser checks",
          reflection_q2: "Tooling automation was insufficient",
          reflection_q3: "Need better planning for complex work",
        }),
        JSON.stringify({
          timestamp: "2026-01-08T00:00:00.000Z",
          implied_sentiment: 8,
          criteria_failed: 0,
          within_budget: true,
          rework_count: 0,
          reflection_q1: "",
          reflection_q2: "No obvious bucket keyword here",
          reflection_q3: "Misc improvement idea",
        }),
        "{malformed-json-line",
        JSON.stringify({
          timestamp: "2026-01-09T00:00:00.000Z",
          implied_sentiment: 5,
          criteria_failed: 1,
          within_budget: false,
          rework_count: 1,
          reflection_q1: "Need to verify earlier again",
          reflection_q2: "Planning and verification were both weak",
          reflection_q3: "Better verification checks and gates",
        }),
      ];
      writeFileSync(reflectionsFile, `${lines.join("\n")}\n`, "utf8");

      withEnv({ PAI_DIR: runtimeRoot }, () => {
        const result = mineAlgorithmReflections();

        expect(result.source_file).toBe(path.resolve(reflectionsFile));
        expect(result.entries_analyzed).toBe(9);
        expect(result.invalid_lines).toBe(1);
        expect(result.date_range).toEqual({
          earliest: "2026-01-01T00:00:00.000Z",
          latest: "2026-01-09T00:00:00.000Z",
        });
        expect(result.note).toBeUndefined();

        expect(result.themes.map((theme) => theme.theme)).toEqual([
          "verification",
          "isc_quality",
          "planning",
          "capability_selection",
          "timing_budget",
          "documentation",
          "tooling",
          "other",
        ]);

        const byTheme = new Map(result.themes.map((theme) => [theme.theme, theme]));
        expect(byTheme.get("verification")).toMatchObject({
          frequency: 2,
          signal_score: 9,
          signal: "HIGH",
          root_cause_hypothesis:
            "Verification guardrails are not strong enough to catch recurring failures before completion claims.",
          supporting_quotes: [
            "Planning and verification were both weak",
            "Verification should happen earlier with stronger tests",
          ],
        });

        expect(byTheme.get("isc_quality")).toMatchObject({
          frequency: 1,
          signal_score: 5,
          signal: "HIGH",
          root_cause_hypothesis:
            "Ideal State Criteria quality or decomposition is too weak to prevent recurring execution errors.",
        });

        expect(byTheme.get("planning")).toMatchObject({
          frequency: 1,
          signal_score: 3,
          signal: "MEDIUM",
          root_cause_hypothesis:
            "Planning depth or prerequisite analysis is insufficient for the task complexity encountered.",
        });

        expect(byTheme.get("capability_selection")?.root_cause_hypothesis).toBe(
          "Capability selection is under-specified or delayed, causing missed leverage during execution.",
        );
        expect(byTheme.get("timing_budget")?.root_cause_hypothesis).toBe(
          "Effort budgeting or phase time discipline is insufficiently enforced.",
        );
        expect(byTheme.get("documentation")?.root_cause_hypothesis).toBe(
          "Documentation or plan context is incomplete, causing repeated interpretation gaps.",
        );
        expect(byTheme.get("tooling")?.root_cause_hypothesis).toBe(
          "Existing tooling or automation is insufficient for the recurring problem pattern.",
        );
        expect(byTheme.get("other")?.root_cause_hypothesis).toBe(
          "Recurring reflection pattern exists but does not map cleanly to a predefined structural bucket.",
        );

        expect(result.execution_warnings).toEqual([
          "verify_earlier — seen 3 times",
          "ask_better_questions — seen 1 times",
          "other — seen 1 times",
          "read_before_modify — seen 1 times",
          "simplify_approach — seen 1 times",
          "use_capabilities_earlier — seen 1 times",
        ]);

        expect(result.aspirational_insights).toEqual([
          "better_planning — seen 2 times",
          "better_tooling — seen 2 times",
          "better_verification — seen 2 times",
          "better_memory — seen 1 times",
          "better_parallelization — seen 1 times",
          "other — seen 1 times",
        ]);

        const limited = mineAlgorithmReflections({ maxThemes: 3 });
        expect(limited.themes.map((theme) => theme.theme)).toEqual(["verification", "isc_quality", "planning"]);
      });
    });
  });
});
