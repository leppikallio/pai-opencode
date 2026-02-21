import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { run_init } from "../../tools/deep_research_cli.ts";
import * as deepResearch from "../../tools/deep_research_cli.ts";
import { fixturePath, makeToolContext, parseToolJson, withEnv } from "../helpers/dr-harness";

const gate_e_reports = ((deepResearch as any).gate_e_reports ??
  (deepResearch as any).deep_research_gate_e_reports) as any | undefined;

async function withDeterministicTempDir<T>(name: string, fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = path.join(os.tmpdir(), "dr-phase06-tests", name);
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function seedRunArtifacts(args: {
  base: string;
  runId: string;
  synthesisFixtureRelPath: string;
}): Promise<{ manifestPath: string; runRoot: string }> {
  const initRaw = (await (run_init as any).execute(
    {
      query: "P06 Gate E reports fixture",
      mode: "standard",
      sensitivity: "no_web",
      run_id: args.runId,
      root_override: args.base,
    },
    makeToolContext(),
  )) as string;
  const init = parseToolJson(initRaw);
  expect(init.ok).toBe(true);

  const manifestPath = String((init as any).manifest_path);
  const runRoot = path.dirname(manifestPath);

  const citationsFixture = fixturePath("summaries", "phase05", "citations.jsonl");
  const synthesisFixture = fixturePath("summaries", "phase05", "synthesis", args.synthesisFixtureRelPath);

  await fs.copyFile(citationsFixture, path.join(runRoot, "citations", "citations.jsonl"));
  await fs.copyFile(synthesisFixture, path.join(runRoot, "synthesis", "final-synthesis.md"));

  return { manifestPath, runRoot };
}

async function runGateEReports(manifestPath: string): Promise<Record<string, unknown>> {
  const raw = (await (gate_e_reports as any).execute(
    {
      manifest_path: manifestPath,
      reason: "test: gate e reports",
    },
    makeToolContext(),
  )) as string;
  return parseToolJson(raw) as Record<string, unknown>;
}

describe("deep_research_gate_e_reports (entity)", () => {
  const maybeTest = gate_e_reports ? test : test.skip;

  maybeTest("writes deterministic Gate E report artifacts for pass fixture", async () => {
    await withEnv({ PAI_DR_CLI_ENABLED: "1", PAI_DR_CLI_NO_WEB: "1" }, async () => {
      await withDeterministicTempDir("gate-e-reports-pass", async (base) => {
        const { manifestPath, runRoot } = await seedRunArtifacts({
          base,
          runId: "dr_test_p06_gate_e_reports_001",
          synthesisFixtureRelPath: "final-synthesis-pass.md",
        });

        const out = await runGateEReports(manifestPath);
        expect(out.ok).toBe(true);

        const reportsDir = path.join(runRoot, "reports");
        const statusPath = path.join(reportsDir, "gate-e-status.json");
        const numericPath = path.join(reportsDir, "gate-e-numeric-claims.json");
        const sectionsPath = path.join(reportsDir, "gate-e-sections-present.json");
        const utilizationPath = path.join(reportsDir, "gate-e-citation-utilization.json");

        for (const reportPath of [statusPath, numericPath, sectionsPath, utilizationPath]) {
          const st = await fs.stat(reportPath);
          expect(st.isFile()).toBe(true);
        }

        const statusDoc = JSON.parse(await fs.readFile(statusPath, "utf8")) as Record<string, unknown>;
        const hardMetrics = (statusDoc.hard_metrics ?? {}) as Record<string, unknown>;
        const warnings = Array.isArray(statusDoc.warnings) ? statusDoc.warnings.map(String) : [];

        expect(String(statusDoc.status)).toBe("pass");
        expect(Number(hardMetrics.uncited_numeric_claims)).toBe(0);
        expect(Number(hardMetrics.report_sections_present)).toBe(100);
        expect(warnings).toContain("HIGH_DUPLICATE_CITATION_RATE");
        expect(warnings).not.toContain("LOW_CITATION_UTILIZATION");
      });
    });
  });

  maybeTest("reports fail when synthesis fixture has uncited numeric claim", async () => {
    await withEnv({ PAI_DR_CLI_ENABLED: "1", PAI_DR_CLI_NO_WEB: "1" }, async () => {
      await withDeterministicTempDir("gate-e-reports-fail", async (base) => {
        const { manifestPath, runRoot } = await seedRunArtifacts({
          base,
          runId: "dr_test_p06_gate_e_reports_002",
          synthesisFixtureRelPath: "final-synthesis-fail-uncited.md",
        });

        const out = await runGateEReports(manifestPath);
        expect(out.ok).toBe(true);

        const statusPath = path.join(runRoot, "reports", "gate-e-status.json");
        const numericPath = path.join(runRoot, "reports", "gate-e-numeric-claims.json");

        const statusDoc = JSON.parse(await fs.readFile(statusPath, "utf8")) as Record<string, unknown>;
        const numericDoc = JSON.parse(await fs.readFile(numericPath, "utf8")) as Record<string, unknown>;
        const numericMetrics = (numericDoc.metrics ?? {}) as Record<string, unknown>;

        expect(String(statusDoc.status)).toBe("fail");
        expect(Number(numericMetrics.uncited_numeric_claims)).toBeGreaterThan(0);
      });
    });
  });
});
