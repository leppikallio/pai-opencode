import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import * as deepResearch from "../../tools/deep_research_cli.ts";
import { asRecord, fixturePath, makeToolContext, parseToolJson, withEnv } from "../helpers/dr-harness";

const regression_run = ((deepResearch as any).regression_run ??
  (deepResearch as any).deep_research_regression_run) as any | undefined;

const PASS_BUNDLE_ID = "p06_gate_e_pass_warn_dup";
const FAIL_BUNDLE_ID = "p06_gate_e_fail_uncited_numeric";

function requireTool(name: string, value: any): { execute: (args: Record<string, unknown>, ctx?: unknown) => Promise<string> } {
  if (!value || typeof value.execute !== "function") {
    throw new Error(`${name} export missing`);
  }
  return value;
}

function warningCodes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => String(entry ?? "")).sort((a, b) => a.localeCompare(b));
}

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

async function materializeBundles(fixturesRoot: string, bundleIds: string[]): Promise<void> {
  await fs.mkdir(fixturesRoot, { recursive: true });
  for (const bundleId of bundleIds) {
    await fs.cp(fixturePath("bundles", bundleId), path.join(fixturesRoot, bundleId), { recursive: true });
  }
}

describe("deep_research_phase06_regression (regression)", () => {
  test("replays baseline bundles and asserts Gate E outcomes + warning codes", async () => {
    await withEnv({ PAI_DR_OPTION_C_ENABLED: "1", PAI_DR_NO_WEB: "1" }, async () => {
      await withDeterministicTempDir("phase06-regression", async (base) => {
        const fixturesRoot = path.join(base, "bundles");
        const bundleIds = [PASS_BUNDLE_ID, FAIL_BUNDLE_ID];
        await materializeBundles(fixturesRoot, bundleIds);

        const runTool = requireTool("deep_research_regression_run", regression_run);
        const raw = (await runTool.execute(
          {
            fixtures_root: fixturesRoot,
            bundle_ids: bundleIds,
            reason: "test: phase06 regression",
          },
          makeToolContext(),
        )) as string;
        const out = parseToolJson(raw) as Record<string, unknown>;

        expect(out.ok).toBe(true);
        expect(String(out.schema_version)).toBe("fixture_regression.report.v1");
        expect(String(out.status)).toBe("pass");

        const summary = asRecord(out.summary, "summary");
        expect(Number(summary.total)).toBe(2);
        expect(Number(summary.error)).toBe(0);
        expect(Number(summary.pass)).toBe(2);
        expect(Number(summary.fail)).toBe(0);

        const outcomes = Array.isArray(out.outcomes)
          ? (out.outcomes as Array<Record<string, unknown>>)
          : [];
        expect(outcomes.length).toBe(2);

        const gateStatusCounts = { pass: 0, fail: 0 };
        const warningsByBundle = new Map<string, string[]>();

        for (const outcome of outcomes) {
          expect(Boolean(outcome.ok)).toBe(true);
          const bundleId = String(outcome.bundle_id ?? "");
          const replayReportPath = String(outcome.replay_report_path ?? "");
          const replayReport = JSON.parse(await fs.readFile(replayReportPath, "utf8")) as Record<string, unknown>;

          const checks = asRecord(replayReport.checks, "replay.checks");
          const gateStatus = asRecord(checks.gate_e_status, "replay.checks.gate_e_status");
          const evaluatedStatus = String(gateStatus.evaluated_status ?? "");

          if (evaluatedStatus === "pass") gateStatusCounts.pass += 1;
          if (evaluatedStatus === "fail") gateStatusCounts.fail += 1;
          warningsByBundle.set(bundleId, warningCodes(gateStatus.evaluated_warnings));

          if (bundleId === FAIL_BUNDLE_ID) {
            const bundleRoot = String(outcome.bundle_root ?? "");
            const numericClaims = JSON.parse(
              await fs.readFile(path.join(bundleRoot, "reports", "gate-e-numeric-claims.json"), "utf8"),
            ) as Record<string, unknown>;
            const metrics = asRecord(numericClaims.metrics, "numeric_claims.metrics");
            expect(Number(metrics.uncited_numeric_claims)).toBeGreaterThan(0);
          }
        }

        expect(gateStatusCounts).toEqual({ pass: 1, fail: 1 });

        const passWarnings = warningsByBundle.get(PASS_BUNDLE_ID) ?? [];
        expect(passWarnings).toContain("HIGH_DUPLICATE_CITATION_RATE");
        expect(passWarnings).not.toContain("LOW_CITATION_UTILIZATION");

        const failWarnings = warningsByBundle.get(FAIL_BUNDLE_ID) ?? [];
        expect(failWarnings).toEqual([]);
      });
    });
  });
});
