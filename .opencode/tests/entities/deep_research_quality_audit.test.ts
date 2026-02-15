import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import * as deepResearch from "../../tools/deep_research.ts";
import { asRecord, fixturePath, makeToolContext, parseToolJson, withEnv } from "../helpers/dr-harness";

const quality_audit = ((deepResearch as any).quality_audit ??
  (deepResearch as any).deep_research_quality_audit) as any | undefined;

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

function bundleById(value: unknown): Map<string, Record<string, unknown>> {
  const out = new Map<string, Record<string, unknown>>();
  if (!Array.isArray(value)) return out;
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const row = entry as Record<string, unknown>;
    const bundleId = String(row.bundle_id ?? "").trim();
    if (!bundleId) continue;
    out.set(bundleId, row);
  }
  return out;
}

describe("deep_research_quality_audit (entity)", () => {
  const maybeTest = quality_audit ? test : test.skip;

  maybeTest("writes default report, validates Gate E statuses, and is byte-deterministic", async () => {
    await withEnv({ PAI_DR_OPTION_C_ENABLED: "1", PAI_DR_NO_WEB: "1" }, async () => {
      const auditTool = requireTool("deep_research_quality_audit", quality_audit);
      const fixturesRoot = fixturePath("bundles");
      const expectedOutputPath = path.join(fixturesRoot, "reports", "quality-audit.json");
      const expectedOutputDir = path.dirname(expectedOutputPath);

      await fs.rm(expectedOutputPath, { force: true });

      try {
        const firstRaw = (await auditTool.execute(
          {
            fixtures_root: fixturesRoot,
            reason: "test: quality audit first",
          },
          makeToolContext(),
        )) as string;
        const first = parseToolJson(firstRaw);
        expect(first.ok).toBe(true);
        expect(String(first.output_path)).toBe(expectedOutputPath);

        const stat = await fs.stat(expectedOutputPath);
        expect(stat.isFile()).toBe(true);

        const bundles = bundleById(first.bundles);
        const passBundle = asRecord(bundles.get(PASS_BUNDLE_ID), PASS_BUNDLE_ID);
        const failBundle = asRecord(bundles.get(FAIL_BUNDLE_ID), FAIL_BUNDLE_ID);

        expect(String(passBundle.status)).toBe("pass");
        expect(warningCodes(passBundle.warnings)).toContain("HIGH_DUPLICATE_CITATION_RATE");

        expect(String(failBundle.status)).toBe("fail");
        expect(warningCodes(failBundle.warnings)).toEqual([]);

        const firstBytes = await fs.readFile(expectedOutputPath);

        const secondRaw = (await auditTool.execute(
          {
            fixtures_root: fixturesRoot,
            reason: "test: quality audit second",
          },
          makeToolContext(),
        )) as string;
        const second = parseToolJson(secondRaw);
        expect(second.ok).toBe(true);

        const secondBytes = await fs.readFile(expectedOutputPath);
        expect(secondBytes.equals(firstBytes)).toBe(true);
      } finally {
        await fs.rm(expectedOutputPath, { force: true });
        await fs.rm(expectedOutputDir, { recursive: false, force: false }).catch(() => {});
      }
    });
  });

  test("fixture manifests avoid host-specific absolute roots", async () => {
    const manifestPaths = [
      fixturePath("bundles", PASS_BUNDLE_ID, "manifest.json"),
      fixturePath("bundles", FAIL_BUNDLE_ID, "manifest.json"),
    ];

    for (const manifestPath of manifestPaths) {
      const doc = JSON.parse(await fs.readFile(manifestPath, "utf8")) as Record<string, unknown>;
      const artifacts = asRecord(doc.artifacts, `${manifestPath}:artifacts`);
      const root = String(artifacts.root ?? "");

      expect(root.startsWith("/tests/fixtures/bundles/")).toBe(true);
      expect(root.includes("/Users/")).toBe(false);
      expect(root.includes("\\Users\\")).toBe(false);
      expect(root.includes("/home/")).toBe(false);
    }
  });
});
