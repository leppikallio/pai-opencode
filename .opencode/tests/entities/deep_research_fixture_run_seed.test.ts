import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import * as deepResearch from "../../tools/deep_research.ts";
import { validateGatesV1, validateManifestV1 } from "../../tools/deep_research/schema_v1";
import { fixturePath, makeToolContext, parseToolJson, withTempDir } from "../helpers/dr-harness";

const fixture_run_seed = ((deepResearch as any).fixture_run_seed ??
  (deepResearch as any).deep_research_fixture_run_seed) as any | undefined;

function requireTool(name: string, value: any): { execute: (args: Record<string, unknown>, ctx?: unknown) => Promise<string> } {
  if (!value || typeof value.execute !== "function") {
    throw new Error(`${name} export missing`);
  }
  return value;
}

async function seed(args: {
  fixtureDir: string;
  runId: string;
  rootOverride: string;
  reason: string;
}): Promise<Record<string, unknown>> {
  const tool = requireTool("deep_research_fixture_run_seed", fixture_run_seed);
  const raw = (await tool.execute(
    {
      fixture_dir: args.fixtureDir,
      run_id: args.runId,
      reason: args.reason,
      root_override: args.rootOverride,
    },
    makeToolContext(),
  )) as string;
  return parseToolJson(raw) as Record<string, unknown>;
}

describe("deep_research_fixture_run_seed (entity)", () => {
  test("seeds run snapshot fixture and validates manifest + gates", async () => {
    await withTempDir(async (base) => {
      const fixtureDir = fixturePath("runs", "m1-finalize-happy");
      const runId = "dr_fixture_seed_001";

      const out = await seed({
        fixtureDir,
        runId,
        rootOverride: base,
        reason: "test: fixture seed",
      });

      expect(out.ok).toBe(true);
      const root = String(out.root ?? "");
      const manifestPath = String(out.manifest_path ?? "");
      const gatesPath = String(out.gates_path ?? "");

      expect(root).toBe(path.join(base, runId));
      expect(manifestPath).toBe(path.join(root, "manifest.json"));
      expect(gatesPath).toBe(path.join(root, "gates.json"));

      const wave1PlanStat = await fs.stat(path.join(root, "wave-1", "wave1-plan.json"));
      expect(wave1PlanStat.isFile()).toBe(true);

      const manifestRaw = JSON.parse(await fs.readFile(manifestPath, "utf8"));
      const gatesRaw = JSON.parse(await fs.readFile(gatesPath, "utf8"));

      expect(manifestRaw.run_id).toBe(runId);
      expect(manifestRaw.artifacts.root).toBe(root);
      expect(gatesRaw.run_id).toBe(runId);

      expect(validateManifestV1(manifestRaw)).toBeNull();
      expect(validateGatesV1(gatesRaw)).toBeNull();

      const logsStat = await fs.stat(path.join(root, "logs"));
      const auditStat = await fs.stat(path.join(root, "logs", "audit.jsonl"));
      expect(logsStat.isDirectory()).toBe(true);
      expect(auditStat.isFile()).toBe(true);
    });
  });

  test("deterministically preserves manifest schema_version + stage.current across seeded run_ids", async () => {
    await withTempDir(async (base) => {
      const fixtureDir = fixturePath("runs", "m1-finalize-happy");

      const first = await seed({
        fixtureDir,
        runId: "dr_fixture_seed_det_001",
        rootOverride: base,
        reason: "test: fixture seed deterministic first",
      });
      const second = await seed({
        fixtureDir,
        runId: "dr_fixture_seed_det_002",
        rootOverride: base,
        reason: "test: fixture seed deterministic second",
      });

      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);

      const firstManifest = JSON.parse(await fs.readFile(String(first.manifest_path), "utf8"));
      const secondManifest = JSON.parse(await fs.readFile(String(second.manifest_path), "utf8"));

      expect(firstManifest.schema_version).toBe(secondManifest.schema_version);
      expect(firstManifest.stage.current).toBe(secondManifest.stage.current);
    });
  });

  test("rejects run_id path traversal", async () => {
    await withTempDir(async (base) => {
      const fixtureDir = fixturePath("runs", "m1-finalize-happy");

      const out = await seed({
        fixtureDir,
        runId: "../escape",
        rootOverride: base,
        reason: "test: fixture seed traversal",
      });

      expect(out.ok).toBe(false);
      expect((out.error as Record<string, unknown>)?.code).toBe("PATH_TRAVERSAL");
    });
  });
});
