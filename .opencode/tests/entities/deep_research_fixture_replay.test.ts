import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import * as deepResearch from "../../tools/deep_research.ts";
import { asRecord, fixturePath, makeToolContext, parseToolJson, withEnv } from "../helpers/dr-harness";

const fixture_bundle_capture = ((deepResearch as any).fixture_bundle_capture ??
  (deepResearch as any).deep_research_fixture_bundle_capture) as any | undefined;
const fixture_replay = ((deepResearch as any).fixture_replay ??
  (deepResearch as any).deep_research_fixture_replay) as any | undefined;

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

async function materializeFixtureBundle(bundleId: string, base: string): Promise<string> {
  const src = fixturePath("bundles", bundleId);
  const dst = path.join(base, bundleId);
  await fs.cp(src, dst, { recursive: true });
  return dst;
}

async function runReplay(bundleRoot: string, reason: string): Promise<Record<string, unknown>> {
  const replayTool = requireTool("deep_research_fixture_replay", fixture_replay);
  const raw = (await replayTool.execute(
    {
      bundle_root: bundleRoot,
      reason,
    },
    makeToolContext(),
  )) as string;
  return parseToolJson(raw) as Record<string, unknown>;
}

describe("deep_research_fixture_replay (entity)", () => {
  test("exports fixture capture + replay tools", () => {
    expect(typeof requireTool("deep_research_fixture_bundle_capture", fixture_bundle_capture).execute).toBe("function");
    expect(typeof requireTool("deep_research_fixture_replay", fixture_replay).execute).toBe("function");
  });

  test("replays pass fixture deterministically and preserves Gate E warning contract", async () => {
    await withEnv({ PAI_DR_OPTION_C_ENABLED: "1", PAI_DR_NO_WEB: "1" }, async () => {
      const manifest = JSON.parse(
        await fs.readFile(fixturePath("bundles", PASS_BUNDLE_ID, "manifest.json"), "utf8"),
      ) as Record<string, unknown>;
      const artifacts = asRecord(manifest.artifacts, "manifest.artifacts");
      const root = String(artifacts.root ?? "");
      expect(root).toContain(`/tests/fixtures/bundles/${PASS_BUNDLE_ID}`);
      expect(root.includes("/tmp/")).toBe(false);

      await withDeterministicTempDir("fixture-replay-pass", async (base) => {
        const bundleRoot = await materializeFixtureBundle(PASS_BUNDLE_ID, base);

        const first = await runReplay(bundleRoot, "test: replay deterministic first");
        const second = await runReplay(bundleRoot, "test: replay deterministic second");

        expect(second).toEqual(first);
        expect(first.ok).toBe(true);
        expect(String(first.schema_version)).toBe("fixture_replay.report.v1");
        expect(String(first.status)).toBe("pass");

        const checks = asRecord(first.checks, "checks");
        const gateStatus = asRecord(checks.gate_e_status, "checks.gate_e_status");
        const codes = warningCodes(gateStatus.evaluated_warnings);
        expect(String(gateStatus.evaluated_status)).toBe("pass");
        expect(codes).toContain("HIGH_DUPLICATE_CITATION_RATE");
        expect(codes).not.toContain("LOW_CITATION_UTILIZATION");

        const summary = asRecord(first.summary, "summary");
        expect(Number(summary.files_mismatched_total)).toBe(0);
        expect(Number(summary.gate_e_status_checks_passed)).toBe(4);
        expect(Boolean(summary.overall_pass)).toBe(true);

        const replayReportPath = String(first.replay_report_path ?? "");
        const firstReport = await fs.readFile(replayReportPath, "utf8");
        await runReplay(bundleRoot, "test: replay report bytes");
        const secondReport = await fs.readFile(replayReportPath, "utf8");
        expect(secondReport).toBe(firstReport);
      });
    });
  });

  test("replays uncited-numeric fixture with fail Gate E status and empty warnings", async () => {
    await withEnv({ PAI_DR_OPTION_C_ENABLED: "1", PAI_DR_NO_WEB: "1" }, async () => {
      await withDeterministicTempDir("fixture-replay-fail", async (base) => {
        const bundleRoot = await materializeFixtureBundle(FAIL_BUNDLE_ID, base);
        const out = await runReplay(bundleRoot, "test: replay fail gate e");

        expect(out.ok).toBe(true);
        expect(String(out.schema_version)).toBe("fixture_replay.report.v1");
        expect(String(out.status)).toBe("pass");

        const checks = asRecord(out.checks, "checks");
        const gateStatus = asRecord(checks.gate_e_status, "checks.gate_e_status");
        expect(String(gateStatus.evaluated_status)).toBe("fail");
        expect(warningCodes(gateStatus.evaluated_warnings)).toEqual([]);

        const statusChecks = asRecord(gateStatus.checks, "checks.gate_e_status.checks");
        expect(Boolean(statusChecks.status_matches_bundled_report)).toBe(true);
        expect(Boolean(statusChecks.warnings_match_bundled_report)).toBe(true);
        expect(Boolean(statusChecks.status_matches_gates_snapshot)).toBe(true);
        expect(Boolean(statusChecks.warnings_match_gates_snapshot)).toBe(true);
      });
    });
  });
});
