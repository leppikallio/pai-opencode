import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { gate_e_evaluate, run_init } from "../../tools/deep_research.ts";
import * as deepResearch from "../../tools/deep_research.ts";
import { asRecord, fixturePath, makeToolContext, parseToolJson, withEnv } from "../helpers/dr-harness";

const gate_e_reports = ((deepResearch as any).gate_e_reports
  ?? (deepResearch as any).deep_research_gate_e_reports) as any | undefined;

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
  const initRaw = (await run_init.execute(
    {
      query: "Gate E metric consistency fixture",
      mode: "standard",
      sensitivity: "no_web",
      run_id: args.runId,
      root_override: args.base,
    },
    makeToolContext(),
  )) as string;
  const init = parseToolJson(initRaw);
  expect(init.ok).toBe(true);

  const manifestPath = String(init.manifest_path);
  const runRoot = path.dirname(manifestPath);

  await fs.copyFile(
    fixturePath("summaries", "phase05", "citations.jsonl"),
    path.join(runRoot, "citations", "citations.jsonl"),
  );
  await fs.copyFile(
    fixturePath("summaries", "phase05", "synthesis", args.synthesisFixtureRelPath),
    path.join(runRoot, "synthesis", "final-synthesis.md"),
  );

  return { manifestPath, runRoot };
}

async function runGateEEvaluate(manifestPath: string): Promise<Record<string, unknown>> {
  const raw = (await gate_e_evaluate.execute(
    { manifest_path: manifestPath, reason: "test: gate e consistency evaluate" },
    makeToolContext(),
  )) as string;
  return parseToolJson(raw) as Record<string, unknown>;
}

async function runGateEReports(manifestPath: string): Promise<Record<string, unknown>> {
  const raw = (await (gate_e_reports as any).execute(
    { manifest_path: manifestPath, reason: "test: gate e consistency reports" },
    makeToolContext(),
  )) as string;
  return parseToolJson(raw) as Record<string, unknown>;
}

describe("Gate E metric consistency between evaluate and reports", () => {
  const maybeTest = gate_e_reports ? test : test.skip;

  maybeTest("uses percent units for report_sections_present and aligned values", async () => {
    await withEnv({ PAI_DR_OPTION_C_ENABLED: "1", PAI_DR_NO_WEB: "1" }, async () => {
      await withDeterministicTempDir("gate-e-metrics-consistency-pass", async (base) => {
        const { manifestPath } = await seedRunArtifacts({
          base,
          runId: "dr_test_p06_gate_e_consistency_001",
          synthesisFixtureRelPath: "final-synthesis-pass.md",
        });

        const evaluateOut = await runGateEEvaluate(manifestPath);
        const reportsOut = await runGateEReports(manifestPath);
        expect(evaluateOut.ok).toBe(true);
        expect(reportsOut.ok).toBe(true);

        const evaluateMetrics = asRecord(evaluateOut.metrics, "evaluate_metrics");
        const reportsMetrics = asRecord(reportsOut.metrics_summary, "reports_metrics_summary");

        // Chosen unit: percent (0..100)
        expect(Number(evaluateMetrics.report_sections_present)).toBe(100);
        expect(Number(reportsMetrics.report_sections_present)).toBe(100);

        expect(Number(evaluateMetrics.uncited_numeric_claims)).toBe(Number(reportsMetrics.uncited_numeric_claims));
        expect(Number(evaluateMetrics.report_sections_present)).toBe(Number(reportsMetrics.report_sections_present));
        expect(Number(evaluateMetrics.citation_utilization_rate)).toBe(Number(reportsMetrics.citation_utilization_rate));
        expect(Number(evaluateMetrics.duplicate_citation_rate)).toBe(Number(reportsMetrics.duplicate_citation_rate));
      });
    });
  });

  maybeTest("keeps duplicate citation rate aligned at zero when mentions are absent", async () => {
    await withEnv({ PAI_DR_OPTION_C_ENABLED: "1", PAI_DR_NO_WEB: "1" }, async () => {
      await withDeterministicTempDir("gate-e-metrics-consistency-no-mentions", async (base) => {
        const { manifestPath } = await seedRunArtifacts({
          base,
          runId: "dr_test_p06_gate_e_consistency_002",
          synthesisFixtureRelPath: "final-synthesis-pass-no-citation-mentions.md",
        });

        const evaluateOut = await runGateEEvaluate(manifestPath);
        const reportsOut = await runGateEReports(manifestPath);
        expect(evaluateOut.ok).toBe(true);
        expect(reportsOut.ok).toBe(true);

        const evaluateMetrics = asRecord(evaluateOut.metrics, "evaluate_metrics");
        const reportsMetrics = asRecord(reportsOut.metrics_summary, "reports_metrics_summary");

        expect(Number(evaluateMetrics.duplicate_citation_rate)).toBe(0);
        expect(Number(reportsMetrics.duplicate_citation_rate)).toBe(0);
        expect(Number(evaluateMetrics.duplicate_citation_rate)).toBe(Number(reportsMetrics.duplicate_citation_rate));
      });
    });
  });
});
